// One-off maintenance script: re-chunks every AI-extracted project (one with
// fullText) so its project_chunk rows get accurate per-chunk page numbers
// instead of the project's first page for every chunk (see
// estimateChunkPageNumbers in src/lib/pdf-text.server.ts for why this was
// wrong — this script is the backfill for projects that were already
// ingested/edited before that fix existed).
//
// Downloads each source document's PDF bytes once and reuses them for every
// project extracted from it (several projects can share one source document
// — see the page-range columns on `project`), rather than re-downloading per
// project.
//
// Usage (from the project root):
//   node --env-file=.env scripts/backfill-chunk-page-numbers.ts
//
// Safe to re-run: reindexProjectChunks always deletes + rebuilds a project's
// chunks from its current fields, so running this twice just repeats the
// same estimation.

import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../src/db/index.ts";
import { document, project } from "../src/db/schema.ts";
import { reindexProjectChunks } from "../src/lib/embedding-index.server.ts";
import { downloadBuffer } from "../src/lib/storage.server.ts";

async function main() {
	const candidates = await db
		.select({
			id: project.id,
			title: project.title,
			sourceDocumentId: project.sourceDocumentId,
			sourcePageRangeStart: project.sourcePageRangeStart,
			sourcePageRangeEnd: project.sourcePageRangeEnd,
			abstract: project.abstract,
			problemStatement: project.problemStatement,
			objectives: project.objectives,
			methodology: project.methodology,
			results: project.results,
			conclusion: project.conclusion,
			fullText: project.fullText,
			storageKey: document.storageKey,
		})
		.from(project)
		.innerJoin(document, eq(project.sourceDocumentId, document.id))
		.where(
			and(isNotNull(project.sourceDocumentId), isNotNull(project.fullText)),
		);

	console.log(`Found ${candidates.length} AI-extracted project(s) to re-chunk.\n`);

	const pdfBytesByDocumentId = new Map<string, Buffer | null>();
	let succeeded = 0;
	let failed = 0;

	for (const row of candidates) {
		console.log(`- ${row.id}  "${row.title ?? "(untitled)"}"`);
		try {
			let pdfBytes = pdfBytesByDocumentId.get(row.sourceDocumentId as string);
			if (pdfBytes === undefined) {
				pdfBytes = await downloadBuffer({ key: row.storageKey }).catch(
					(error) => {
						console.error("  failed to download source PDF:", error);
						return null;
					},
				);
				pdfBytesByDocumentId.set(row.sourceDocumentId as string, pdfBytes);
			}

			const { chunkCount } = await reindexProjectChunks({
				projectId: row.id,
				documentId: row.sourceDocumentId,
				pageNumber: row.sourcePageRangeStart,
				pdfBytes,
				pageRangeStart: row.sourcePageRangeStart,
				pageRangeEnd: row.sourcePageRangeEnd,
				fields: {
					abstract: row.abstract,
					problemStatement: row.problemStatement,
					objectives: row.objectives,
					methodology: row.methodology,
					results: row.results,
					conclusion: row.conclusion,
				},
				fullText: row.fullText,
			});

			console.log(`  done: ${chunkCount} chunks re-indexed`);
			succeeded++;
		} catch (error) {
			console.error("  failed:", error);
			failed++;
		}
	}

	console.log(`\nBackfill complete: ${succeeded} succeeded, ${failed} failed.`);
	process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
	console.error("backfill-chunk-page-numbers: fatal error", error);
	process.exit(1);
});
