import { ApiError, GoogleGenAI, Type } from "@google/genai";

// NOTE ON VALIDATION: this module intentionally does not `import { z } from "zod"`.
// zod is only a *transitive* dependency here (pulled in by better-auth /
// @tanstack/router-plugin / mem0ai's openai client) — it has no top-level
// node_modules/zod entry and is not declared in package.json, so `import "zod"`
// fails to resolve at both typecheck and runtime. Adding it properly requires
// editing package.json/pnpm-lock.yaml, which this task explicitly must not
// touch (other agents are editing those files concurrently). Until zod is
// added as a real dependency, ProjectDraftSchema / ProjectDraftListSchema are
// implemented as small hand-rolled validators that mirror zod's `safeParse`
// contract (`{ success: true, data }` | `{ success: false, error }`), so the
// call sites below — and any future swap to real zod — stay unchanged.

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

let client: GoogleGenAI | null | undefined;
let warned = false;

function getClient(): GoogleGenAI | null {
	if (client !== undefined) return client;
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) {
		if (!warned) {
			console.warn(
				"GEMINI_API_KEY is not set — document extraction features are disabled.",
			);
			warned = true;
		}
		client = null;
		return client;
	}
	client = new GoogleGenAI({
		apiKey,
		httpOptions: {
			// Gemini's document-understanding calls can transiently 503
			// ("model overloaded") — retry a few times with backoff before
			// surfacing a failure, instead of treating a busy model the same
			// as "this document has no projects".
			retryOptions: { attempts: 3, initialDelay: 1, maxDelay: 8 },
		},
	});
	return client;
}

export type AbstractSource = "explicit" | "generated";

export type ProjectDraft = {
	title: string | null;
	author: string | null;
	department: string | null;
	faculty: string | null;
	projectType: string | null;
	researchArea: string | null;
	keywords: string[] | null;
	technologies: string[] | null;
	problemStatement: string | null;
	objectives: string[] | null;
	methodology: string | null;
	results: string | null;
	conclusion: string | null;
	projectYear: number | null;
	abstract: string | null;
	abstractSource: AbstractSource | null;
	originalAbstract: string | null;
	generatedAbstract: string | null;
	sourcePageRangeStart: number | null;
	sourcePageRangeEnd: number | null;
	sourceSections: string[] | null;
	extractionConfidence: number | null;
	evidence: string | null;
	// Complete verbatim transcription of this project's own source pages (not
	// a summary) — the basis for late-chunked, full-document-aware retrieval.
	// Null for a project whose deep-extraction call failed to produce one.
	fullText: string | null;
};

type SafeParseResult<T> =
	| { success: true; data: T }
	| { success: false; error: { message: string; issues: string[] } };

type FieldValidator = (
	value: unknown,
	path: string,
	issues: string[],
) => unknown;

function nullableOf(
	base: (value: unknown, path: string, issues: string[]) => boolean,
	typeName: string,
): FieldValidator {
	return (value, path, issues) => {
		if (value === null || value === undefined) return null;
		if (!base(value, path, issues)) {
			issues.push(
				`${path}: expected ${typeName} or null, got ${JSON.stringify(value)}`,
			);
			return null;
		}
		return value;
	};
}

const nullableString = nullableOf((v) => typeof v === "string", "string");
const nullableNumber = nullableOf(
	(v) => typeof v === "number" && Number.isFinite(v),
	"number",
);
const nullableStringArray = nullableOf(
	(v) => Array.isArray(v) && v.every((item) => typeof item === "string"),
	"string[]",
);
const nullableAbstractSource: FieldValidator = (value, path, issues) => {
	if (value === null || value === undefined) return null;
	if (value === "explicit" || value === "generated") return value;
	issues.push(
		`${path}: expected "explicit" | "generated" | null, got ${JSON.stringify(value)}`,
	);
	return null;
};

