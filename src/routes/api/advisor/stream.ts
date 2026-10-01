import { createFileRoute } from "@tanstack/react-router";
import { streamAdvisorMessage } from "../../../lib/advisor.server";
import { auth } from "../../../lib/auth";
import { protectRequest } from "../../../lib/security.server";

type StreamRequestBody = {
	conversationId?: string;
	content?: string;
};

function sseEvent(payload: unknown): string {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

// A server route (not createServerFn) because streaming an incremental
// response body to the client is exactly what createServerFn's RPC
// call/return contract doesn't support — see start-core/server-routes.
// Session auth is checked in-handler, not via the dashboard route's
// beforeLoad, since that guard never runs for a direct request here.
export const Route = createFileRoute("/api/advisor/stream")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const session = await auth.api.getSession({ headers: request.headers });
				if (!session) {
					return new Response("Unauthorized", { status: 401 });
				}

				let body: StreamRequestBody;
				try {
					body = await request.json();
				} catch {
					return new Response("Invalid JSON body", { status: 400 });
				}

				const content = (body.content ?? "").trim();
				if (content.length < 2 || content.length > 4000) {
					return new Response(
						"Message must be between 2 and 4000 characters.",
						{ status: 400 },
					);
				}
				const conversationId =
					typeof body.conversationId === "string" && body.conversationId
						? body.conversationId
						: undefined;

				const decision = await protectRequest({
					request,
					userId: session.user.id,
					sensitiveInfoValue: content,
					limit: { max: 20, intervalSeconds: 30 },
				});
				if (!decision.allowed) {
					return new Response(decision.reason ?? "Request blocked.", {
						status: 429,
					});
				}

				const encoder = new TextEncoder();
				const user = session.user;

				const stream = new ReadableStream<Uint8Array>({
					async start(controller) {
						try {
							for await (const event of streamAdvisorMessage({
								userId: user.id,
								conversationId,
								content,
							})) {
								controller.enqueue(encoder.encode(sseEvent(event)));
							}
						} catch (error) {
							console.error("advisor stream route: unhandled error", error);
							controller.enqueue(
								encoder.encode(
									sseEvent({
										type: "error",
										message:
											"Something went wrong answering that — please try again.",
									}),
								),
							);
						} finally {
							controller.close();
						}
					},
				});

				return new Response(stream, {
					headers: {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-store",
						Connection: "keep-alive",
					},
				});
			},
		},
	},
});
