import { randomUUID } from "node:crypto";
import {
	and,
	arrayContains,
	asc,
	count,
	desc,
	eq,
	inArray,
	sql,
} from "drizzle-orm";
import { db } from "../db";
import { document, project, projectChunk, projectLink } from "../db/schema";
import { buildSearchCacheKey, cacheAside } from "./cache.server";
import { reindexProjectChunks } from "./embedding-index.server";
import { embedQuery, rerank } from "./jina.server";
import { downloadBuffer } from "./storage.server";

export type ProjectSortOption = "relevance" | "newest" | "az" | "za";

export type ProjectSearchFilters = {
	q?: string;
	department?: string;
	faculty?: string;
	projectType?: string;
	researchArea?: string;
	technology?: string;
	year?: number;
	sort?: ProjectSortOption;
	page: number;
	pageSize: number;
};

export type ProjectSearchResultItem = {
	id: string;
	title: string | null;
	abstract: string | null;
	author: string | null;
	department: string | null;
	faculty: string | null;
	projectType: string | null;
	researchArea: string | null;
	technologies: string[] | null;
	projectYear: number | null;
	publishedAt: string | null;
};

export type ProjectFilterOptions = {
	departments: string[];
	faculties: string[];
	projectTypes: string[];
	researchAreas: string[];
	technologies: string[];
	years: number[];
};

const PROJECT_SUMMARY_COLUMNS = {
	id: project.id,
	title: project.title,
	abstract: project.abstract,
	author: project.author,
	department: project.department,
	faculty: project.faculty,
	projectType: project.projectType,
	researchArea: project.researchArea,
	technologies: project.technologies,
	projectYear: project.projectYear,
	publishedAt: project.publishedAt,
};

function toSummary(row: {
	id: string;
	title: string | null;
	abstract: string | null;
	author: string | null;
	department: string | null;
	faculty: string | null;
	projectType: string | null;
	researchArea: string | null;
	technologies: string[] | null;
	projectYear: number | null;
	publishedAt: Date | null;
}): ProjectSearchResultItem {
	return {
		...row,
		publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
	};
}

function buildStructuredConditions(
	filters: Omit<ProjectSearchFilters, "q" | "page" | "pageSize">,
) {
	const conditions = [eq(project.status, "published")];
	if (filters.department)
		conditions.push(eq(project.department, filters.department));
	if (filters.faculty) conditions.push(eq(project.faculty, filters.faculty));
	if (filters.projectType)
		conditions.push(eq(project.projectType, filters.projectType));
	if (filters.researchArea)
		conditions.push(eq(project.researchArea, filters.researchArea));
	if (filters.year) conditions.push(eq(project.projectYear, filters.year));
	if (filters.technology) {
		conditions.push(arrayContains(project.technologies, [filters.technology]));
	}
	return conditions;
}

/** Reciprocal Rank Fusion: merges N best-first-ranked id lists into one score per id. */
function reciprocalRankFusion(
	rankedLists: string[][],
	k = 60,
): Map<string, number> {
	const scores = new Map<string, number>();
	for (const list of rankedLists) {
		list.forEach((id, rank) => {
			scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
		});
	}
	return scores;
}

function toVectorLiteral(vector: number[]): string {
	return `[${vector.join(",")}]`;
}

// A small, explicit abbreviation/synonym dictionary for the lexical search
// path only. Postgres full-text search has no built-in notion that "ML"
// means "machine learning" — a custom thesaurus dictionary would need a
// rules file placed on the database server's filesystem, which a managed,
// serverless Postgres host (this project runs on Neon) does not expose, so
// that route is not available here. Expanding known abbreviations in the
// application layer before building the tsquery costs nothing (a plain
// object lookup, no network call, no added latency) and keeps lexical
// coverage from depending entirely on whether the embedding model happens
// to treat a short, ambiguous acronym as similar to its expansion.
const QUERY_SYNONYMS: Record<string, string[]> = {
	ml: ["machine learning"],
	ai: ["artificial intelligence"],
	nlp: ["natural language processing"],
	cv: ["computer vision"],
	iot: ["internet of things"],
	ui: ["user interface"],
	ux: ["user experience"],
	db: ["database"],
	os: ["operating system"],
	api: ["application programming interface"],
	hci: ["human computer interaction"],
	ar: ["augmented reality"],
	vr: ["virtual reality"],
	dl: ["deep learning"],
	cnn: ["convolutional neural network"],
	rnn: ["recurrent neural network"],
	nn: ["neural network"],
	devops: ["development operations"],
};

