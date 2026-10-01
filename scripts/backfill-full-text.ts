// One-off maintenance script: backfills `project.full_text` for projects
// that were AI-extracted before that column existed, then re-chunks them
// with late chunking instead of the old structured-field-only chunking.
//
// Deliberately does NOT touch title/abstract/methodology/etc — only reads
// the project's already-uploaded source document and writes fullText, so it
// cannot overwrite anything a student has since reviewed or edited.
//
// Usage (from the project root):
//   node --env-file=.env scripts/backfill-full-text.ts
//
// Safe to re-run: it only processes projects where full_text is still null.

import { eq, isNull, isNotNull, and } from "drizzle-orm";
import { db } from "../src/db/index.ts";
import { document, project } from "../src/db/schema.ts";
import { reindexProjectChunks } from "../src/lib/embedding-index.server.ts";
import { transcribeProjectFullText } from "../src/lib/gemini.server.ts";
import { downloadBuffer } from "../src/lib/storage.server.ts";

async function main() {
	const candidates = await db
		.select({
			id: project.id,
			title: project.title,
			sourceDocumentId: project.sourceDocumentId,
			sourcePageRangeStart: project.sourcePageRangeStart,
			sourcePageRangeEnd: project.sourcePageRangeEnd,
			sourceSections: project.sourceSections,
			abstract: project.abstract,
			problemStatement: project.problemStatement,
			objectives: project.objectives,
			methodology: project.methodology,
			results: project.results,
			conclusion: project.conclusion,
			storageKey: document.storageKey,
			mimeType: document.mimeType,
		})
		.from(project)
		.innerJoin(document, eq(project.sourceDocumentId, document.id))
		.where(and(isNotNull(project.sourceDocumentId), isNull(project.fullText)));

	console.log(`Found ${candidates.length} project(s) to backfill.\n`);

	let succeeded = 0;
	let skipped = 0;
	let failed = 0;

	for (const row of candidates) {
		console.log(`- ${row.id}  "${row.title ?? "(untitled)"}"`);
		try {
			const fileBytes = await downloadBuffer({ key: row.storageKey });
			const fullText = await transcribeProjectFullText({
				fileBytes,
				mimeType: row.mimeType,
				title: row.title,
				sourcePageRangeStart: row.sourcePageRangeStart,
				sourcePageRangeEnd: row.sourcePageRangeEnd,
				sourceSections: row.sourceSections,
			});

			if (!fullText) {
				console.log("  skipped: transcription returned nothing usable");
				skipped++;
				continue;
			}

			await db
				.update(project)
				.set({ fullText })
				.where(eq(project.id, row.id));

			const { chunkCount } = await reindexProjectChunks({
				projectId: row.id,
				documentId: row.sourceDocumentId,
				pageNumber: row.sourcePageRangeStart,
				fields: {
					abstract: row.abstract,
					problemStatement: row.problemStatement,
					objectives: row.objectives,
					methodology: row.methodology,
					results: row.results,
					conclusion: row.conclusion,
				},
				fullText,
			});

			console.log(
				`  done: ${fullText.length} chars transcribed, ${chunkCount} late-chunked chunks`,
			);
			succeeded++;
		} catch (error) {
			console.error("  failed:", error);
			failed++;
		}
	}

	console.log(
		`\nBackfill complete: ${succeeded} succeeded, ${skipped} skipped, ${failed} failed.`,
	);
	process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
	console.error("backfill-full-text: fatal error", error);
	process.exit(1);
});
