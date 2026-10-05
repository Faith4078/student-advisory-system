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
import {
	forgetMatchingMemories,
	recallRelevantMemories,
	rememberExplicitFact,
} from "./mem0";
import type { ProfileDetails } from "./profile.server";
import {
	getProjectStatistics,
	getPublicProject,
	getPublicProjectLinks,
	getPublicSourceDocument,
	searchProjectChunks,
	searchProjects,
} from "./projects.server";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
// A "for each of these N projects, fetch X" follow-up needs roughly one
// tool-call round per project before the model can even start synthesising
// an answer. 4 was observed, live, to be too tight for exactly this
// pattern with as few as 3 projects — the model would still be retrieving
// when the loop gave up, producing a generic "couldn't settle on an answer"
// reply despite having already found relevant evidence (visible in the
// citations that still came through). 8 gives genuinely multi-project
// questions room to complete without materially changing single-project
// turns, which typically resolve in 1-2 iterations regardless.
const MAX_TOOL_ITERATIONS = 8;

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
	allowDownload?: boolean;
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
	{
		name: "remember_about_student",
		description:
			"Save a fact about this student for future conversations. Call this immediately when the student explicitly asks you to remember something. If instead YOU notice a lasting preference or fact the student stated without asking you to save it (e.g. a project interest, a constraint, a correction to something you got wrong about them), do NOT call this yet — first ask the student, in one short sentence summarizing exactly what you'd save, whether they want it remembered, and only call this tool after they confirm. If it conflicts with something already remembered, it replaces that memory rather than duplicating it, so this is also how you update a previously-remembered fact.",
		parameters: {
			type: Type.OBJECT,
			properties: {
				fact: {
					type: Type.STRING,
					description:
						"The fact to remember, written as a short, clear, standalone statement (e.g. 'Interested in applying machine learning to agriculture').",
				},
			},
			required: ["fact"],
		},
	},
	{
		name: "forget_about_student",
		description:
			"Delete previously-remembered fact(s) about this student that match a description — call this whenever the student asks you to forget, delete, or stop remembering something specific.",
		parameters: {
			type: Type.OBJECT,
			properties: {
				description: {
					type: Type.STRING,
					description:
						"A natural-language description of what to forget (e.g. 'that I'm interested in blockchain').",
				},
			},
			required: ["description"],
		},
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
	userId: string,
): Promise<ToolResult> {
	const ttlSeconds = TOOL_CACHE_TTL_SECONDS[name];
	if (ttlSeconds) {
		// Cached tools are read-only catalog queries — identical for every
		// caller, so they're safe to cache by (name, args) alone. The two
		// memory-mutation tools below are never in this map (see its
		// declaration), since they must always execute for real and are
		// inherently per-user.
		return cacheAside({
			key: buildToolCacheKey(name, args),
			ttlSeconds,
			compute: () => runToolUncached(name, args, userId),
		});
	}
	return runToolUncached(name, args, userId);
}