/**
 * Expands recognised whole-word abbreviations in a free-text query into an
 * OR'd set of alternatives for `websearch_to_tsquery`, so a bare acronym
 * like "ML" also matches projects whose text spells out "machine learning"
 * rather than depending solely on semantic embeddings to bridge the gap.
 * Only whole tokens are matched — a substring like "ml" inside "html" is
 * left untouched. The original query is always preserved as one of the
 * disjuncts, so this only ever widens the lexical match, never narrows it.
 */
export function expandQuerySynonyms(query: string): string {
	const tokens = query.trim().split(/\s+/).filter(Boolean);
	const expansions = new Set<string>();
	for (const token of tokens) {
		const key = token.toLowerCase().replace(/[^a-z0-9]/g, "");
		for (const synonym of QUERY_SYNONYMS[key] ?? []) {
			expansions.add(synonym);
		}
	}
	if (expansions.size === 0) return query;
	return `${query} OR ${Array.from(expansions).join(" OR ")}`;
}

/**
 * Replaces (not appends) recognised abbreviations with their expansion, for
 * sending to the Jina reranker rather than to `websearch_to_tsquery`. The
 * reranker is a neural cross-encoder, not a query parser — it has no notion
 * of `websearch_to_tsquery`'s "OR" syntax, and empirically scores a query
 * that mixes an acronym with its spelled-out form *lower* than the spelled-
 * out form alone (verified against the real Jina API: "ML machine learning"
 * scored every candidate lower than plain "machine learning" did). A query
 * with no recognised abbreviation is returned unchanged.
 */
export function expandQueryForReranking(query: string): string {
	const tokens = query.trim().split(/\s+/).filter(Boolean);
	return tokens
		.map((token) => {
			const key = token.toLowerCase().replace(/[^a-z0-9]/g, "");
			const [firstSynonym] = QUERY_SYNONYMS[key] ?? [];
			return firstSynonym ?? token;
		})
		.join(" ");
}

const SEMANTIC_CANDIDATE_LIMIT = 40;
const LEXICAL_CANDIDATE_LIMIT = 40;
const FUZZY_CANDIDATE_LIMIT = 20;
// pg_trgm similarity ranges 0 (no shared trigrams) to 1 (identical strings).
// This is deliberately permissive compared to pg_trgm's own default (0.3):
// an unambiguous single-letter typo in a longer title can still fall below
// 0.3, and this candidate list is only ever a third input to RRF plus a
// reranker pass, not a result on its own, so a looser net here is corrected
// downstream rather than causing false positives.
const MIN_TITLE_SIMILARITY = 0.2;
const RERANK_TOP_N = 20;
// Cosine distance ranges 0 (identical) to 2 (opposite); 1 is orthogonal
// ("unrelated"). Candidates farther than this are not meaningfully related to
// the query and must not be treated as search results just because they were
// the *closest available* vectors — nearest-neighbour search always returns
// `limit` rows regardless of whether any of them are actually relevant.
const SEMANTIC_DISTANCE_THRESHOLD = 0.6;
// jina-reranker-v2 relevance_score is a per-document relevance probability in
// [0, 1]. A candidate the reranker itself scores below this bar is judged
// irrelevant to the query and must be dropped, not merely reordered.
const MIN_RERANK_SCORE = 0.3;
// v2: candidate lists gained synonym-expanded lexical terms and fuzzy title
// matches. v3: the reranker is now given the same abbreviation expansion
// (e.g. "machine learning" instead of a bare "ML") rather than the raw
// query, since it otherwise scores an unexpanded acronym too low against
// every candidate to clear MIN_RERANK_SCORE. Each bump invalidates the
// previous version's cached rankings rather than reusing them.
const RETRIEVAL_VERSION = "hybrid-rrf-v3";
const EMBEDDING_VERSION = "jina-embeddings-v3";
const RERANKER_VERSION = "jina-reranker-v2-base-multilingual";

