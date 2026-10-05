import { createFileRoute } from "@tanstack/react-router";
import { auth } from "../../../../lib/auth";
import { getPublicSourceDocumentForRender } from "../../../../lib/projects.server";
import { protectRequest } from "../../../../lib/security.server";
import { downloadBuffer } from "../../../../lib/storage.server";

// Serves a published project's full source PDF for inline viewing (e.g. the
// AI Advisor's in-chat document viewer, opened to a cited page via the URL's
// #page= fragment). Viewing is always allowed for a published project — it's
// the same report a reader could already see page-by-page through the
// citation viewer. Only *downloading* a copy (?download=1) additionally
// requires the project's author to have opted in via `allowDownload` (see
// the checkbox in project-form.tsx) — a request for that without the flag
// set is refused rather than silently served inline, so the client can tell
// the two cases apart.
export const Route = createFileRoute("/api/projects/$projectId/document")({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const session = await auth.api.getSession({ headers: request.headers });
				if (!session) return new Response("Unauthorized", { status: 401 });

				const decision = await protectRequest({
					request,
					userId: session.user.id,
					limit: { max: 15, intervalSeconds: 60 },
				});
				if (!decision.allowed) {
					return new Response(decision.reason ?? "Request blocked.", {
						status: 429,
					});
				}

				const doc = await getPublicSourceDocumentForRender(params.projectId);
				if (!doc) {
					return new Response("No source document for this project.", {
						status: 404,
					});
				}

				const wantsDownload =
					new URL(request.url).searchParams.get("download") === "1";
				if (wantsDownload && !doc.allowDownload) {
					return new Response(
						"The author of this project hasn't enabled downloads for it.",
						{ status: 403 },
					);
				}

				let pdfBytes: Buffer;
				try {
					pdfBytes = await downloadBuffer({ key: doc.storageKey });
				} catch (error) {
					console.error(
						"project document route: failed to download PDF",
						error,
					);
					return new Response("Could not load the source document.", {
						status: 502,
					});
				}

				const safeFileName = (doc.fileName || "report.pdf").replace(
					/[^a-zA-Z0-9.\-_ ]/g,
					"_",
				);
				return new Response(new Uint8Array(pdfBytes), {
					headers: {
						"Content-Type": "application/pdf",
						"Content-Disposition": `${wantsDownload ? "attachment" : "inline"}; filename="${safeFileName}"`,
						"Cache-Control": "private, max-age=604800, immutable",
					},
				});
			},
		},
	},
});