async function runToolUncached(
	name: string,
	args: Record<string, unknown>,
	userId: string,
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
					allowDownload: hit.allowDownload,
				})),
			};
		}
		case "get_source_document": {
			const projectId = String(args.projectId ?? "");
			const doc = await getPublicSourceDocument(projectId);
			if (!doc) return { output: { found: false }, citations: [] };
			return {
				output: { found: true, document: doc },
				citations: [
					{
						type: "document",
						projectId,
						documentId: doc.id,
						allowDownload: doc.allowDownload,
					},
				],
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
		case "remember_about_student": {
			const fact = typeof args.fact === "string" ? args.fact.trim() : "";
			if (!fact) {
				return {
					output: { saved: false, error: "No fact was provided." },
					citations: [],
				};
			}
			const saved = await rememberExplicitFact({ userId, fact });
			return { output: { saved, fact }, citations: [] };
		}
		case "forget_about_student": {
			const description =
				typeof args.description === "string" ? args.description.trim() : "";
			if (!description) {
				return {
					output: { deleted: [], error: "No description was provided." },
					citations: [],
				};
			}
			const deleted = await forgetMatchingMemories({ userId, description });
			return {
				output: {
					deletedCount: deleted.length,
					deleted: deleted.map((entry) => entry.memory),
				},
				citations: [],
			};
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

const SYSTEM_INSTRUCTIONS = `You are the AI Academic Advisor for undergraduate students in the Department
of Computer Science and Engineering. You support undergraduate students with
their academic needs, with a particular focus on discovering and developing
project ideas using the department's published project catalog. If a student
greets you or asks who you are, introduce yourself warmly and briefly as
their academic advisor, here to help with whatever they need — project
discovery, scoping an idea, or general academic questions.

Rules:
- Ground every factual claim about a specific project in a tool call result
  — never invent a project, title, technology, or statistic.
- This grounding requirement applies on EVERY turn, including follow-up
  questions about a project you already discussed earlier in this same
  conversation. The conversation history you see is only the text you
  previously wrote, not the underlying tool results that supported it — so
  if a follow-up asks for more or different specific detail about a project
  (e.g. its limitations, after you already described its methodology), call
  get_project or search_project_chunks again for that project before
  answering. Do not answer from what you recall writing earlier; recalled
  prose is not retrieved evidence, and extending it with new specifics you
  did not just retrieve is exactly the kind of invention this rule exists
  to prevent, however plausible it sounds.
- If a tool finds nothing relevant, say so plainly rather than guessing. If
  the student asked for a specific named section (e.g. "limitations",
  "future work") and no retrieved chunk is clearly that section, say so
  honestly rather than fabricating one — but don't just stop there: offer
  whatever related content you *did* retrieve (e.g. results or conclusion
  content that touches on the same thing) so the answer is still useful,
  and be clear that it's a related excerpt, not the named section itself.
- When discussing a specific project, call get_project or
  search_project_chunks first rather than relying on search_projects'
  short summaries alone.
- If the student asks for a deep dive on "a project" about some topic (not a
  project they've named), and your search turns up more than one project that
  plausibly matches, do not pick one yourself and dive in. List the matching
  titles and ask which one they want to start with — don't call get_project or
  search_project_chunks for any of them yet. Once they pick one, deep-dive into
  that project only and cite only it, not the siblings you merely listed. If
  they then say something like "the next one" or "what about the other one",
  move on to the next candidate from that same list the same way: deep-dive
  into it alone and cite only it.
- This disambiguation does not apply when the student already names specific
  projects (e.g. "I read about Project A and Project B") — look up exactly the
  projects they named and answer about them directly; citing exactly those is
  correct, since that is what they actually asked about.
- When you use a passage from search_project_chunks, mention where it came
  from in your own words where it's natural to do so (e.g. "in the
  Methodology section" or "on page 7") using that chunk's section name
  and/or page number — the student is reading your text, not the raw
  citations list, so this is how they actually learn where in the report
  something is, not just which project it's in.
- Tool results include internal identifiers (fields like "id", "projectId",
  "chunkId", "documentId") — these exist ONLY so you can make follow-up tool
  calls (e.g. fetching more detail about a project you just found). NEVER
  include a raw id in your reply text, in any form (not even labelled "Project
  ID:" or in parentheses) — refer to a project, document, or chunk by its
  title or section name only. The citations shown alongside your reply
  already link each source to the right project, so the student never needs
  an id to find it.
- Keep answers focused and actionable: for open-ended "help me pick a
  project" questions, ask a clarifying question or offer a short structured
  set of options rather than a long essay.
- You are always given this student's profile (name, matric number,
  department, bio, interests) below — you already know these, so never ask
  for them or treat them as something you "looked up"; just use them
  naturally. Any field shown as "not provided" genuinely isn't set, so ask
  rather than guess if it becomes relevant.
- You may also be given "Relevant memory about this student" — specific
  facts learned from earlier conversations. Use it to personalize your
  answer, but never present it as something you just looked up.
- When the student explicitly asks you to remember, forget, or update a fact
  about them, actually call remember_about_student or forget_about_student
  rather than just replying as if you had — then confirm, briefly and
  specifically, what you did (e.g. what was saved, or what was deleted and
  how many matches were found). If forget_about_student finds nothing to
  delete, say so rather than claiming success.
- If the student instead merely states a lasting preference or fact in
  passing, without asking you to save it, do not call remember_about_student
  yet. First ask them directly, in one short summarized sentence (e.g. "Want
  me to remember that you're interested in applying ML to agriculture for
  future conversations?"), and only save it if they say yes. Never save an
  inferred fact silently.`;

function formatStudentProfileBlock(profile: ProfileDetails): string {
	const matricNumber = profile.displayUsername || profile.username || "not set";
	const interests = profile.interests.length
		? profile.interests.join(", ")
		: "not provided";
	return `Student profile (always true for this conversation — not retrieved via a tool, just known):
- Name: ${profile.firstName} ${profile.lastName}
- Matric number: ${matricNumber}
- Department: ${profile.department}
- Bio: ${profile.bio || "not provided"}
- Interests: ${interests}`;
}

export type AdvisorStreamEvent =
	| { type: "delta"; text: string }
	| { type: "done"; fullText: string; citations: AdvisorCitation[] }
	| { type: "error"; message: string };

/**
 * The message shown when the tool-calling loop exhausts MAX_TOOL_ITERATIONS
 * without the model producing a final answer. Names whatever projects were
 * actually found before the cap hit (if any) instead of a content-free
 * apology, since the whole point of resolving citations server-side is that
 * this list is always genuinely retrieved evidence, never invented.
 */
function buildIterationLimitMessage(citations: AdvisorCitation[]): string {
	const titles = Array.from(
		new Set(
			citations
				.filter(
					(citation) =>
						citation.type === "project" || citation.type === "chunk",
				)
				.map((citation) => citation.title)
				.filter((title): title is string => Boolean(title)),
		),
	);
	if (titles.length === 0) {
		return "I wasn't able to put together a complete answer to that in the time I had — could you narrow your question, for example to one project at a time?";
	}
	const titleList = titles.map((title) => `- ${title}`).join("\n");
	return `I found relevant information across several projects but ran out of turns before I could finish pulling it all together into one answer. Here's what I was retrieving evidence from:\n${titleList}\n\nTry asking about one of these at a time (for example, just its methodology or results) and I can go into full detail.`;
}

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
	profile: ProfileDetails;
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
					systemInstruction: `${SYSTEM_INSTRUCTIONS}\n\n${formatStudentProfileBlock(input.profile)}`,
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

					const result = await runTool(name, args, input.userId);
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
			// Even the "I ran out of turns" case stays grounded: if tool calls
			// already turned up relevant projects before the iteration cap hit,
			// say so by name and suggest a narrower follow-up, rather than a
			// generic non-answer that throws away evidence the student can see
			// sitting right there in the citations list.
			fullText: buildIterationLimitMessage(allCitations),
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
	profile: ProfileDetails;
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