async function fetchLexicalCandidateIds(
	where: ReturnType<typeof and>,
	query: string,
	limit: number,
): Promise<string[]> {
	const expandedQuery = expandQuerySynonyms(query);
	const rows = await db
		.select({ id: project.id })
		.from(project)
		.where(
			and(
				where,
				sql`${project.searchVector} @@ websearch_to_tsquery('english', ${expandedQuery})`,
			),
		)
		.orderBy(
			desc(
				sql`ts_rank(${project.searchVector}, websearch_to_tsquery('english', ${expandedQuery}))`,
			),
		)
		.limit(limit);
	return rows.map((row) => row.id);
}

/**
 * Trigram-similarity candidates against project titles only — the field
 * where an unambiguous misspelling most plausibly still identifies a single
 * intended project. Not a general-purpose fuzzy search over every field:
 * trigram similarity over long free-text fields (abstract, methodology)
 * produces too many coincidental matches to be useful as a relevance signal.
 */
async function fetchFuzzyTitleCandidateIds(
	where: ReturnType<typeof and>,
	query: string,
	limit: number,
): Promise<string[]> {
	const similarity = sql<number>`similarity(${project.title}, ${query})`;
	const rows = await db
		.select({ id: project.id })
		.from(project)
		.where(
			and(
				where,
				sql`${project.title} is not null`,
				sql`${similarity} >= ${MIN_TITLE_SIMILARITY}`,
			),
		)
		.orderBy(desc(similarity))
		.limit(limit);
	return rows.map((row) => row.id);
}

async function fetchSemanticCandidateIds(
	where: ReturnType<typeof and>,
	queryVector: number[],
	limit: number,
): Promise<string[]> {
	const vectorLiteral = toVectorLiteral(queryVector);
	const distance = sql`min(${projectChunk.embedding} <=> ${vectorLiteral}::vector)`;
	const rows = await db
		.select({ id: project.id })
		.from(projectChunk)
		.innerJoin(project, eq(projectChunk.projectId, project.id))
		.where(and(where, sql`${projectChunk.embedding} is not null`))
		.groupBy(project.id)
		.having(sql`${distance} < ${SEMANTIC_DISTANCE_THRESHOLD}`)
		.orderBy(distance)
		.limit(limit);
	return rows.map((row) => row.id);
}

/**
 * Ranks candidate project ids for a free-text query via hybrid retrieval:
 * Postgres full-text search (lexical) + Jina-embedded pgvector similarity
 * (semantic) over `project_chunk`, merged with Reciprocal Rank Fusion, then
 * re-ordered by the Jina reranker on the top slice. The ranked id list (not
 * the project rows) is cached — content is always re-read fresh from the DB,
 * only the expensive ranking (2 external API calls) is cached.
 */