const PROJECT_DRAFT_FIELDS: Record<keyof ProjectDraft, FieldValidator> = {
	title: nullableString,
	author: nullableString,
	department: nullableString,
	faculty: nullableString,
	projectType: nullableString,
	researchArea: nullableString,
	keywords: nullableStringArray,
	technologies: nullableStringArray,
	problemStatement: nullableString,
	objectives: nullableStringArray,
	methodology: nullableString,
	results: nullableString,
	conclusion: nullableString,
	projectYear: nullableNumber,
	abstract: nullableString,
	abstractSource: nullableAbstractSource,
	originalAbstract: nullableString,
	generatedAbstract: nullableString,
	sourcePageRangeStart: nullableNumber,
	sourcePageRangeEnd: nullableNumber,
	sourceSections: nullableStringArray,
	extractionConfidence: nullableNumber,
	evidence: nullableString,
	fullText: nullableString,
};

function parseProjectDraft(
	value: unknown,
	path: string,
	issues: string[],
): ProjectDraft | null {
	if (typeof value !== "object" || value === null) {
		issues.push(`${path}: expected an object, got ${JSON.stringify(value)}`);
		return null;
	}
	const record = value as Record<string, unknown>;
	const result = {} as ProjectDraft;
	for (const key of Object.keys(
		PROJECT_DRAFT_FIELDS,
	) as (keyof ProjectDraft)[]) {
		const validate = PROJECT_DRAFT_FIELDS[key];
		result[key] = validate(record[key], `${path}.${key}`, issues) as never;
	}
	return result;
}

export const ProjectDraftSchema = {
	safeParse(value: unknown): SafeParseResult<ProjectDraft> {
		const issues: string[] = [];
		const data = parseProjectDraft(value, "project", issues);
		if (!data || issues.length > 0) {
			return {
				success: false,
				error: {
					message: issues.join("; ") || "invalid project draft",
					issues,
				},
			};
		}
		return { success: true, data };
	},
};

// Gemini's `responseSchema` uses a restricted OpenAPI-like Schema, not JSON
// Schema — nullability is expressed with `nullable: true` alongside `type`,
// not a `["string", "null"]` union.
const stringField = { type: Type.STRING, nullable: true };
const numberField = { type: Type.NUMBER, nullable: true };
const stringArrayField = {
	type: Type.ARRAY,
	nullable: true,
	items: { type: Type.STRING },
};

const projectDraftGeminiSchema = {
	type: Type.OBJECT,
	properties: {
		title: stringField,
		author: stringField,
		department: stringField,
		faculty: stringField,
		projectType: stringField,
		researchArea: stringField,
		keywords: stringArrayField,
		technologies: stringArrayField,
		problemStatement: stringField,
		objectives: stringArrayField,
		methodology: stringField,
		results: stringField,
		conclusion: stringField,
		projectYear: numberField,
		abstract: stringField,
		abstractSource: {
			type: Type.STRING,
			nullable: true,
			enum: ["explicit", "generated"],
		},
		originalAbstract: stringField,
		generatedAbstract: stringField,
		sourcePageRangeStart: numberField,
		sourcePageRangeEnd: numberField,
		sourceSections: stringArrayField,
		extractionConfidence: numberField,
		evidence: stringField,
		fullText: stringField,
	},
	required: Object.keys(PROJECT_DRAFT_FIELDS),
};

// --- Stage 1: discovery ------------------------------------------------------
// A document with several projects (e.g. a SIWES/industrial-training report
// covering many students) used to be extracted in one single Gemini call that
// had to produce every field, for every project, in one JSON response. Under
// that shared output budget the model reliably degraded into writing a short
// synopsis per project instead of full per-field detail — it would rather
// under-fill every project a little than run out of room. Splitting into a
// cheap "where are the project boundaries" discovery pass followed by one
// dedicated deep-extraction call *per project* (stage 2, below) gives every
// project its own full output budget, which is what actually fixes that.

