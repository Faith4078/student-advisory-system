import { randomUUID } from "node:crypto";
import { and, arrayContains, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { document, project, projectChunk, projectLink } from "../db/schema";
import { buildSearchCacheKey, cacheAside } from "./cache.server";
import { reindexProjectChunks } from "./embedding-index.server";
import { embedQuery, rerank } from "./jina.server";

export type ProjectSearchFilters = {
	q?: string;
	department?: string;
	faculty?: string;
	projectType?: string;
	researchArea?: string;
	technology?: string;
	year?: number;
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

const SEMANTIC_CANDIDATE_LIMIT = 40;
const LEXICAL_CANDIDATE_LIMIT = 40;
const RERANK_TOP_N = 20;
const RETRIEVAL_VERSION = "hybrid-rrf-v1";
const EMBEDDING_VERSION = "jina-embeddings-v3";
const RERANKER_VERSION = "jina-reranker-v2-base-multilingual";

async function fetchLexicalCandidateIds(
	where: ReturnType<typeof and>,
	query: string,
	limit: number,
): Promise<string[]> {
	const rows = await db
		.select({ id: project.id })
		.from(project)
		.where(
			and(
				where,
				sql`${project.searchVector} @@ websearch_to_tsquery('english', ${query})`,
			),
		)
		.orderBy(
			desc(
				sql`ts_rank(${project.searchVector}, websearch_to_tsquery('english', ${query}))`,
			),
		)
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
	filters: Omit<ProjectSearchFilters, "page" | "pageSize"> & { q: string },
): Promise<string[]> {
	const cacheKey = buildSearchCacheKey({
		query: filters.q,
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
			const [lexicalIds, semanticIds] = await Promise.all([
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
			]);

			const fused = reciprocalRankFusion([lexicalIds, semanticIds]);
			const fusedIds = Array.from(fused.entries())
				.sort((a, b) => b[1] - a[1])
				.map(([id]) => id);

			if (fusedIds.length === 0) return fusedIds;

			const rerankHead = fusedIds.slice(0, RERANK_TOP_N);
			const rerankTail = fusedIds.slice(RERANK_TOP_N);

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
				const reranked = await rerank({ query: filters.q, documents });
				const rerankedIds = reranked
					.map((entry) => orderedHeadRows[entry.index]?.id)
					.filter((id): id is string => Boolean(id));
				// If the reranker returned fewer results than we sent, keep any
				// missing head ids at the end of the head (in fused order) rather
				// than silently dropping them.
				const rerankedSet = new Set(rerankedIds);
				const missingFromHead = rerankHead.filter((id) => !rerankedSet.has(id));
				return [...rerankedIds, ...missingFromHead, ...rerankTail];
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

/**
 * Hybrid search over PUBLISHED projects: structured filters always apply;
 * a free-text query additionally ranks results via lexical + semantic
 * retrieval fused with RRF and reranked (see `rankProjectsByQuery`). With no
 * query, results are just filtered and sorted by recency.
 */
export async function searchProjects(filters: ProjectSearchFilters): Promise<{
	items: ProjectSearchResultItem[];
	totalCount: number;
}> {
	const structuredConditions = buildStructuredConditions(filters);
	const where = and(...structuredConditions);
	const query = filters.q?.trim();

	if (!query) {
		const offset = (filters.page - 1) * filters.pageSize;
		const [items, [{ count }]] = await Promise.all([
			db
				.select(PROJECT_SUMMARY_COLUMNS)
				.from(project)
				.where(where)
				.orderBy(desc(project.publishedAt))
				.limit(filters.pageSize)
				.offset(offset),
			db
				.select({ count: sql<number>`count(*)::int` })
				.from(project)
				.where(where),
		]);
		return { items: items.map(toSummary), totalCount: count };
	}

	const rankedIds = await rankProjectsByQuery(where, { ...filters, q: query });
	const offset = (filters.page - 1) * filters.pageSize;
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
			abstract: project.abstract,
			problemStatement: project.problemStatement,
			objectives: project.objectives,
			methodology: project.methodology,
			results: project.results,
			conclusion: project.conclusion,
		});
	if (!updated) return;
	await reindexProjectChunks({
		projectId,
		documentId: updated.sourceDocumentId,
		pageNumber: updated.sourcePageRangeStart,
		fields: updated,
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
	return row ?? null;
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
	return { ...row, createdAt: row.createdAt.toISOString() };
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
		content: row.content,
		// Cosine distance -> similarity in [0,1], clamped: negative distances
		// (numerically possible at the float boundary) would otherwise print
		// as a similarity above 1.
		score: Math.max(0, Math.min(1, 1 - row.distance)),
	}));
}
