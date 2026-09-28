// The real AI Advisor agent: a Gemini tool-calling loop (not a naive
// "retrieve then paste into a prompt" RAG). The model decides which of the
// six read-only tools below to call, in what order, and how many times,
// before answering — mirroring the architecture spec's LangGraph-style
// agent without adding LangGraph/LangChain as dependencies. This app's
// server functions already run inside TanStack Start's own request/response
// lifecycle, and Gemini's native function-calling gives the same
// "reason -> call a tool -> observe -> continue" loop with far less
// integration risk in a Vite/Nitro SSR bundle than a second graph-execution
// framework would add. If that tradeoff is wrong for this project, swapping
// this module for a LangGraph graph is a contained change — every tool
// below is already a plain, framework-agnostic async function.
//
// Every tool only ever reads PUBLISHED project data (see
// projects.server.ts's "Read-only lookups for the AI advisor's tools"
// section) — the advisor answers from the public catalog, never a specific
// user's private drafts, even the current user's own.

import { createHash } from "node:crypto";
import {
	detectPromptInjection,
	launchArcjet,
	tokenBucket,
} from "@arcjet/guard";
import {
	ApiError,
	type Content,
	type FunctionCall,
	type FunctionDeclaration,
	GoogleGenAI,
	type Part,
	Type,
} from "@google/genai";
import { cacheAside } from "./cache.server";
import { recallRelevantMemories } from "./mem0";
import {
	getProjectStatistics,
	getPublicProject,
	getPublicProjectLinks,
	getPublicSourceDocument,
	searchProjectChunks,
	searchProjects,
} from "./projects.server";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const MAX_TOOL_ITERATIONS = 4;

let client: GoogleGenAI | null | undefined;
function getClient(): GoogleGenAI | null {
	if (client !== undefined) return client;
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) {
		console.warn(
			"GEMINI_API_KEY is not set — the AI advisor agent is disabled.",
		);
		client = null;
		return client;
	}
	client = new GoogleGenAI({
		apiKey,
		httpOptions: {
			retryOptions: { attempts: 3, initialDelay: 1, maxDelay: 8 },
		},
	});
	return client;
}

// --- Tool-call security (Arcjet Guard — see security.server.ts for the ----
// HTTP-request-level Arcjet client; this is the non-HTTP counterpart for
// agent tool calls, per @arcjet/skills#guard) ------------------------------

let guardClient: ReturnType<typeof launchArcjet> | null | undefined;
function getGuardClient() {
	if (guardClient !== undefined) return guardClient;
	const key = process.env.ARCJET_KEY;
	if (!key) {
		guardClient = null;
		return guardClient;
	}
	guardClient = launchArcjet({ key });
	return guardClient;
}

const toolCallLimit = tokenBucket({
	bucket: "advisor-tool-calls",
	refillRate: 20,
	intervalSeconds: 60,
	maxTokens: 40,
});
const promptInjectionRule = detectPromptInjection();

/**
 * Runs untrusted text through Arcjet Guard before it enters the model's
 * context. Fails open (allowed) if Arcjet is unconfigured or unreachable —
 * consistent with every other optional service in this app.
 *
 * `mode: "block"` is for genuinely user-authored text (the user's own
 * message, or the search-style arguments a tool call carries) — the real
 * injection attack surface, where the classifier is doing its intended job.
 * `mode: "audit"` is for content a tool RETRIEVED from our own database
 * (project fields Gemini extracted under strict anti-fabrication rules) —
 * a rate-limit denial is still enforced, but a PROMPT_INJECTION verdict is
 * logged rather than hard-blocked, since Arcjet's classifier was observed
 * to false-positive on ordinary academic project text wrapped as JSON, and
 * hard-gating the advisor's core retrieval on that verdict made it
 * unusable. The defense this was meant to cover (a malicious uploaded
 * document later "talking back" to the model) is real, but belongs at
 * ingestion time — scanned once when content enters the system, not
 * re-scanned on every read — which is a follow-up, not something this
 * function can safely do mid-conversation without breaking normal use.
 */