type ProjectDiscovery = {
	title: string | null;
	sourcePageRangeStart: number | null;
	sourcePageRangeEnd: number | null;
	sourceSections: string[] | null;
};

const projectDiscoveryGeminiSchema = {
	type: Type.OBJECT,
	properties: {
		projects: {
			type: Type.ARRAY,
			items: {
				type: Type.OBJECT,
				properties: {
					title: stringField,
					sourcePageRangeStart: numberField,
					sourcePageRangeEnd: numberField,
					sourceSections: stringArrayField,
				},
				required: [
					"title",
					"sourcePageRangeStart",
					"sourcePageRangeEnd",
					"sourceSections",
				],
			},
		},
	},
	required: ["projects"],
};

const DISCOVERY_INSTRUCTIONS = `You are scanning an academic project/thesis document to identify how many
distinct student projects it contains (which may be a single project, or a
combined report covering several distinct projects, e.g. a SIWES/industrial-
training report covering multiple students).

For EACH distinct project you find, report only:
- a short identifying title (your best reading from the document)
- the page range it spans (sourcePageRangeStart / sourcePageRangeEnd, 1-indexed)
- the section headings that belong to it (sourceSections)

Do not extract abstracts, methodology, results, or any other detailed field
yet — this is only a structural scan to find project boundaries. Most
documents contain exactly one project; some contain several. Return one entry
per project, in document order. Return strictly the JSON object described by
the response schema.`;

function parseProjectDiscoveryList(value: unknown): ProjectDiscovery[] {
	if (
		typeof value !== "object" ||
		value === null ||
		!Array.isArray((value as { projects?: unknown }).projects)
	) {
		throw new Error("expected { projects: ProjectDiscovery[] }");
	}
	return (value as { projects: unknown[] }).projects
		.filter(
			(item): item is Record<string, unknown> =>
				typeof item === "object" && item !== null,
		)
		.map((item) => ({
			title: typeof item.title === "string" ? item.title : null,
			sourcePageRangeStart:
				typeof item.sourcePageRangeStart === "number"
					? item.sourcePageRangeStart
					: null,
			sourcePageRangeEnd:
				typeof item.sourcePageRangeEnd === "number"
					? item.sourcePageRangeEnd
					: null,
			sourceSections: Array.isArray(item.sourceSections)
				? item.sourceSections.filter((s): s is string => typeof s === "string")
				: null,
		}));
}

async function discoverProjects(
	ai: GoogleGenAI,
	input: { fileBytes: Buffer; mimeType: string },
): Promise<ProjectDiscovery[]> {
	const response = await ai.models.generateContent({
		model: MODEL,
		contents: [
			{
				role: "user",
				parts: [
					{ text: DISCOVERY_INSTRUCTIONS },
					{
						inlineData: {
							mimeType: input.mimeType,
							data: input.fileBytes.toString("base64"),
						},
					},
				],
			},
		],
		config: {
			responseMimeType: "application/json",
			responseSchema: projectDiscoveryGeminiSchema,
		},
	});

	const raw = response.text;
	if (!raw) {
		console.error("gemini: discoverProjects got an empty response");
		return [];
	}
	try {
		return parseProjectDiscoveryList(JSON.parse(raw));
	} catch (error) {
		console.error("gemini: discoverProjects response failed validation", error);
		return [];
	}
}

// --- Stage 2: deep extraction, one Gemini call per discovered project -------

