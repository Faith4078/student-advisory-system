import { createServerFn } from "@tanstack/react-start";
import {
	getRequest,
	getRequestHeaders,
	setResponseHeader,
} from "@tanstack/react-start/server";
import { auth } from "./auth";
import {
	addProjectLink,
	createManualProject,
	deleteProject,
	getOwnedProject,
	getProjectFilterOptions,
	getPublicProject,
	getPublicProjectLinks,
	getPublicSourceDocument,
	listOwnedProjects,
	type ProjectInput,
	type ProjectLinkType,
	type ProjectStatus,
	removeProjectLink,
	searchProjects,
	setProjectStatus,
	updateProject,
} from "./projects.server";
import { protectRequest } from "./security.server";

const PAGE_SIZE = 12;

export type ProjectsSearchInput = {
	q?: string;
	department?: string;
	faculty?: string;
	projectType?: string;
	researchArea?: string;
	technology?: string;
	year?: number;
	page?: number;
};

function cleanString(value: unknown) {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

export const searchProjectsQuery = createServerFn({ method: "GET" })
	.validator((data: ProjectsSearchInput) => ({
		q: cleanString(data.q),
		department: cleanString(data.department),
		faculty: cleanString(data.faculty),
		projectType: cleanString(data.projectType),
		researchArea: cleanString(data.researchArea),
		technology: cleanString(data.technology),
		year:
			typeof data.year === "number" && Number.isInteger(data.year)
				? data.year
				: undefined,
		page:
			typeof data.page === "number" && data.page > 0
				? Math.floor(data.page)
				: 1,
	}))
	.handler(async ({ data }) => {
		setResponseHeader("Cache-Control", "no-store");
		// Public, unauthenticated route: Shield (WAF) still applies even though
		// the rate-limit bucket below is shared across anonymous visitors (this
		// service's characteristic is userId-only — see security.server.ts).
		const session = await auth.api.getSession({ headers: getRequestHeaders() });
		const decision = await protectRequest({
			request: getRequest(),
			userId: session?.user.id,
			limit: { max: 60, intervalSeconds: 10 },
		});
		if (!decision.allowed)
			throw new Error(decision.reason ?? "Request blocked.");

		const [results, filterOptions] = await Promise.all([
			searchProjects({ ...data, pageSize: PAGE_SIZE }),
			getProjectFilterOptions(),
		]);
		return {
			...results,
			filterOptions,
			page: data.page,
			pageSize: PAGE_SIZE,
			pageCount: Math.max(1, Math.ceil(results.totalCount / PAGE_SIZE)),
		};
	});

export const loadPublicProject = createServerFn({ method: "GET" })
	.validator((data: { projectId: string }) => {
		if (!data.projectId) throw new Error("A project id is required.");
		return { projectId: data.projectId };
	})
	.handler(async ({ data }) => {
		setResponseHeader("Cache-Control", "no-store");
		const project = await getPublicProject(data.projectId);
		if (!project) throw new Error("Project not found.");
		const [links, sourceDocument] = await Promise.all([
			getPublicProjectLinks(data.projectId),
			getPublicSourceDocument(data.projectId),
		]);
		return {
			...project,
			publishedAt: project.publishedAt
				? project.publishedAt.toISOString()
				: null,
			createdAt: project.createdAt.toISOString(),
			updatedAt: project.updatedAt.toISOString(),
			links,
			sourceDocument,
		};
	});

// --- Owner-scoped draft / manual entry / publish workflow -------------------

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

const MAX_LIST_ITEMS = 20;

function cleanOptionalString(value: unknown, maxLength: number) {
	if (typeof value !== "string") return null;
	const trimmed = value.replace(/\s+/g, " ").trim().slice(0, maxLength);
	return trimmed.length > 0 ? trimmed : null;
}

function cleanStringList(value: unknown, itemMaxLength: number) {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const cleaned: string[] = [];
	for (const raw of value) {
		if (typeof raw !== "string") continue;
		const item = raw.replace(/\s+/g, " ").trim().slice(0, itemMaxLength);
		if (!item) continue;
		const key = item.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		cleaned.push(item);
		if (cleaned.length >= MAX_LIST_ITEMS) break;
	}
	return cleaned;
}

type ProjectInputPayload = Partial<{
	title: unknown;
	author: unknown;
	department: unknown;
	faculty: unknown;
	projectType: unknown;
	researchArea: unknown;
	keywords: unknown;
	technologies: unknown;
	problemStatement: unknown;
	objectives: unknown;
	methodology: unknown;
	results: unknown;
	conclusion: unknown;
	projectYear: unknown;
	abstract: unknown;
}>;

function normalizeProjectInput(data: ProjectInputPayload): ProjectInput {
	const year =
		typeof data.projectYear === "number" && Number.isInteger(data.projectYear)
			? data.projectYear
			: null;
	return {
		title: cleanOptionalString(data.title, 300),
		author: cleanOptionalString(data.author, 200),
		department: cleanOptionalString(data.department, 120),
		faculty: cleanOptionalString(data.faculty, 120),
		projectType: cleanOptionalString(data.projectType, 80),
		researchArea: cleanOptionalString(data.researchArea, 120),
		keywords: cleanStringList(data.keywords, 60),
		technologies: cleanStringList(data.technologies, 60),
		problemStatement: cleanOptionalString(data.problemStatement, 4000),
		objectives: cleanStringList(data.objectives, 300),
		methodology: cleanOptionalString(data.methodology, 4000),
		results: cleanOptionalString(data.results, 4000),
		conclusion: cleanOptionalString(data.conclusion, 4000),
		projectYear: year && year >= 1990 && year <= 2100 ? year : null,
		abstract: cleanOptionalString(data.abstract, 2000),
	};
}

export const loadOwnedProjects = createServerFn({ method: "GET" }).handler(
	async () => {
		setResponseHeader("Cache-Control", "no-store");
		const user = await requireUser();
		return listOwnedProjects({ userId: user.id });
	},
);

export const loadOwnedProject = createServerFn({ method: "GET" })
	.validator((data: { projectId: string }) => {
		if (!data.projectId) throw new Error("A project id is required.");
		return { projectId: data.projectId };
	})
	.handler(async ({ data }) => {
		setResponseHeader("Cache-Control", "no-store");
		const user = await requireUser();
		const owned = await getOwnedProject({
			userId: user.id,
			projectId: data.projectId,
		});
		if (!owned) throw new Error("Project not found.");
		return owned;
	});

export const saveManualProject = createServerFn({ method: "POST" })
	.validator((data: ProjectInputPayload) => normalizeProjectInput(data))
	.handler(async ({ data }) => {
		setResponseHeader("Cache-Control", "no-store");
		const user = await requireUser();
		await enforceRateLimit(user.id, { max: 30, intervalSeconds: 60 });
		return createManualProject({ userId: user.id, ...data });
	});

export const saveProjectEdits = createServerFn({ method: "POST" })
	.validator((data: ProjectInputPayload & { projectId: string }) => {
		if (!data.projectId) throw new Error("A project id is required.");
		return { projectId: data.projectId, ...normalizeProjectInput(data) };
	})
	.handler(async ({ data }) => {
		setResponseHeader("Cache-Control", "no-store");
		const user = await requireUser();
		await enforceRateLimit(user.id, { max: 30, intervalSeconds: 60 });
		const { projectId, ...fields } = data;
		await updateProject({ userId: user.id, projectId, ...fields });
		return { ok: true };
	});

const PROJECT_STATUS_VALUES = [
	"draft",
	"ready_to_publish",
	"published",
	"archived",
] as const;

export const setOwnedProjectStatus = createServerFn({ method: "POST" })
	.validator((data: { projectId: string; status: string }) => {
		if (!data.projectId) throw new Error("A project id is required.");
		if (!PROJECT_STATUS_VALUES.includes(data.status as ProjectStatus)) {
			throw new Error("Invalid project status.");
		}
		return { projectId: data.projectId, status: data.status as ProjectStatus };
	})
	.handler(async ({ data }) => {
		setResponseHeader("Cache-Control", "no-store");
		const user = await requireUser();
		await enforceRateLimit(user.id, { max: 30, intervalSeconds: 60 });
		await setProjectStatus({ userId: user.id, ...data });
		return { ok: true };
	});

export const deleteOwnedProject = createServerFn({ method: "POST" })
	.validator((data: { projectId: string }) => {
		if (!data.projectId) throw new Error("A project id is required.");
		return { projectId: data.projectId };
	})
	.handler(async ({ data }) => {
		setResponseHeader("Cache-Control", "no-store");
		const user = await requireUser();
		await enforceRateLimit(user.id, { max: 30, intervalSeconds: 60 });
		await deleteProject({ userId: user.id, ...data });
		return { ok: true };
	});

const PROJECT_LINK_TYPE_VALUES = [
	"github",
	"live",
	"demo",
	"social",
	"other",
] as const;

export const addOwnedProjectLink = createServerFn({ method: "POST" })
	.validator(
		(data: {
			projectId: string;
			type: string;
			url: string;
			label?: string;
		}) => {
			if (!data.projectId) throw new Error("A project id is required.");
			if (!PROJECT_LINK_TYPE_VALUES.includes(data.type as ProjectLinkType)) {
				throw new Error("Invalid link type.");
			}
			let url: URL;
			try {
				url = new URL(data.url);
			} catch {
				throw new Error("Enter a valid URL, including https://.");
			}
			if (url.protocol !== "https:" && url.protocol !== "http:") {
				throw new Error("Only http(s) links are supported.");
			}
			return {
				projectId: data.projectId,
				type: data.type as ProjectLinkType,
				url: url.toString(),
				label: cleanOptionalString(data.label, 80),
			};
		},
	)
	.handler(async ({ data }) => {
		setResponseHeader("Cache-Control", "no-store");
		const user = await requireUser();
		await enforceRateLimit(user.id, { max: 30, intervalSeconds: 60 });
		return addProjectLink({ userId: user.id, ...data });
	});

export const removeOwnedProjectLink = createServerFn({ method: "POST" })
	.validator((data: { projectId: string; linkId: string }) => {
		if (!data.projectId || !data.linkId) {
			throw new Error("A project id and link id are required.");
		}
		return data;
	})
	.handler(async ({ data }) => {
		setResponseHeader("Cache-Control", "no-store");
		const user = await requireUser();
		await enforceRateLimit(user.id, { max: 30, intervalSeconds: 60 });
		await removeProjectLink({ userId: user.id, ...data });
		return { ok: true };
	});
