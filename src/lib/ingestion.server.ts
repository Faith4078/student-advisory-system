import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { document, ingestionJob, project } from "../db/schema";
import { reindexProjectChunks } from "./embedding-index.server";
import { extractProjectsFromDocument } from "./gemini.server";
import { createUploadUrl, downloadBuffer } from "./storage.server";

const ALLOWED_MIME_TYPES = new Set(["application/pdf"]);
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export type UploadTarget = {
	documentId: string;
	uploadUrl: string;
};

export async function createUploadTarget(input: {
	userId: string;
	fileName: string;
	mimeType: string;
	fileSizeBytes: number;
}): Promise<UploadTarget> {
	if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
		throw new Error("Only PDF documents are supported.");
	}
	if (input.fileSizeBytes <= 0 || input.fileSizeBytes > MAX_FILE_SIZE_BYTES) {
		throw new Error("File must be larger than 0 bytes and no more than 25MB.");
	}

	const documentId = randomUUID();
	const safeName = input.fileName
		.replace(/[^a-zA-Z0-9.\-_]/g, "_")
		.slice(0, 120);
	const storageKey = `documents/${input.userId}/${documentId}-${safeName}`;

	const uploadUrl = await createUploadUrl({
		key: storageKey,
		contentType: input.mimeType,
	});

	await db.insert(document).values({
		id: documentId,
		uploadedByUserId: input.userId,
		fileName: input.fileName,
		mimeType: input.mimeType,
		fileSizeBytes: input.fileSizeBytes,
		storageKey,
	});

	return { documentId, uploadUrl };
}

export type ProcessDocumentResult = {
	jobId: string;
	status: "completed" | "failed";
	projectIds: string[];
	errorMessage: string | null;
};

/**
 * Runs Gemini document understanding + multi-project extraction for an
 * already-uploaded document, and creates one draft `project` row per detected
 * project. Idempotent: if the document's latest job already completed, its
 * existing projects are returned rather than re-extracting (so retrying a
 * failed job never creates duplicates, and re-processing a completed one is
 * a safe no-op).
 */
export async function processDocument(input: {
	documentId: string;
	userId: string;
}): Promise<ProcessDocumentResult> {
	const [doc] = await db
		.select()
		.from(document)
		.where(
			and(
				eq(document.id, input.documentId),
				eq(document.uploadedByUserId, input.userId),
			),
		)
		.limit(1);
	if (!doc) throw new Error("Document not found.");

	const [latestJob] = await db
		.select()
		.from(ingestionJob)
		.where(eq(ingestionJob.documentId, doc.id))
		.orderBy(desc(ingestionJob.createdAt))
		.limit(1);

	if (latestJob?.status === "completed") {
		const existing = await db
			.select({ id: project.id })
			.from(project)
			.where(eq(project.sourceIngestionJobId, latestJob.id));
		return {
			jobId: latestJob.id,
			status: "completed",
			projectIds: existing.map((row) => row.id),
			errorMessage: null,
		};
	}
	if (latestJob?.status === "processing") {
		throw new Error("This document is already being processed.");
	}

	const jobId = randomUUID();
	await db.insert(ingestionJob).values({
		id: jobId,
		documentId: doc.id,
		status: "processing",
		attempts: (latestJob?.attempts ?? 0) + 1,
		startedAt: new Date(),
	});

	try {
		const fileBytes = await downloadBuffer({ key: doc.storageKey });
		const drafts = await extractProjectsFromDocument({
			fileBytes,
			mimeType: doc.mimeType,
		});

		if (drafts.length === 0) {
			const errorMessage = "No projects could be identified in this document.";
			await db
				.update(ingestionJob)
				.set({ status: "failed", errorMessage, completedAt: new Date() })
				.where(eq(ingestionJob.id, jobId));
			return { jobId, status: "failed", projectIds: [], errorMessage };
		}

		const projectIds = await db.transaction(async (tx) => {
			const ids: string[] = [];
			for (const draft of drafts) {
				const id = randomUUID();
				ids.push(id);
				await tx.insert(project).values({
					id,
					createdByUserId: input.userId,
					sourceDocumentId: doc.id,
					sourceIngestionJobId: jobId,
					sourcePageRangeStart: draft.sourcePageRangeStart,
					sourcePageRangeEnd: draft.sourcePageRangeEnd,
					sourceSections: draft.sourceSections,
					title: draft.title,
					author: draft.author,
					department: draft.department,
					faculty: draft.faculty,
					projectType: draft.projectType,
					researchArea: draft.researchArea,
					keywords: draft.keywords,
					technologies: draft.technologies,
					problemStatement: draft.problemStatement,
					objectives: draft.objectives,
					methodology: draft.methodology,
					results: draft.results,
					conclusion: draft.conclusion,
					projectYear: draft.projectYear,
					abstract: draft.abstract,
					abstractSource: draft.abstractSource,
					originalAbstract: draft.originalAbstract,
					generatedAbstract: draft.generatedAbstract,
					extractionConfidence: draft.extractionConfidence,
					extractionEvidence: draft.evidence
						? { evidence: draft.evidence }
						: null,
					fullText: draft.fullText,
					status: "draft",
				});
			}
			return ids;
		});

		// Chunk + embed each new project's fields for hybrid search. Done after
		// the transaction (not inside it) since this makes real network calls
		// to Jina and shouldn't hold a DB transaction open while it retries.
		await Promise.all(
			projectIds.map((id, index) => {
				const draft = drafts[index];
				return reindexProjectChunks({
					projectId: id,
					documentId: doc.id,
					pageNumber: draft.sourcePageRangeStart,
					pdfBytes: fileBytes,
					pageRangeStart: draft.sourcePageRangeStart,
					pageRangeEnd: draft.sourcePageRangeEnd,
					fields: {
						abstract: draft.abstract,
						problemStatement: draft.problemStatement,
						objectives: draft.objectives,
						methodology: draft.methodology,
						results: draft.results,
						conclusion: draft.conclusion,
					},
					fullText: draft.fullText,
				});
			}),
		);

		await db
			.update(ingestionJob)
			.set({ status: "completed", completedAt: new Date() })
			.where(eq(ingestionJob.id, jobId));

		return { jobId, status: "completed", projectIds, errorMessage: null };
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Document processing failed.";
		console.error("ingestion: processDocument failed", error);
		await db
			.update(ingestionJob)
			.set({ status: "failed", errorMessage, completedAt: new Date() })
			.where(eq(ingestionJob.id, jobId));
		return { jobId, status: "failed", projectIds: [], errorMessage };
	}
}
