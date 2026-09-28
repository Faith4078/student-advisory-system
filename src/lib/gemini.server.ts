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

export const ProjectDraftListSchema = {
	safeParse(value: unknown): SafeParseResult<{ projects: ProjectDraft[] }> {
		const issues: string[] = [];
		if (
			typeof value !== "object" ||
			value === null ||
			!Array.isArray((value as { projects?: unknown }).projects)
		) {
			return {
				success: false,
				error: {
					message: "expected { projects: ProjectDraft[] }",
					issues: ["projects: missing or not an array"],
				},
			};
		}
		const rawProjects = (value as { projects: unknown[] }).projects;
		const projects: ProjectDraft[] = [];
		rawProjects.forEach((item, index) => {
			const draft = parseProjectDraft(item, `project[${index}]`, issues);
			if (draft) projects.push(draft);
		});
		if (issues.length > 0) {
			return {
				success: false,
				error: { message: issues.join("; "), issues },
			};
		}
		return { success: true, data: { projects } };
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
	},
	required: Object.keys(PROJECT_DRAFT_FIELDS),
};

const projectDraftListGeminiSchema = {
	type: Type.OBJECT,
	properties: {
		projects: { type: Type.ARRAY, items: projectDraftGeminiSchema },
	},
	required: ["projects"],
};

const EXTRACTION_INSTRUCTIONS = `You are extracting structured project records from an academic project/thesis
document (which may be a single project or a combined report covering several
distinct projects, e.g. a SIWES/industrial-training report).

Rules:
1. Identify every distinct project the document contains. Most documents hold
   exactly one; some hold several — return one entry per project.
2. Extract each project's fields exactly as defined by the schema.
3. Never fabricate a value the source text does not support. If a field is not
   stated or cannot be reasonably inferred from the text, return null for it —
   do not guess or invent plausible-sounding content.
4. Evaluate the abstract for each project:
   - If the document contains an explicit academic abstract that adequately
     covers the problem/purpose, approach, outcome, and significance (as far
     as the source supports them) — and is not just narrative "I participated
     in..." text — set abstractSource="explicit", put that exact text in
     originalAbstract, and copy it into abstract.
   - If no abstract exists, or the existing one is inadequate, WRITE a concise,
     academically-styled abstract using only facts present in the document (no
     invented results, technologies, or methodology). Set
     abstractSource="generated", put your written text in generatedAbstract,
     and copy it into abstract. Leave originalAbstract null in this case.
5. Populate "evidence" with a short supporting quote or reference from the
   source text for traceability, and "extractionConfidence" with your own
   confidence (0 to 1) in the overall extraction for that project.
6. Return strictly the JSON object described by the response schema.`;

/**
 * Sends document bytes (a PDF, per Gemini's native document understanding)
 * to Gemini and extracts every distinct project it contains as a
 * ProjectDraft. Returns [] if Gemini is unconfigured, or if a successful
 * response was empty/failed validation (genuinely "nothing extractable").
 * Throws if the API call itself failed (already retried internally) — that's
 * a service outage, not "this document has no projects", and callers should
 * treat it as a retryable failure rather than a content judgment.
 */
export async function extractProjectsFromDocument(input: {
	fileBytes: Buffer;
	mimeType: string;
}): Promise<ProjectDraft[]> {
	const ai = getClient();
	if (!ai) return [];
	try {
		const response = await ai.models.generateContent({
			model: MODEL,
			contents: [
				{
					role: "user",
					parts: [
						{ text: EXTRACTION_INSTRUCTIONS },
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
				responseSchema: projectDraftListGeminiSchema,
			},
		});

		const raw = response.text;
		if (!raw) {
			console.error(
				"gemini: extractProjectsFromDocument got an empty response",
			);
			return [];
		}

		const parsedJson = JSON.parse(raw);
		// Gemini's responseSchema guarantees JSON *shape*, not our app-level
		// semantic constraints (e.g. abstractSource enum, no stray fields), so
		// validate independently before trusting it.
		const result = ProjectDraftListSchema.safeParse(parsedJson);
		if (!result.success) {
			console.error(
				"gemini: extractProjectsFromDocument response failed validation",
				result.error.message,
			);
			return [];
		}
		return result.data.projects;
	} catch (error) {
		console.error("gemini: extractProjectsFromDocument failed", error);
		// A response we got back but couldn't use (empty / malformed JSON) means
		// "nothing extractable" — but a failed API call (already retried by the
		// client above) means the service itself was unreachable, which is a
		// meaningfully different failure the caller should surface distinctly
		// rather than telling the user their document had no projects in it.
		if (error instanceof ApiError && error.status >= 500) {
			throw new Error(
				"The AI document analysis service is temporarily unavailable. Please try again in a few minutes.",
			);
		}
		if (error instanceof ApiError && error.status === 429) {
			throw new Error(
				"The AI document analysis service is busy right now. Please try again shortly.",
			);
		}
		throw error instanceof Error
			? error
			: new Error("Document analysis failed.");
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
