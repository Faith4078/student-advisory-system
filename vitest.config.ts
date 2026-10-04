import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Integration tests under src/lib/*.test.ts talk to the real dev database
// and the real Jina API (see projects.server.test.ts) to verify actual
// search behaviour rather than mocked approximations — they need the same
// credentials the app itself uses in development, loaded from .env the way
// Vite already does for `pnpm dev`.
const env = loadEnv("development", process.cwd(), "");
for (const [key, value] of Object.entries(env)) {
	process.env[key] ??= value;
}

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		// A real hybrid search does two sequential external API round-trips
		// (Jina embed, then Jina rerank) plus several DB queries, which
		// routinely exceeds Vitest's 5s default even with no congestion.
		testTimeout: 20_000,
	},
});
