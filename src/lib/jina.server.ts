const EMBEDDINGS_URL = "https://api.jina.ai/v1/embeddings";
const RERANK_URL = "https://api.jina.ai/v1/rerank";

const EMBEDDING_MODEL = "jina-embeddings-v3";
const RERANK_MODEL = "jina-reranker-v2-base-multilingual";

// Confirmed live against https://api.jina.ai/v1/embeddings with model
// "jina-embeddings-v3" on 2026-09-28 — a real embedQuery call returned a
// 1024-length vector. Hardcoded (not guessed) so callers can size a
// pgvector column without making a network call first.
export const EMBEDDING_DIMENSIONS = 1024;

const MAX_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 500;

function getApiKey(): string {
	const apiKey = process.env.JINA_API_KEY;
	if (!apiKey) {
		throw new Error(
			"JINA_API_KEY is not set — cannot call the Jina embeddings/rerank API.",
		);
	}
	return apiKey;
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postWithRetry(
	url: string,
	body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const apiKey = getApiKey();
	let lastError: unknown;

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			const response = await fetch(url, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			});

			if (!response.ok) {
				const text = await response.text().catch(() => "");
				// Only retry on transient/rate-limit failures — anything else
				// (bad request, auth) will fail again identically.
				const retryable = response.status === 429 || response.status >= 500;
				if (retryable && attempt < MAX_ATTEMPTS) {
					lastError = new Error(
						`Jina API request failed (${response.status}): ${text}`,
					);
					await sleep(RETRY_BACKOFF_MS * attempt);
					continue;
				}
				throw new Error(
					`Jina API request failed (${response.status}): ${text}`,
				);
			}

			return (await response.json()) as Record<string, unknown>;
		} catch (error) {
			lastError = error;
			if (attempt < MAX_ATTEMPTS) {
				await sleep(RETRY_BACKOFF_MS * attempt);
			}
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error("Jina API request failed for an unknown reason.");
}

type EmbeddingsResponse = {
	data: Array<{ index: number; embedding: number[] }>;
};

async function embed(
	texts: string[],
	task: "retrieval.passage" | "retrieval.query",
): Promise<number[][]> {
	if (texts.length === 0) return [];
	try {
		const result = (await postWithRetry(EMBEDDINGS_URL, {
			model: EMBEDDING_MODEL,
			task,
			input: texts,
		})) as EmbeddingsResponse;
		return result.data
			.slice()
			.sort((a, b) => a.index - b.index)
			.map((entry) => entry.embedding);
	} catch (error) {
		console.error("jina: failed to embed text", error);
		throw error instanceof Error
			? error
			: new Error("jina: failed to embed text");
	}
}

export async function embedPassages(texts: string[]): Promise<number[][]> {
	return embed(texts, "retrieval.passage");
}

// Jina's late-chunking mode: pass the ordered chunks of ONE document as
// `input` with `late_chunking: true`. Jina concatenates them internally,
// encodes the full concatenation with joint attention (so each chunk's
// embedding is aware of the whole document's context — resolving pronouns,
// cross-references, etc., that plain per-chunk embedding loses), then pools
// back into one embedding per input chunk. Confirmed against Jina's public
// API docs: https://jina.ai — late_chunking requires the WHOLE request's
// input tokens to stay under 8192.
const LATE_CHUNKING_MAX_CHARS_PER_BATCH = 24_000; // conservative vs the 8192-token cap; no local tokenizer to measure exactly

function batchByCharBudget(texts: string[], maxChars: number): string[][] {
	const batches: string[][] = [];
	let current: string[] = [];
	let currentChars = 0;
	for (const text of texts) {
		if (current.length > 0 && currentChars + text.length > maxChars) {
			batches.push(current);
			current = [];
			currentChars = 0;
		}
		current.push(text);
		currentChars += text.length;
	}
	if (current.length > 0) batches.push(current);
	return batches;
}

async function embedLateChunkedBatch(texts: string[]): Promise<number[][]> {
	try {
		const result = (await postWithRetry(EMBEDDINGS_URL, {
			model: EMBEDDING_MODEL,
			task: "retrieval.passage",
			late_chunking: true,
			input: texts,
		})) as EmbeddingsResponse;
		return result.data
			.slice()
			.sort((a, b) => a.index - b.index)
			.map((entry) => entry.embedding);
	} catch (error) {
		console.error("jina: failed to embed late-chunked passages", error);
		throw error instanceof Error
			? error
			: new Error("jina: failed to embed late-chunked passages");
	}
}

/**
 * Embeds the ordered chunks of a single document's full text with late
 * chunking, so each chunk's embedding carries whole-document context instead
 * of being encoded in isolation. Splits into multiple batches if the chunk
 * set would exceed Jina's per-request token budget for late chunking — a
 * project whose text spans more than one batch loses cross-batch context at
 * the seam, which is an accepted tradeoff against exceeding the hard limit.
 */
export async function embedPassagesLateChunked(
	texts: string[],
): Promise<number[][]> {
	if (texts.length === 0) return [];
	const batches = batchByCharBudget(texts, LATE_CHUNKING_MAX_CHARS_PER_BATCH);
	const results: number[][] = [];
	for (const batch of batches) {
		results.push(...(await embedLateChunkedBatch(batch)));
	}
	return results;
}

export async function embedQuery(text: string): Promise<number[]> {
	const [vector] = await embed([text], "retrieval.query");
	if (!vector) {
		throw new Error("jina: embedQuery returned no vector");
	}
	return vector;
}

type RerankResponse = {
	results: Array<{ index: number; relevance_score: number }>;
};

export async function rerank(input: {
	query: string;
	documents: string[];
	topN?: number;
}): Promise<Array<{ index: number; score: number }>> {
	if (input.documents.length === 0) return [];
	try {
		const result = (await postWithRetry(RERANK_URL, {
			model: RERANK_MODEL,
			query: input.query,
			documents: input.documents,
			top_n: input.topN ?? input.documents.length,
		})) as RerankResponse;
		return result.results.map((entry) => ({
			index: entry.index,
			score: entry.relevance_score,
		}));
	} catch (error) {
		console.error("jina: failed to rerank documents", error);
		throw error instanceof Error
			? error
			: new Error("jina: failed to rerank documents");
	}
}