async function rankProjectsByQuery(
	where: ReturnType<typeof and>,
	filters: Omit<ProjectSearchFilters, "page" | "pageSize" | "sort"> & {
		q: string;
	},
): Promise<string[]> {
	const cacheKey = buildSearchCacheKey({
		query: filters.q,
		// `sort` deliberately excluded by the parameter type above: it changes
		// display order only, never which projects count as matches, so it
		// must not fragment this cache.
		filters: { ...filters, q: undefined },
		// Ranking is independent of pagination — page/pageSize are fixed
		// placeholders here so every page of the same query shares one cache
		// entry; pagination is applied after this cached list is read.
		page: 0,
		pageSize: 0,
		retrievalVersion: RETRIEVAL_VERSION,
		embeddingVersion: EMBEDDING_VERSION,
		rerankerVersion: RERANKER_VERSION,
	});

	return cacheAside({
		key: cacheKey,
		ttlSeconds: 300,
		compute: async () => {
			const [lexicalIds, semanticIds, fuzzyIds] = await Promise.all([
				fetchLexicalCandidateIds(where, filters.q, LEXICAL_CANDIDATE_LIMIT),
				embedQuery(filters.q)
					.then((vector) =>
						fetchSemanticCandidateIds(where, vector, SEMANTIC_CANDIDATE_LIMIT),
					)
					.catch((error) => {
						// Semantic search degrades to lexical-only rather than failing
						// the whole search if Jina is unreachable.
						console.error(
							"projects: semantic candidate retrieval failed, falling back to lexical-only",
							error,
						);
						return [] as string[];
					}),
				fetchFuzzyTitleCandidateIds(
					where,
					filters.q,
					FUZZY_CANDIDATE_LIMIT,
				).catch((error) => {
					console.error(
						"projects: fuzzy title candidate retrieval failed, continuing without it",
						error,
					);
					return [] as string[];
				}),
			]);

			const fused = reciprocalRankFusion([lexicalIds, semanticIds, fuzzyIds]);
			const fusedIds = Array.from(fused.entries())
				.sort((a, b) => b[1] - a[1])
				.map(([id]) => id);

			if (fusedIds.length === 0) return fusedIds;

			const rerankHead = fusedIds.slice(0, RERANK_TOP_N);

			try {
				const headRows = await db
					.select({
						id: project.id,
						title: project.title,
						abstract: project.abstract,
					})
					.from(project)
					.where(inArray(project.id, rerankHead));
				const rowById = new Map(headRows.map((row) => [row.id, row]));
				const orderedHeadRows = rerankHead
					.map((id) => rowById.get(id))
					.filter((row): row is NonNullable<typeof row> => Boolean(row));

				const documents = orderedHeadRows.map(
					(row) =>
						`${row.title ?? ""}\n${row.abstract ?? ""}`.trim() || "(untitled)",
				);
				const reranked = await rerank({
					query: expandQueryForReranking(filters.q),
					documents,
				});

				// Distinguish "the reranker scored this below the relevance bar"
				// (drop it — it is not a match) from "the reranker didn't return a
				// score for this id at all" (a degenerate API response, not a
				// relevance judgment — keep it defensively, in fused order).
				const scoredIds = new Set(
					reranked
						.map((entry) => orderedHeadRows[entry.index]?.id)
						.filter((id): id is string => Boolean(id)),
				);
				const relevantRerankedIds = reranked
					.filter((entry) => entry.score >= MIN_RERANK_SCORE)
					.map((entry) => orderedHeadRows[entry.index]?.id)
					.filter((id): id is string => Boolean(id));
				const missingFromReranker = rerankHead.filter(
					(id) => !scoredIds.has(id),
				);
				// rerankTail (beyond RERANK_TOP_N) is intentionally dropped, not
				// appended: those candidates were never relevance-checked by the
				// reranker, so including them unconditionally is what previously
				// made "search results" degrade into "every published project."
				return [...relevantRerankedIds, ...missingFromReranker];
			} catch (error) {
				console.error(
					"projects: reranking failed, keeping RRF fusion order",
					error,
				);
				return fusedIds;
			}
		},
	});
}

/** `sort` column for a direct DB query; "relevance" has no DB-level meaning (it only makes sense relative to a query's rank order), so it falls back to newest-first, matching the no-query default. */
function sortColumnFor(sort: ProjectSortOption | undefined) {
	switch (sort) {
		case "az":
			return asc(project.title);
		case "za":
			return desc(project.title);
		default:
			return desc(project.publishedAt);
	}
}

/**
 * Hybrid search over PUBLISHED projects: structured filters always apply;
 * a free-text query additionally ranks results via lexical + semantic +
 * fuzzy-title retrieval fused with RRF and reranked (see
 * `rankProjectsByQuery`). With no query, results are just filtered and
 * sorted. `sort` controls display order; with an active query it still only
 * reorders the set of projects the query actually matched — it does not
 * change which projects count as a match.
 */