function buildDeepExtractionInstructions(discovery: ProjectDiscovery): string {
	return `You are extracting ONE structured project record, in full detail, from an
academic project/thesis document. This document may contain multiple
projects, but you must extract ONLY the single project described below —
ignore all other projects' content entirely.

TARGET PROJECT:
- Working title: ${discovery.title ?? "(unknown — determine from the text)"}
- Page range: ${discovery.sourcePageRangeStart ?? "?"}-${discovery.sourcePageRangeEnd ?? "?"}
- Sections: ${discovery.sourceSections?.join(", ") ?? "(unknown)"}

Rules:
1. Extract this ONE project's fields exactly as defined by the schema, using
   only the pages/sections identified above.
2. IMPORTANT — do not summarize or compress. "methodology", "results", and
   "conclusion" must reflect the FULL detail actually stated in the source for
   THIS project (every technique, dataset, result, and limitation mentioned),
   not a one- or two-sentence synopsis. A thorough, multi-paragraph answer is
   expected and correct wherever the source supports it.
3. Never fabricate a value the source text does not support. If a field is
   not stated or cannot be reasonably inferred, return null for it.
4. Evaluate the abstract:
   - If this project has an explicit academic abstract that adequately covers
     problem/purpose, approach, outcome, and significance — and is not just
     narrative "I participated in..." text — set abstractSource="explicit",
     put that exact text in originalAbstract, and copy it into abstract.
   - Otherwise, WRITE a concise, academically-styled abstract using only facts
     present in the document. Set abstractSource="generated", put your
     written text in generatedAbstract, and copy it into abstract. Leave
     originalAbstract null in this case.
5. Populate "evidence" with a short supporting quote, and "extractionConfidence"
   with your confidence (0 to 1) in this extraction.
6. Populate "fullText" with a COMPLETE, FAITHFUL VERBATIM TRANSCRIPTION of this
   project's own pages/sections — every paragraph, in reading order, exactly
   as written in the source (excluding running headers, footers, and bare page
   numbers). This is a transcription, not a summary: do not shorten,
   paraphrase, or omit content. It is used to build search passages, so
   completeness matters more than brevity.
7. Return strictly the JSON object described by the response schema.`;
}

async function extractOneProject(
	ai: GoogleGenAI,
	input: { fileBytes: Buffer; mimeType: string },
	discovery: ProjectDiscovery,
): Promise<ProjectDraft> {
	const response = await ai.models.generateContent({
		model: MODEL,
		contents: [
			{
				role: "user",
				parts: [
					{ text: buildDeepExtractionInstructions(discovery) },
					{
						inlineData: {
							mimeType: input.mimeType,
							data: input.fileBytes.toString("base64"),
						},
					},
				],
			},
		],
		config: {
			responseMimeType: "application/json",
			responseSchema: projectDraftGeminiSchema,
		},
	});

	const raw = response.text;
	if (!raw) throw new Error("gemini: deep extraction got an empty response");

	const result = ProjectDraftSchema.safeParse(JSON.parse(raw));
	if (!result.success) {
		throw new Error(
			`gemini: deep extraction response failed validation: ${result.error.message}`,
		);
	}
	// The discovery pass's page range/sections are more reliable than asking
	// the deep-extraction call to restate them — keep them authoritative.
	return {
		...result.data,
		sourcePageRangeStart: discovery.sourcePageRangeStart,
		sourcePageRangeEnd: discovery.sourcePageRangeEnd,
		sourceSections: discovery.sourceSections,
	};
}

function toRetryableServiceError(error: unknown): Error | null {
	if (error instanceof ApiError && error.status >= 500) {
		return new Error(
			"The AI document analysis service is temporarily unavailable. Please try again in a few minutes.",
		);
	}
	if (error instanceof ApiError && error.status === 429) {
		return new Error(
			"The AI document analysis service is busy right now. Please try again shortly.",
		);
	}
	return null;
}

/**
 * Sends document bytes (a PDF, per Gemini's native document understanding)
 * to Gemini and extracts every distinct project it contains as a
 * ProjectDraft, via a discovery pass (find project boundaries) followed by
 * one dedicated deep-extraction call per discovered project (see the two
 * stages above). Returns [] if Gemini is unconfigured, or if discovery
 * genuinely found nothing extractable. Throws if the underlying API calls
 * failed (already retried internally) in a way that means the service itself
 * was unreachable — that's a retryable outage, not "this document has no
 * projects", and callers should treat it as such.
 */
