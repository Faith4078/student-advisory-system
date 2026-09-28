import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { projectChunk } from "../db/schema";
import {
	buildProjectChunkDrafts,
	projectFieldsToChunkSources,
} from "./chunking.server";
import { embedPassages } from "./jina.server";

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
 */
export async function reindexProjectChunks(input: {
	projectId: string;
	documentId: string | null;
	pageNumber: number | null;
	fields: ProjectChunkFields;
}): Promise<{ chunkCount: number }> {
	const drafts = buildProjectChunkDrafts(
		projectFieldsToChunkSources(input.fields),
	);

	await db
		.delete(projectChunk)
		.where(eq(projectChunk.projectId, input.projectId));

	if (drafts.length === 0) return { chunkCount: 0 };

	let embeddings: number[][];
	try {
		embeddings = await embedPassages(drafts.map((draft) => draft.content));
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
			pageNumber: input.pageNumber,
			sectionTitle: draft.sectionTitle,
			content: draft.content,
			embedding: embeddings[index],
		})),
	);

	return { chunkCount: drafts.length };
}