export async function searchProjects(filters: ProjectSearchFilters): Promise<{
	items: ProjectSearchResultItem[];
	totalCount: number;
}> {
	const structuredConditions = buildStructuredConditions(filters);
	const where = and(...structuredConditions);
	const query = filters.q?.trim();
	const sort = filters.sort ?? "relevance";
	const offset = (filters.page - 1) * filters.pageSize;

	if (!query) {
		const [items, [{ count }]] = await Promise.all([
			db
				.select(PROJECT_SUMMARY_COLUMNS)
				.from(project)
				.where(where)
				.orderBy(sortColumnFor(sort))
				.limit(filters.pageSize)
				.offset(offset),
			db
				.select({ count: sql<number>`count(*)::int` })
				.from(project)
				.where(where),
		]);
		return { items: items.map(toSummary), totalCount: count };
	}

	const { sort: _sort, ...rankingFilters } = filters;
	const rankedIds = await rankProjectsByQuery(where, {
		...rankingFilters,
		q: query,
	});

	if (rankedIds.length === 0) {
		return { items: [], totalCount: 0 };
	}

	if (sort === "relevance") {
		const pageIds = rankedIds.slice(offset, offset + filters.pageSize);
		if (pageIds.length === 0) {
			return { items: [], totalCount: rankedIds.length };
		}
		const rows = await db
			.select(PROJECT_SUMMARY_COLUMNS)
			.from(project)
			.where(inArray(project.id, pageIds));
		const rowById = new Map(rows.map((row) => [row.id, row]));
		const items = pageIds
			.map((id) => rowById.get(id))
			.filter((row): row is NonNullable<typeof row> => Boolean(row))
			.map(toSummary);
		return { items, totalCount: rankedIds.length };
	}

	// A non-relevance sort still uses the query to decide which projects
	// match (rankedIds), but re-orders that matched set by the chosen field
	// instead of by relevance rank, so pagination is applied after sorting
	// rather than by slicing the rank-ordered id list.
	const rows = await db
		.select(PROJECT_SUMMARY_COLUMNS)
		.from(project)
		.where(inArray(project.id, rankedIds))
		.orderBy(sortColumnFor(sort));
	const items = rows.slice(offset, offset + filters.pageSize).map(toSummary);
	return { items, totalCount: rankedIds.length };
}

export async function getProjectFilterOptions(): Promise<ProjectFilterOptions> {
	const [
		departments,
		faculties,
		projectTypes,
		researchAreas,
		technologies,
		years,
	] = await Promise.all([
		db
			.selectDistinct({ value: project.department })
			.from(project)
			.where(
				and(
					eq(project.status, "published"),
					sql`${project.department} is not null`,
				),
			),
		db
			.selectDistinct({ value: project.faculty })
			.from(project)
			.where(
				and(
					eq(project.status, "published"),
					sql`${project.faculty} is not null`,
				),
			),
		db
			.selectDistinct({ value: project.projectType })
			.from(project)
			.where(
				and(
					eq(project.status, "published"),
					sql`${project.projectType} is not null`,
				),
			),
		db
			.selectDistinct({ value: project.researchArea })
			.from(project)
			.where(
				and(
					eq(project.status, "published"),
					sql`${project.researchArea} is not null`,
				),
			),
		db.execute<{ value: string }>(sql`
				select distinct unnest(technologies) as value
				from project
				where status = 'published' and technologies is not null
			`),
		db
			.selectDistinct({ value: project.projectYear })
			.from(project)
			.where(
				and(
					eq(project.status, "published"),
					sql`${project.projectYear} is not null`,
				),
			),
	]);

	return {
		departments: departments.map((r) => r.value as string).sort(),
		faculties: faculties.map((r) => r.value as string).sort(),
		projectTypes: projectTypes.map((r) => r.value as string).sort(),
		researchAreas: researchAreas.map((r) => r.value as string).sort(),
		technologies: Array.from(technologies)
			.map((r) => r.value)
			.sort(),
		years: years.map((r) => r.value as number).sort((a, b) => b - a),
	};
}

// --- Draft / manual entry / publish workflow -------------------------------
// AI-extracted and manually-entered projects converge on this same set of
// functions and the same `project` row shape — there is no separate manual
// domain model.

