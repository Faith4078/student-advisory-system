import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { projectChunk } from "../db/schema";
import {
	buildFullTextChunkDrafts,
	buildProjectChunkDrafts,
	projectFieldsToChunkSources,
} from "./chunking.server";
import { embedPassages, embedPassagesLateChunked } from "./jina.server";
import { estimateChunkPageNumbers } from "./pdf-text.server";

export type ProjectChunkFields = {
	abstract?: string | null;
	problemStatement?: string | null;
	objectives?: string[] | null;
	methodology?: string | null;
	results?: string | null;
	conclusion?: string | null;
};

/**
 * Rebuilds a project's `project_chunk` rows (content + embeddings) from its
 * current fields. Called after any create/edit so chunk-level hybrid search
 * never drifts from what the review card actually shows. Best-effort: if the
 * Jina API is unreachable, the project keeps its lexical `search_vector` but
 * loses chunk-level semantic search until the next successful save — it is
 * never left with stale chunks from a previous version of the text.
 *
 * When `fullText` is supplied (an AI-extracted project's complete verbatim
 * source transcription — see gemini.server.ts), chunks are built from that
 * full text and embedded with late chunking instead of from the six short
 * structured fields, so retrieval can surface detail those fields alone
 * never captured. Manually-entered projects (no source document, so no
 * fullText) keep the original structured-field chunking for hybrid-search
 * parity with AI-extracted ones.
 */
export async function reindexProjectChunks(input: {
	projectId: string;
	documentId: string | null;
	pageNumber: number | null;
	fields: ProjectChunkFields;
	fullText?: string | null;
	pdfBytes?: Buffer | null;
	pageRangeStart?: number | null;
	pageRangeEnd?: number | null;
}): Promise<{ chunkCount: number }> {
	const usingFullText = Boolean(input.fullText?.trim());
	const drafts = usingFullText
		? buildFullTextChunkDrafts(input.fullText as string)
		: buildProjectChunkDrafts(projectFieldsToChunkSources(input.fields));

	// Each chunk's pageNumber is independently estimated from the real PDF's
	// text when possible (see estimateChunkPageNumbers in pdf-text.server.ts)
	// instead of stamped with the project's first page for every chunk — a
	// full-text chunk from late in a multi-page project otherwise cited the
	// wrong page. Falls back to `pageNumber` for every chunk when PDF bytes
	// or the page range aren't available (manually entered projects), or if
	// extraction fails.
	const pageNumbers =
		usingFullText &&
		input.pdfBytes &&
		input.pageRangeStart != null &&
		input.pageRangeEnd != null
			? await estimateChunkPageNumbers({
					pdfBytes: input.pdfBytes,
					pageRangeStart: input.pageRangeStart,
					pageRangeEnd: input.pageRangeEnd,
					chunkContents: drafts.map((draft) => draft.content),
					fallbackPageNumber: input.pageNumber,
				})
			: drafts.map(() => input.pageNumber);

	await db
		.delete(projectChunk)
		.where(eq(projectChunk.projectId, input.projectId));

	if (drafts.length === 0) return { chunkCount: 0 };

	let embeddings: number[][];
	try {
		embeddings = usingFullText
			? await embedPassagesLateChunked(drafts.map((draft) => draft.content))
			: await embedPassages(drafts.map((draft) => draft.content));
	} catch (error) {
		console.error(
			"embedding-index: failed to embed project chunks — project has no chunk-level semantic search until the next successful save",
			input.projectId,
			error,
		);
		return { chunkCount: 0 };
	}

	await db.insert(projectChunk).values(
		drafts.map((draft, index) => ({
			id: randomUUID(),
			projectId: input.projectId,
			documentId: input.documentId,
			chunkIndex: index,
			pageNumber: pageNumbers[index] ?? null,
			sectionTitle: draft.sectionTitle,
			content: draft.content,
			embedding: embeddings[index],
		})),
	);

	return { chunkCount: drafts.length };
}
