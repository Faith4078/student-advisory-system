import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { getContext } from "./integrations/tanstack-query/root-provider";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const context = getContext();

	const router = createTanStackRouter({
		routeTree,
		context,
		scrollRestoration: true,
		defaultPreload: "intent",
		// 0 here means "a preload is immediately stale" — which defeats hover
		// intent preloading everywhere in the app: by the time a hovered Link
		// is actually clicked, the router treats its just-finished preload as
		// already expired and the navigation waits on a fresh fetch anyway, so
		// nothing ever actually feels instant. 0 is the right value only when a
		// route's own loader defers to an external cache (TanStack Query's
		// ensureQueryData/useSuspenseQuery) for staleness — no route in this
		// app does that; every loader just awaits its server functions
		// directly, so the router's own SWR cache is the only caching that
		// exists, and a real preload window (the library's own default) is what
		// makes hover-to-preload actually pay off.
		defaultPreloadStaleTime: 30_000,
	});

	setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient });

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