export type ProjectInput = {
	title: string | null;
	author: string | null;
	department: string | null;
	faculty: string | null;
	projectType: string | null;
	researchArea: string | null;
	keywords: string[];
	technologies: string[];
	problemStatement: string | null;
	objectives: string[];
	methodology: string | null;
	results: string | null;
	conclusion: string | null;
	projectYear: number | null;
	abstract: string | null;
	allowDownload: boolean;
};

const PROJECT_STATUSES = [
	"draft",
	"ready_to_publish",
	"published",
	"archived",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export async function createManualProject(
	input: { userId: string } & ProjectInput,
): Promise<{ id: string }> {
	const id = randomUUID();
	await db.insert(project).values({
		id,
		createdByUserId: input.userId,
		title: input.title,
		author: input.author,
		department: input.department,
		faculty: input.faculty,
		projectType: input.projectType,
		researchArea: input.researchArea,
		keywords: input.keywords,
		technologies: input.technologies,
		problemStatement: input.problemStatement,
		objectives: input.objectives,
		methodology: input.methodology,
		results: input.results,
		conclusion: input.conclusion,
		projectYear: input.projectYear,
		abstract: input.abstract,
		allowDownload: input.allowDownload,
		status: "draft",
	});
	await reindexProjectChunks({
		projectId: id,
		documentId: null,
		pageNumber: null,
		fields: input,
	});
	return { id };
}

export async function listOwnedProjects(input: { userId: string }) {
	return db
		.select({
			id: project.id,
			title: project.title,
			status: project.status,
			department: project.department,
			projectYear: project.projectYear,
			sourceDocumentId: project.sourceDocumentId,
			updatedAt: project.updatedAt,
		})
		.from(project)
		.where(eq(project.createdByUserId, input.userId))
		.orderBy(desc(project.updatedAt));
}

export async function getOwnedProject(input: {
	userId: string;
	projectId: string;
}) {
	const [row] = await db
		.select()
		.from(project)
		.where(
			and(
				eq(project.id, input.projectId),
				eq(project.createdByUserId, input.userId),
			),
		)
		.limit(1);
	if (!row) return null;

	const links = await db
		.select()
		.from(projectLink)
		.where(eq(projectLink.projectId, input.projectId));

	return { ...row, links };
}

export async function updateProject(
	input: { userId: string; projectId: string } & Partial<ProjectInput>,
): Promise<void> {
	const { userId, projectId, ...fields } = input;
	const [updated] = await db
		.update(project)
		.set(fields)
		.where(and(eq(project.id, projectId), eq(project.createdByUserId, userId)))
		.returning({
			sourceDocumentId: project.sourceDocumentId,
			sourcePageRangeStart: project.sourcePageRangeStart,
			sourcePageRangeEnd: project.sourcePageRangeEnd,
			abstract: project.abstract,
			problemStatement: project.problemStatement,
			objectives: project.objectives,
			methodology: project.methodology,
			results: project.results,
			conclusion: project.conclusion,
			fullText: project.fullText,
		});
	if (!updated) return;

	// Re-download the source PDF so chunks keep accurate per-chunk page
	// numbers after an edit (see estimateChunkPageNumbers in
	// pdf-text.server.ts) — best-effort: a download failure just falls back
	// to the project's first page for every chunk, same as before this was
	// added, rather than blocking the save.
	let pdfBytes: Buffer | null = null;
	if (updated.sourceDocumentId) {
		try {
			const [doc] = await db
				.select({ storageKey: document.storageKey })
				.from(document)
				.where(eq(document.id, updated.sourceDocumentId))
				.limit(1);
			if (doc) pdfBytes = await downloadBuffer({ key: doc.storageKey });
		} catch (error) {
			console.error(
				"updateProject: failed to re-download source PDF for page-accurate chunking",
				projectId,
				error,
			);
		}
	}

	// Pass fullText through so editing an AI-extracted project's fields (e.g.
	// correcting the abstract) re-chunks from its full verbatim source text
	// again, rather than silently dropping back to the shorter structured-
	// field chunking the first edit would otherwise cause.
	await reindexProjectChunks({
		projectId,
		documentId: updated.sourceDocumentId,
		pageNumber: updated.sourcePageRangeStart,
		pdfBytes,
		pageRangeStart: updated.sourcePageRangeStart,
		pageRangeEnd: updated.sourcePageRangeEnd,
		fields: updated,
		fullText: updated.fullText,
	});
}

export async function setProjectStatus(input: {
	userId: string;
	projectId: string;
	status: ProjectStatus;
}): Promise<void> {
	await db
		.update(project)
		.set({
			status: input.status,
			publishedAt: input.status === "published" ? new Date() : null,
		})
		.where(
			and(
				eq(project.id, input.projectId),
				eq(project.createdByUserId, input.userId),
			),
		);
}

export async function deleteProject(input: {
	userId: string;
	projectId: string;
}): Promise<void> {
	await db
		.delete(project)
		.where(
			and(
				eq(project.id, input.projectId),
				eq(project.createdByUserId, input.userId),
			),
		);
}

const PROJECT_LINK_TYPES = [
	"github",
	"live",
	"demo",
	"social",
	"other",
] as const;
export type ProjectLinkType = (typeof PROJECT_LINK_TYPES)[number];

export async function addProjectLink(input: {
	userId: string;
	projectId: string;
	type: ProjectLinkType;
	url: string;
	label?: string | null;
}): Promise<{ id: string }> {
	const owned = await getOwnedProject({
		userId: input.userId,
		projectId: input.projectId,
	});
	if (!owned) throw new Error("Project not found.");

	const id = randomUUID();
	await db.insert(projectLink).values({
		id,
		projectId: input.projectId,
		type: input.type,
		url: input.url,
		label: input.label ?? null,
	});
	return { id };
}

export async function removeProjectLink(input: {
	userId: string;
	projectId: string;
	linkId: string;
}): Promise<void> {
	const owned = await getOwnedProject({
		userId: input.userId,
		projectId: input.projectId,
	});
	if (!owned) throw new Error("Project not found.");

	await db
		.delete(projectLink)
		.where(
			and(
				eq(projectLink.id, input.linkId),
				eq(projectLink.projectId, input.projectId),
			),
		);
}

// --- Read-only lookups for the AI advisor's tools ---------------------------
// Every function here only ever exposes PUBLISHED project data — the advisor
// answers from the public catalog, never a specific user's drafts.

export type PublicProject = NonNullable<
	Awaited<ReturnType<typeof getPublicProject>>
>;

export async function getPublicProject(projectId: string) {
	const [row] = await db
		.select()
		.from(project)
		.where(and(eq(project.id, projectId), eq(project.status, "published")))
		.limit(1);
	if (!row) return null;
	// fullText is an internal indexing artifact (the source for late-chunked
	// embeddings), not user-facing content — it must never be forwarded
	// whole into the advisor's tool output (this is the "get one project's
	// full detail" tool; stuffing a whole verbatim transcription into every
	// such call is exactly the context-bloat chunking exists to avoid) or
	// down to the public project page.
	const { fullText: _fullText, ...rest } = row;
	return rest;
}

export async function getPublicProjectLinks(projectId: string) {
	const owned = await getPublicProject(projectId);
	if (!owned) return [];
	return db
		.select()
		.from(projectLink)
		.where(eq(projectLink.projectId, projectId));
}

/** Document metadata only — never the file bytes/storage key — and only for a document behind a published project. */
export async function getPublicSourceDocument(projectId: string) {
	const owned = await getPublicProject(projectId);
	if (!owned?.sourceDocumentId) return null;
	const [row] = await db
		.select({
			id: document.id,
			fileName: document.fileName,
			pageCount: document.pageCount,
			createdAt: document.createdAt,
		})
		.from(document)
		.where(eq(document.id, owned.sourceDocumentId))
		.limit(1);
	if (!row) return null;
	return {
		...row,
		createdAt: row.createdAt.toISOString(),
		allowDownload: owned.allowDownload,
	};
}

/**
 * Internal only — the storage key is how a page-image rendering route (the
 * only caller) fetches PDF bytes from R2 server-side; it must never be
 * returned by a `createServerFn` the client can call directly, unlike
 * `getPublicSourceDocument` above, which deliberately omits it. The
 * student only ever receives rendered pixels for one page, never the key,
 * the raw bytes, or a link to either.
 */
export async function getPublicSourceDocumentForRender(projectId: string) {
	const owned = await getPublicProject(projectId);
	if (!owned?.sourceDocumentId) return null;
	const [row] = await db
		.select({
			storageKey: document.storageKey,
			pageCount: document.pageCount,
			fileName: document.fileName,
		})
		.from(document)
		.where(eq(document.id, owned.sourceDocumentId))
		.limit(1);
	if (!row) return null;
	return { ...row, allowDownload: owned.allowDownload };
}

export type ProjectStatistics = {
	totalPublished: number;
	byDepartment: Array<{ value: string; count: number }>;
	byProjectType: Array<{ value: string; count: number }>;
	byYear: Array<{ value: number; count: number }>;
};

export async function getProjectStatistics(): Promise<ProjectStatistics> {
	const publishedOnly = eq(project.status, "published");
	const [[{ total }], byDepartment, byProjectType, byYear] = await Promise.all([
		db.select({ total: count() }).from(project).where(publishedOnly),
		db
			.select({ value: project.department, count: count() })
			.from(project)
			.where(and(publishedOnly, sql`${project.department} is not null`))
			.groupBy(project.department)
			.orderBy(desc(count())),
		db
			.select({ value: project.projectType, count: count() })
			.from(project)
			.where(and(publishedOnly, sql`${project.projectType} is not null`))
			.groupBy(project.projectType)
			.orderBy(desc(count())),
		db
			.select({ value: project.projectYear, count: count() })
			.from(project)
			.where(and(publishedOnly, sql`${project.projectYear} is not null`))
			.groupBy(project.projectYear)
			.orderBy(desc(project.projectYear)),
	]);

	return {
		totalPublished: total,
		byDepartment: byDepartment.map((row) => ({
			value: row.value as string,
			count: row.count,
		})),
		byProjectType: byProjectType.map((row) => ({
			value: row.value as string,
			count: row.count,
		})),
		byYear: byYear.map((row) => ({
			value: row.value as number,
			count: row.count,
		})),
	};
}

export type ProjectChunkHit = {
	chunkId: string;
	projectId: string;
	documentId: string | null;
	projectTitle: string | null;
	sectionTitle: string | null;
	pageNumber: number | null;
	allowDownload: boolean;
	content: string;
	score: number;
};

/** Semantic search directly over chunk content (deeper than project-level search — for "what does the methodology say" style questions). */
export async function searchProjectChunks(input: {
	query: string;
	limit?: number;
}): Promise<ProjectChunkHit[]> {
	const limit = input.limit ?? 6;
	let queryVector: number[];
	try {
		queryVector = await embedQuery(input.query);
	} catch (error) {
		console.error("projects: searchProjectChunks embedding failed", error);
		return [];
	}

	const vectorLiteral = toVectorLiteral(queryVector);
	const distance = sql<number>`${projectChunk.embedding} <=> ${vectorLiteral}::vector`;
	const rows = await db
		.select({
			chunkId: projectChunk.id,
			projectId: projectChunk.projectId,
			documentId: projectChunk.documentId,
			projectTitle: project.title,
			sectionTitle: projectChunk.sectionTitle,
			pageNumber: projectChunk.pageNumber,
			allowDownload: project.allowDownload,
			content: projectChunk.content,
			distance,
		})
		.from(projectChunk)
		.innerJoin(project, eq(projectChunk.projectId, project.id))
		.where(
			and(
				eq(project.status, "published"),
				sql`${projectChunk.embedding} is not null`,
			),
		)
		.orderBy(distance)
		.limit(limit);

	return rows.map((row) => ({
		chunkId: row.chunkId,
		projectId: row.projectId,
		documentId: row.documentId,
		projectTitle: row.projectTitle,
		sectionTitle: row.sectionTitle,
		pageNumber: row.pageNumber,
		allowDownload: row.allowDownload,
		content: row.content,
		// Cosine distance -> similarity in [0,1], clamped: negative distances
		// (numerically possible at the float boundary) would otherwise print
		// as a similarity above 1.
		score: Math.max(0, Math.min(1, 1 - row.distance)),
	}));
}
