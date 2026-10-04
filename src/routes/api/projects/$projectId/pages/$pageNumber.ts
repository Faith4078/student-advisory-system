import { createFileRoute } from "@tanstack/react-router";
import { pdfToPng } from "pdf-to-png-converter";
import { auth } from "../../../../../lib/auth";
import { getPublicSourceDocumentForRender } from "../../../../../lib/projects.server";
import { protectRequest } from "../../../../../lib/security.server";
import { downloadBuffer } from "../../../../../lib/storage.server";

// Renders exactly one page of a published project's source PDF to a PNG and
// returns only those pixels — never the PDF itself, a download link, or the
// R2 storage key (see getPublicSourceDocumentForRender's own comment). This
// is the deliberately narrower alternative to a full in-chat PDF viewer: it
// lets a student see the exact page the AI Advisor cited without the system
// becoming a general document viewer/downloader, which Chapter 3's
// copyright and intellectual-property design explicitly treats as out of
// scope for a repository of other students' academic work.
//
// A server route (not createServerFn) because the response body here is a
// binary image with its own content type, not a JSON RPC return value.
export const Route = createFileRoute(
	"/api/projects/$projectId/pages/$pageNumber",
)({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const session = await auth.api.getSession({ headers: request.headers });
				if (!session) {
					return new Response("Unauthorized", { status: 401 });
				}

				const decision = await protectRequest({
					request,
					userId: session.user.id,
					// Rendering a PDF page is real CPU work (parse + rasterize);
					// this is deliberately tighter than an ordinary read route.
					limit: { max: 20, intervalSeconds: 60 },
				});
				if (!decision.allowed) {
					return new Response(decision.reason ?? "Request blocked.", {
						status: 429,
					});
				}

				const pageNumber = Number(params.pageNumber);
				if (!Number.isInteger(pageNumber) || pageNumber < 1) {
					return new Response("Invalid page number.", { status: 400 });
				}

				const doc = await getPublicSourceDocumentForRender(params.projectId);
				if (!doc) {
					return new Response("No source document for this project.", {
						status: 404,
					});
				}
				if (doc.pageCount && pageNumber > doc.pageCount) {
					return new Response("Page number is out of range.", { status: 400 });
				}

				let pdfBytes: Buffer;
				try {
					pdfBytes = await downloadBuffer({ key: doc.storageKey });
				} catch (error) {
					console.error("project page render: failed to download PDF", error);
					return new Response("Could not load the source document.", {
						status: 502,
					});
				}

				try {
					const [rendered] = await pdfToPng(pdfBytes, {
						pagesToProcess: [pageNumber],
						viewportScale: 2.0,
					});
					if (!rendered?.content) {
						return new Response("Could not render that page.", { status: 500 });
					}
					return new Response(new Uint8Array(rendered.content), {
						headers: {
							"Content-Type": "image/png",
							// The source PDF never changes once a project is
							// published (re-ingestion creates a new document), so
							// this is safe to cache aggressively per browser —
							// immutable, not just long-lived.
							"Cache-Control": "private, max-age=604800, immutable",
						},
					});
				} catch (error) {
					console.error("project page render: pdf-to-png failed", error);
					return new Response("Could not render that page.", { status: 500 });
				}
			},
		},
	},
});