async function guardText(input: {
	label: string;
	userId: string;
	text: string;
	mode: "block" | "audit";
}): Promise<{ allowed: boolean; reason?: string }> {
	const guard = getGuardClient();
	if (!guard) return { allowed: true };
	try {
		const decision = await guard.guard({
			label: input.label,
			rules: [
				toolCallLimit({ key: input.userId }),
				promptInjectionRule(input.text),
			],
		});
		if (decision.conclusion === "DENY") {
			console.error("advisor-agent: guard denied", {
				label: input.label,
				reason: decision.reason,
			});
			if (input.mode === "audit" && decision.reason === "PROMPT_INJECTION") {
				return { allowed: true };
			}
			return { allowed: false, reason: decision.reason ?? "Blocked" };
		}
		return { allowed: true };
	} catch (error) {
		console.error("advisor-agent: guard call failed, failing open", error);
		return { allowed: true };
	}
}

// --- Tools ------------------------------------------------------------------

export type AdvisorCitation = {
	type: "project" | "chunk" | "document" | "statistics";
	projectId?: string;
	chunkId?: string;
	documentId?: string;
	pageNumber?: number | null;
	sectionTitle?: string | null;
	title?: string | null;
};

type ToolResult = { output: unknown; citations: AdvisorCitation[] };

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
	{
		name: "search_projects",
		description:
			"Hybrid search (lexical + semantic) over the published project catalog. Use to find projects matching a topic, technology, or department.",
		parameters: {
			type: Type.OBJECT,
			properties: {
				query: { type: Type.STRING, description: "Free-text search query." },
				department: { type: Type.STRING, nullable: true },
				projectType: { type: Type.STRING, nullable: true },
				researchArea: { type: Type.STRING, nullable: true },
				technology: { type: Type.STRING, nullable: true },
				year: { type: Type.NUMBER, nullable: true },
			},
			required: ["query"],
		},
	},
	{
		name: "get_project",
		description: "Fetch full details for one published project by its id.",
		parameters: {
			type: Type.OBJECT,
			properties: { projectId: { type: Type.STRING } },
			required: ["projectId"],
		},
	},
	{
		name: "search_project_chunks",
		description:
			"Deeper semantic search directly over project section content (methodology, results, etc.) — use for specific questions like 'what dataset did project X use' rather than whole-project search.",
		parameters: {
			type: Type.OBJECT,
			properties: {
				query: { type: Type.STRING },
				projectId: {
					type: Type.STRING,
					nullable: true,
					description: "Optionally restrict to one project's chunks.",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "get_source_document",
		description:
			"Get metadata (file name, page count, upload date) of the source document a project was extracted from, if any.",
		parameters: {
			type: Type.OBJECT,
			properties: { projectId: { type: Type.STRING } },
			required: ["projectId"],
		},
	},
	{
		name: "get_project_links",
		description: "Get a project's external links (GitHub, live demo, etc.).",
		parameters: {
			type: Type.OBJECT,
			properties: { projectId: { type: Type.STRING } },
			required: ["projectId"],
		},
	},
	{
		name: "get_project_statistics",
		description:
			"Aggregate statistics over the published catalog: totals by department, project type, and year. Use for 'how many projects...' style questions.",
		parameters: { type: Type.OBJECT, properties: {} },
	},
];

// Tool results are read-only queries over the PUBLIC catalog — the same
// call from two different users returns the same answer — so they're
// cache-aside'd by (tool name, args) the same way search ranking is in
// projects.server.ts. This is the "reduce duplicate API/DB calls when
// different users ask the same thing" saving: it caches the *retrieval*,
// not the model's personalized final reply (which still generates fresh
// per user/conversation, since it's shaped by that user's history and
// memory — caching it verbatim would leak one student's name/context into
// another's answer).
const TOOL_CACHE_TTL_SECONDS: Record<string, number> = {
	search_projects: 300,
	get_project: 300,
	search_project_chunks: 300,
	get_source_document: 900,
	get_project_links: 900,
	get_project_statistics: 300,
};

function buildToolCacheKey(
	name: string,
	args: Record<string, unknown>,
): string {
	const hash = createHash("sha256")
		.update(JSON.stringify(args, Object.keys(args).sort()))
		.digest("hex");
	return `advisor-tool:${name}:${hash}`;
}

async function runTool(
	name: string,
	args: Record<string, unknown>,
): Promise<ToolResult> {
	const ttlSeconds = TOOL_CACHE_TTL_SECONDS[name];
	if (ttlSeconds) {
		return cacheAside({
			key: buildToolCacheKey(name, args),
			ttlSeconds,
			compute: () => runToolUncached(name, args),
		});
	}
	return runToolUncached(name, args);
}

async function runToolUncached(
	name: string,
	args: Record<string, unknown>,
): Promise<ToolResult> {
	switch (name) {
		case "search_projects": {
			const query = typeof args.query === "string" ? args.query : "";
			const result = await searchProjects({
				q: query,
				department:
					typeof args.department === "string" ? args.department : undefined,
				projectType:
					typeof args.projectType === "string" ? args.projectType : undefined,
				researchArea:
					typeof args.researchArea === "string" ? args.researchArea : undefined,
				technology:
					typeof args.technology === "string" ? args.technology : undefined,
				year: typeof args.year === "number" ? args.year : undefined,
				page: 1,
				pageSize: 8,
			});
			return {
				output: { totalCount: result.totalCount, items: result.items },
				citations: result.items.map((item) => ({
					type: "project",
					projectId: item.id,
					title: item.title,
				})),
			};
		}
		case "get_project": {
			const projectId = String(args.projectId ?? "");
			const project = await getPublicProject(projectId);
			if (!project) return { output: { found: false }, citations: [] };
			return {
				output: { found: true, project },
				citations: [{ type: "project", projectId, title: project.title }],
			};
		}
		case "search_project_chunks": {
			const query = typeof args.query === "string" ? args.query : "";
			const projectId =
				typeof args.projectId === "string" ? args.projectId : null;
			const hits = await searchProjectChunks({
				query,
				limit: projectId ? 12 : 6,
			});
			const filtered = projectId
				? hits.filter((hit) => hit.projectId === projectId).slice(0, 6)
				: hits;
			return {
				output: { chunks: filtered },
				citations: filtered.map((hit) => ({
					type: "chunk",
					projectId: hit.projectId,
					chunkId: hit.chunkId,
					documentId: hit.documentId ?? undefined,
					pageNumber: hit.pageNumber,
					sectionTitle: hit.sectionTitle,
					title: hit.projectTitle,
				})),
			};
		}
		case "get_source_document": {
			const projectId = String(args.projectId ?? "");
			const doc = await getPublicSourceDocument(projectId);
			if (!doc) return { output: { found: false }, citations: [] };
			return {
				output: { found: true, document: doc },
				citations: [{ type: "document", projectId, documentId: doc.id }],
			};
		}
		case "get_project_links": {
			const projectId = String(args.projectId ?? "");
			const links = await getPublicProjectLinks(projectId);
			return {
				output: { links },
				citations: links.length ? [{ type: "project", projectId }] : [],
			};
		}
		case "get_project_statistics": {
			const stats = await getProjectStatistics();
			return { output: stats, citations: [{ type: "statistics" }] };
		}
		default:
			return { output: { error: `Unknown tool: ${name}` }, citations: [] };
	}
}

// --- Agent loop ---------------------------------------------------------

export type AdvisorTurnMessage = {
	role: "user" | "assistant";
	content: string;
};

const SYSTEM_INSTRUCTIONS = `You are the AI Advisor for a university final-year project discovery
platform. You help students explore published past projects and think
through their own project ideas.

Rules:
- Ground every factual claim about a specific project in a tool call result
  — never invent a project, title, technology, or statistic.
- If a tool finds nothing relevant, say so plainly rather than guessing.
- When discussing a specific project, call get_project or
  search_project_chunks first rather than relying on search_projects'
  short summaries alone.
- Keep answers focused and actionable: for open-ended "help me pick a
  project" questions, ask a clarifying question or offer a short structured
  set of options rather than a long essay.
- You may be given "Relevant memory about this student" — background from
  earlier conversations. Use it to personalize your answer, but never
  present it as something you just looked up.`;

export type AdvisorStreamEvent =
	| { type: "delta"; text: string }
	| { type: "done"; fullText: string; citations: AdvisorCitation[] }
	| { type: "error"; message: string };

/**
 * Runs one advisor turn as a stream: recalls relevant memory, runs the
 * Gemini tool-calling loop against the six read-only catalog tools, and
 * yields text as it's generated. Tool-call rounds (deciding which tool to
 * call, running it) are not shown token-by-token — in practice a turn
 * either calls tools or answers, not both, so only genuine final-answer
 * turns produce visible text — only the model's actual answer streams live.
 * Always ends with a `done` event carrying the full text and every
 * citation the tools actually returned this turn (never citations invented
 * by the model), or an `error` event with a user-facing message.
 */
export async function* streamAdvisorAgent(input: {
	userId: string;
	firstName: string;
	history: AdvisorTurnMessage[];
	message: string;
}): AsyncGenerator<AdvisorStreamEvent> {
	const ai = getClient();
	if (!ai) {
		yield {
			type: "error",
			message:
				"The AI advisor isn't configured yet (missing GEMINI_API_KEY) — please let an administrator know.",
		};
		return;
	}

	const inputGuard = await guardText({
		label: "advisor.user-message",
		userId: input.userId,
		text: input.message,
		mode: "block",
	});
	if (!inputGuard.allowed) {
		yield {
			type: "error",
			message:
				"I can't process that message — it looks like it might be trying to manipulate the advisor's instructions. Please rephrase your question.",
		};
		return;
	}

	const memories = await recallRelevantMemories({
		userId: input.userId,
		query: input.message,
	});

	const contents: Content[] = [
		...input.history.map((message) => ({
			role: message.role === "assistant" ? "model" : "user",
			parts: [{ text: message.content }],
		})),
		{
			role: "user" as const,
			parts: [
				...(memories.length
					? [
							{
								text: `Relevant memory about this student:\n${memories.map((m) => `- ${m}`).join("\n")}`,
							},
						]
					: []),
				{ text: input.message },
			],
		},
	];

	const allCitations: AdvisorCitation[] = [];
	const seenCitationKeys = new Set<string>();
	function addCitations(list: AdvisorCitation[]) {
		for (const citation of list) {
			const key = JSON.stringify(citation);
			if (seenCitationKeys.has(key)) continue;
			seenCitationKeys.add(key);
			allCitations.push(citation);
		}
	}

	try {
		for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
			const stream = await ai.models.generateContentStream({
				model: MODEL,
				contents,
				config: {
					systemInstruction: `${SYSTEM_INSTRUCTIONS}\n\nThe student's first name is ${input.firstName}.`,
					tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
				},
			});

			// Reconstruct the equivalent of a single non-streamed response's
			// `content.parts` by concatenating each chunk's incremental parts in
			// order (Gemini's streaming contract delivers new parts per chunk,
			// not the whole-so-far response) — needed to echo the turn back with
			// its thoughtSignature intact. Function-call arguments arrive
			// atomically in one chunk each (the SDK's `streamFunctionCallArguments`
			// option is explicitly unsupported by the Gemini API), so only text is
			// genuinely token-streamed — each text part is yielded to the caller
			// the moment it arrives, true live streaming, not buffered replay.
			// A turn in practice either calls tools or answers, not both, so any
			// text streamed before a functionCall part (rare) is a known,
			// accepted edge case rather than something worth buffering to guard
			// against — buffering would defeat the point of streaming at all.
			const parts: Part[] = [];
			const functionCalls: FunctionCall[] = [];
			let streamedText = "";
			for await (const chunk of stream) {
				const chunkParts = chunk.candidates?.[0]?.content?.parts ?? [];
				for (const part of chunkParts) {
					parts.push(part);
					if (part.text) {
						streamedText += part.text;
						yield { type: "delta", text: part.text };
					}
					if (part.functionCall) functionCalls.push(part.functionCall);
				}
			}

			if (functionCalls.length === 0) {
				const text = streamedText.trim();
				yield {
					type: "done",
					fullText:
						text ||
						"I don't have a clear answer for that — could you rephrase?",
					citations: allCitations,
				};
				return;
			}

			// Echo the model's function-call turn back verbatim (the
			// reconstructed parts, not a hand-rebuilt {name, args} shape) —
			// Gemini 3's multi-turn tool use requires each functionCall part's
			// `thoughtSignature` to round-trip unchanged.
			contents.push({ role: "model", parts });

			const responseParts = await Promise.all(
				functionCalls.map(async (call) => {
					const name = call.name ?? "";
					const id = call.id;
					const args = call.args ?? {};
					const toolGuard = await guardText({
						label: `advisor.tool.${name}`,
						userId: input.userId,
						text: JSON.stringify(args),
						mode: "block",
					});
					if (!toolGuard.allowed) {
						return {
							functionResponse: {
								id,
								name,
								response: {
									error: "This tool call was blocked by a security rule.",
								},
							},
						};
					}

					const result = await runTool(name, args);
					// Scan retrieved content itself (not just the call arguments)
					// before it re-enters the model's context — this is the
					// "retrieved/tool output" prompt-injection point flagged in
					// security.server.ts.
					const retrievedText = JSON.stringify(result.output).slice(0, 4000);
					const outputGuard = await guardText({
						label: `advisor.tool-result.${name}`,
						userId: input.userId,
						text: retrievedText,
						mode: "audit",
					});
					if (!outputGuard.allowed) {
						console.error(
							"advisor-agent: withheld tool result flagged by guard",
							name,
						);
						return {
							functionResponse: {
								id,
								name,
								response: {
									error: "This result was withheld by a security rule.",
								},
							},
						};
					}

					addCitations(result.citations);
					return {
						functionResponse: {
							id,
							name,
							response: { output: result.output },
						},
					};
				}),
			);

			contents.push({ role: "user", parts: responseParts });
		}

		yield {
			type: "done",
			fullText:
				"I looked into several angles on this but couldn't settle on a final answer in time — could you narrow your question a bit?",
			citations: allCitations,
		};
	} catch (error) {
		console.error("advisor-agent: run failed", error);
		if (
			error instanceof ApiError &&
			(error.status >= 500 || error.status === 429)
		) {
			yield {
				type: "error",
				message:
					"The AI advisor is busy or temporarily unavailable — please try again shortly.",
			};
			return;
		}
		yield {
			type: "error",
			message: "Something went wrong answering that — please try again.",
		};
	}
}

/**
 * Non-streaming convenience wrapper over {@link streamAdvisorAgent} for
 * callers that just want the final result (e.g. a background job, or a
 * plain server function that doesn't stream to the client).
 */
export async function runAdvisorAgent(input: {
	userId: string;
	firstName: string;
	history: AdvisorTurnMessage[];
	message: string;
}): Promise<{ reply: string; citations: AdvisorCitation[] }> {
	let reply = "";
	let citations: AdvisorCitation[] = [];
	for await (const event of streamAdvisorAgent(input)) {
		if (event.type === "done") {
			reply = event.fullText;
			citations = event.citations;
		} else if (event.type === "error") {
			reply = event.message;
		}
	}
	return { reply, citations };
}