export async function extractProjectsFromDocument(input: {
	fileBytes: Buffer;
	mimeType: string;
}): Promise<ProjectDraft[]> {
	const ai = getClient();
	if (!ai) return [];

	let discoveries: ProjectDiscovery[];
	try {
		discoveries = await discoverProjects(ai, input);
	} catch (error) {
		console.error("gemini: discoverProjects failed", error);
		const retryable = toRetryableServiceError(error);
		if (retryable) throw retryable;
		throw error instanceof Error
			? error
			: new Error("Document analysis failed.");
	}
	if (discoveries.length === 0) return [];

	const settled = await Promise.allSettled(
		discoveries.map((discovery) => extractOneProject(ai, input, discovery)),
	);

	const drafts: ProjectDraft[] = [];
	const failures: unknown[] = [];
	for (const result of settled) {
		if (result.status === "fulfilled") {
			drafts.push(result.value);
		} else {
			failures.push(result.reason);
			console.error(
				"gemini: per-project deep extraction failed",
				result.reason,
			);
		}
	}

	// If every single discovered project failed, and at least one of those
	// failures was a genuine service outage (not a content/validation issue),
	// surface that as a retryable failure rather than silently reporting
	// "no projects found" for what was actually Gemini being unreachable.
	if (drafts.length === 0 && failures.length > 0) {
		for (const failure of failures) {
			const retryable = toRetryableServiceError(failure);
			if (retryable) throw retryable;
		}
	}

	return drafts;
}

// --- Backfill: transcription only, for projects extracted before fullText --
// existed. Deliberately separate from extractOneProject/deep extraction: it
// returns ONLY fullText, never touching title/abstract/methodology/etc, so
// backfilling cannot silently overwrite fields a student has since reviewed
// or edited in the dashboard.

const transcriptionGeminiSchema = {
	type: Type.OBJECT,
	properties: { fullText: stringField },
	required: ["fullText"],
};

function buildTranscriptionInstructions(hint: {
	title: string | null;
	sourcePageRangeStart: number | null;
	sourcePageRangeEnd: number | null;
	sourceSections: string[] | null;
}): string {
	return `This document may contain multiple projects. Transcribe ONLY the single
project described below — ignore all other projects' content entirely.

TARGET PROJECT:
- Title: ${hint.title ?? "(unknown)"}
- Page range: ${hint.sourcePageRangeStart ?? "?"}-${hint.sourcePageRangeEnd ?? "?"}
- Sections: ${hint.sourceSections?.join(", ") ?? "(unknown)"}

Populate "fullText" with a COMPLETE, FAITHFUL VERBATIM TRANSCRIPTION of this
project's own pages/sections — every paragraph, in reading order, exactly as
written in the source (excluding running headers, footers, and bare page
numbers). This is a transcription, not a summary: do not shorten, paraphrase,
or omit content. If you cannot confidently identify this project's own text in
the document, return null rather than transcribing the wrong project.

Return strictly the JSON object described by the response schema.`;
}

/**
 * Backfills `fullText` for a project extracted before that field existed, by
 * re-reading its already-uploaded source document. Best-effort: returns null
 * (never throws) on any failure, since this is a maintenance/backfill path,
 * not a user-facing request — a failure should just skip that project.
 */
export async function transcribeProjectFullText(input: {
	fileBytes: Buffer;
	mimeType: string;
	title: string | null;
	sourcePageRangeStart: number | null;
	sourcePageRangeEnd: number | null;
	sourceSections: string[] | null;
}): Promise<string | null> {
	const ai = getClient();
	if (!ai) return null;
	try {
		const response = await ai.models.generateContent({
			model: MODEL,
			contents: [
				{
					role: "user",
					parts: [
						{ text: buildTranscriptionInstructions(input) },
						{
							inlineData: {
								mimeType: input.mimeType,
								data: input.fileBytes.toString("base64"),
							},
						},
					],
				},
			],
			config: {
				responseMimeType: "application/json",
				responseSchema: transcriptionGeminiSchema,
			},
		});
		const raw = response.text;
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { fullText?: unknown };
		return typeof parsed.fullText === "string" && parsed.fullText.trim()
			? parsed.fullText
			: null;
	} catch (error) {
		console.error("gemini: transcribeProjectFullText failed", error);
		return null;
	}
}

