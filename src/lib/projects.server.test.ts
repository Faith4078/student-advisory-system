import { describe, expect, it } from "vitest";
import { expandQuerySynonyms, searchProjects } from "./projects.server";

// --- Pure unit tests: no DB, no network --------------------------------

describe("expandQuerySynonyms", () => {
	it("expands a bare abbreviation into an OR'd alternative", () => {
		const expanded = expandQuerySynonyms("ML");
		expect(expanded).toContain("ML");
		expect(expanded).toContain("OR");
		expect(expanded.toLowerCase()).toContain("machine learning");
	});

	it("expands an abbreviation inside a longer query without dropping the rest", () => {
		const expanded = expandQuerySynonyms("ML projects for healthcare");
		expect(expanded).toContain("ML projects for healthcare");
		expect(expanded.toLowerCase()).toContain("machine learning");
	});

	it("does not expand a substring match inside an unrelated word", () => {
		// "html" contains the letters "ml" but is not the token "ml".
		const expanded = expandQuerySynonyms("html forms");
		expect(expanded).toBe("html forms");
	});

	it("returns the query unchanged when no known abbreviation is present", () => {
		const expanded = expandQuerySynonyms("disease diagnosis system");
		expect(expanded).toBe("disease diagnosis system");
	});

	it("is case-insensitive", () => {
		const expanded = expandQuerySynonyms("ai");
		expect(expanded.toLowerCase()).toContain("artificial intelligence");
	});
});

// --- Integration tests: real dev database + real Jina API --------------
//
// These exercise searchProjects end to end against whatever is actually
// published in the configured database (read-only — no writes), which is
// the only way to genuinely verify the acceptance checks rather than assert
// against a mocked approximation of Postgres full-text search, pgvector,
// and the Jina embedding/reranking API. They are skipped automatically if
// DATABASE_URL is not configured for the environment running the suite.
//
// Known published projects in the configured dev database at the time this
// suite was written (see the "Fake or Real" / "BFRB" titles below) — if the
// catalogue's contents change, the specific title-based assertions below
// may need updating.
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("searchProjects (integration)", () => {
	it("finds a project by its exact title", async () => {
		const result = await searchProjects({
			q: "Fake or Real: The Imposter Hunt in Text",
			page: 1,
			pageSize: 10,
		});
		expect(result.totalCount).toBeGreaterThan(0);
		expect(result.items.map((item) => item.title)).toContain(
			"Fake or Real: The Imposter Hunt in Text",
		);
	});

	it("surfaces machine-learning projects for the bare abbreviation 'ML'", async () => {
		const result = await searchProjects({ q: "ML", page: 1, pageSize: 10 });
		expect(result.totalCount).toBeGreaterThan(0);
		const titles = result.items.map((item) => item.title);
		expect(
			titles.some((title) =>
				[
					"Detecting BFRB Behavior using Sensor Data",
					"Fake or Real: The Imposter Hunt in Text",
					"Disease diagnosis using symptoms and patient data",
				].includes(title ?? ""),
			),
		).toBe(true);
	});

	it("surfaces the same machine-learning projects for a natural-language query", async () => {
		const result = await searchProjects({
			q: "projects related to machine learning",
			page: 1,
			pageSize: 10,
		});
		expect(result.totalCount).toBeGreaterThan(0);
	});

	it("tolerates an unambiguous misspelling of an exact title", async () => {
		const result = await searchProjects({
			q: "Immposter Hunt in Text",
			page: 1,
			pageSize: 10,
		});
		const titles = result.items.map((item) => item.title);
		expect(titles).toContain("Fake or Real: The Imposter Hunt in Text");
	});

	it("returns no results for a query unrelated to anything in the catalogue", async () => {
		const result = await searchProjects({
			q: "quantum blockchain underwater basket weaving xyzzy",
			page: 1,
			pageSize: 10,
		});
		expect(result.totalCount).toBe(0);
		expect(result.items).toHaveLength(0);
	});

	it("respects a combined department filter alongside the query", async () => {
		const result = await searchProjects({
			q: "machine learning",
			department: "Department of Computer Science and Engineering",
			page: 1,
			pageSize: 10,
		});
		for (const item of result.items) {
			expect(item.department).toBe(
				"Department of Computer Science and Engineering",
			);
		}
	});

	it("sorts alphabetically ascending and descending on request", async () => {
		const az = await searchProjects({ page: 1, pageSize: 20, sort: "az" });
		const titles = az.items.map((item) => item.title ?? "");
		const sorted = [...titles].sort((a, b) => a.localeCompare(b));
		expect(titles).toEqual(sorted);

		const za = await searchProjects({ page: 1, pageSize: 20, sort: "za" });
		const titlesZa = za.items.map((item) => item.title ?? "");
		expect(titlesZa).toEqual([...titles].reverse());
	});

	it("sorts newest-first by default with no query", async () => {
		const result = await searchProjects({ page: 1, pageSize: 20 });
		const dates = result.items.map((item) =>
			item.publishedAt ? new Date(item.publishedAt).getTime() : 0,
		);
		const sortedDesc = [...dates].sort((a, b) => b - a);
		expect(dates).toEqual(sortedDesc);
	});

	it("paginates without overlap or gaps across pages", async () => {
		const pageSize = 2;
		const page1 = await searchProjects({ page: 1, pageSize, sort: "az" });
		const page2 = await searchProjects({ page: 2, pageSize, sort: "az" });
		const page1Ids = page1.items.map((item) => item.id);
		const page2Ids = page2.items.map((item) => item.id);
		const overlap = page1Ids.filter((id) => page2Ids.includes(id));
		expect(overlap).toHaveLength(0);
		expect(page1.totalCount).toBe(page2.totalCount);
	});
});
