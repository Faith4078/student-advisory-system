import { createServerFn } from "@tanstack/react-start";
import {
	getRequest,
	getRequestHeaders,
	setResponseHeader,
} from "@tanstack/react-start/server";
import { auth } from "./auth";
import { createUploadTarget, processDocument } from "./ingestion.server";
import { protectRequest } from "./security.server";

type RequestUploadInput = {
	fileName: string;
	mimeType: string;
	fileSizeBytes: number;
};

type ProcessDocumentInput = {
	documentId: string;
};

async function requireUser() {
	const session = await auth.api.getSession({ headers: getRequestHeaders() });
	if (!session) throw new Error("Unauthorized");
	return session.user;
}

async function enforceRateLimit(
	userId: string,
	limit: { max: number; intervalSeconds: number },
) {
	const decision = await protectRequest({
		request: getRequest(),
		userId,
		limit,
	});
	if (!decision.allowed) throw new Error(decision.reason ?? "Request blocked.");
}

export const requestDocumentUpload = createServerFn({ method: "POST" })
	.validator((data: RequestUploadInput) => {
		const fileName = data.fileName.trim();
		if (!fileName) throw new Error("A file name is required.");
		if (data.mimeType !== "application/pdf") {
			throw new Error("Only PDF documents are supported.");
		}
		if (
			typeof data.fileSizeBytes !== "number" ||
			data.fileSizeBytes <= 0 ||
			data.fileSizeBytes > 25 * 1024 * 1024
		) {
			throw new Error(
				"File must be larger than 0 bytes and no more than 25MB.",
			);
		}
		return {
			fileName,
			mimeType: data.mimeType,
			fileSizeBytes: data.fileSizeBytes,
		};
	})
	.handler(async ({ data }) => {
		setResponseHeader("Cache-Control", "no-store");
		const user = await requireUser();
		await enforceRateLimit(user.id, { max: 10, intervalSeconds: 60 });
		return createUploadTarget({ userId: user.id, ...data });
	});

export const processUploadedDocument = createServerFn({ method: "POST" })
	.validator((data: ProcessDocumentInput) => {
		if (!data.documentId) throw new Error("A document id is required.");
		return { documentId: data.documentId };
	})
	.handler(async ({ data }) => {
		setResponseHeader("Cache-Control", "no-store");
		const user = await requireUser();
		await enforceRateLimit(user.id, { max: 10, intervalSeconds: 60 });
		return processDocument({ documentId: data.documentId, userId: user.id });
	});