const ABSTRACT_EVAL_SCHEMA = {
	type: Type.OBJECT,
	properties: {
		abstract: { type: Type.STRING },
		abstractSource: {
			type: Type.STRING,
			enum: ["explicit", "generated"],
		},
		originalAbstract: stringField,
		generatedAbstract: stringField,
	},
	required: [
		"abstract",
		"abstractSource",
		"originalAbstract",
		"generatedAbstract",
	],
};

const ABSTRACT_EVAL_INSTRUCTIONS = `You are judging and, if needed, writing an academic abstract for a single
project from its raw source text.

- If the text already contains an explicit, adequate academic abstract
  (covers problem/purpose, approach, outcome, and significance as far as the
  source supports them, not just narrative "I did..." text), set
  abstractSource="explicit", copy that exact text into both "abstract" and
  "originalAbstract", and leave "generatedAbstract" null.
- Otherwise, write a concise academic abstract using only facts present in
  the text (never invent results, methodology, or technologies). Set
  abstractSource="generated", put your text in both "abstract" and
  "generatedAbstract", and leave "originalAbstract" null.

Respond only with the JSON object described by the schema.`;

/**
 * Standalone abstract judge/generator, usable without a full document (e.g.
 * a user pastes project text directly). Unlike extractProjectsFromDocument,
 * this always returns a result or throws — there is no sensible empty
 * fallback for "the project's abstract".
 */
export async function evaluateAndGenerateAbstract(input: {
	rawText: string;
	projectContext: string;
}): Promise<{
	abstract: string;
	abstractSource: AbstractSource;
	originalAbstract: string | null;
	generatedAbstract: string | null;
}> {
	const ai = getClient();
	if (!ai)
		throw new Error("GEMINI_API_KEY is not set — cannot evaluate abstract");

	try {
		const response = await ai.models.generateContent({
			model: MODEL,
			contents: [
				{
					role: "user",
					parts: [
						{
							text: `${ABSTRACT_EVAL_INSTRUCTIONS}\n\nPROJECT CONTEXT:\n${input.projectContext}\n\nSOURCE TEXT:\n${input.rawText}`,
						},
					],
				},
			],
			config: {
				responseMimeType: "application/json",
				responseSchema: ABSTRACT_EVAL_SCHEMA,
			},
		});

		const raw = response.text;
		if (!raw) throw new Error("empty response from Gemini");

		const parsed = JSON.parse(raw) as {
			abstract: unknown;
			abstractSource: unknown;
			originalAbstract: unknown;
			generatedAbstract: unknown;
		};

		const issues: string[] = [];
		const abstract = nullableString(parsed.abstract, "abstract", issues);
		const abstractSource = nullableAbstractSource(
			parsed.abstractSource,
			"abstractSource",
			issues,
		);
		const originalAbstract = nullableString(
			parsed.originalAbstract,
			"originalAbstract",
			issues,
		);
		const generatedAbstract = nullableString(
			parsed.generatedAbstract,
			"generatedAbstract",
			issues,
		);

		if (typeof abstract !== "string" || !abstractSource || issues.length > 0) {
			throw new Error(
				`invalid abstract evaluation response: ${issues.join("; ")}`,
			);
		}

		return {
			abstract,
			abstractSource: abstractSource as AbstractSource,
			originalAbstract: originalAbstract as string | null,
			generatedAbstract: generatedAbstract as string | null,
		};
	} catch (error) {
		console.error("gemini: evaluateAndGenerateAbstract failed", error);
		throw error;
	}
}
