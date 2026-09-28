// Arcjet request security wrapper (Shield WAF + rate limiting + sensitive-info
// detection) for TanStack Start server functions.
//
// This app's server functions read the incoming request as a standard Web
// `Request` via getRequest()/getRequestHeaders() from
// "@tanstack/react-start/server" (see advisor.functions.ts). @arcjet/node's
// `protect()` does NOT accept that directly — its installed type
// (`ArcjetNodeRequest`, node_modules/@arcjet/node/dist/index.d.ts) is an
// `http.IncomingMessage`-shaped object (`headers`, `socket`, `method`, `url`),
// not a Web Request. `toArcjetNodeRequest()` below adapts one to the other.
//
// Future prompt-injection wiring: once the AI advisor has agent/tool-calling
// code that pulls in retrieved documents or tool output, run
// `detectPromptInjection()` (a rule this client does not declare yet) against
// that retrieved/tool text at the point it enters the LLM context — not here,
// since `protectRequest()` only ever sees the raw HTTP request, never the
// content an agent later retrieves.

import arcjet, {
	type ArcjetDecision,
	type ArcjetNodeRequest,
	sensitiveInfo,
	shield,
	slidingWindow,
} from "@arcjet/node";

// Built as a standalone function (rather than inlined at the call site) so
// `ReturnType<typeof createClient>` below preserves the literal rule/prop
// types arcjet's `const` generics infer — assigning through the bare
// `ReturnType<typeof arcjet>` alias erases them back to the empty defaults.
function createClient(key: string) {
	return arcjet({
		key,
		characteristics: ["userId"],
		rules: [
			shield({ mode: "LIVE" }),
			// Sensitive-info detection is supported by the installed SDK
			// (arcjet 1.13.0 exports `sensitiveInfo`). It runs locally and only
			// inspects a value we pass explicitly via `sensitiveInfoValue` — see
			// `protectRequest()` below. With no value passed, nothing is scanned.
			sensitiveInfo({
				mode: "LIVE",
				deny: ["EMAIL", "PHONE_NUMBER", "CREDIT_CARD_NUMBER", "IP_ADDRESS"],
			}),
		],
	});
}

let client: ReturnType<typeof createClient> | null | undefined;
let warned = false;

function getClient() {
	if (client !== undefined) return client;
	const key = process.env.ARCJET_KEY;
	if (!key) {
		if (!warned) {
			console.warn(
				"ARCJET_KEY is not set — request security (Shield/rate limiting) is disabled.",
			);
			warned = true;
		}
		client = null;
		return client;
	}
	client = createClient(key);
	return client;
}

function toArcjetNodeRequest(request: Request): ArcjetNodeRequest {
	return {
		headers: Object.fromEntries(request.headers.entries()),
		method: request.method,
		url: request.url,
	};
}

export type ProtectRequestResult = {
	allowed: boolean;
	reason?: string;
};

export async function protectRequest(input: {
	request: Request;
	userId?: string;
	/** Value to scan for sensitive info (e.g. the raw message body), if any. */
	sensitiveInfoValue?: string;
	/** Rate limit rule; defaults are sensible for an authenticated app route. */
	limit?: { max: number; intervalSeconds: number };
}): Promise<ProtectRequestResult> {
	const aj = getClient();
	if (!aj) return { allowed: true };

	const { max = 20, intervalSeconds = 10 } = input.limit ?? {};

	try {
		const protectedClient = aj.withRule(
			slidingWindow({
				mode: "LIVE",
				interval: `${intervalSeconds}s`,
				max,
				characteristics: ["userId"],
			}),
		);

		const decision: ArcjetDecision = await protectedClient.protect(
			toArcjetNodeRequest(input.request),
			{
				userId: input.userId ?? "anonymous",
				sensitiveInfoValue: input.sensitiveInfoValue ?? null,
			},
		);

		// Log the full internal decision server-side for debugging. The
		// returned "reason" below must stay generic — never leak which rule
		// fired to the caller.
		if (decision.isDenied() || decision.isErrored()) {
			console.error("security: arcjet decision", {
				conclusion: decision.conclusion,
				reason: decision.reason,
				results: decision.results,
			});
		}

		if (decision.isDenied()) {
			if (decision.reason.isRateLimit()) {
				return { allowed: false, reason: "Rate limit exceeded" };
			}
			return { allowed: false, reason: "Request blocked" };
		}

		// isErrored() decisions fail open (still allowed) — already logged above.
		return { allowed: true };
	} catch (error) {
		console.error("security: protectRequest failed, failing open", error);
		return { allowed: true };
	}
}
