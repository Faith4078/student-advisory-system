import {
	createFileRoute,
	Link,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import {
	ChevronLeft,
	ChevronRight,
	FolderKanban,
	Search,
	SlidersHorizontal,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { getSession } from "../lib/auth.functions";
import { searchProjectsQuery } from "../lib/projects.functions";

type ProjectsSearch = {
	q?: string;
	department?: string;
	faculty?: string;
	projectType?: string;
	researchArea?: string;
	technology?: string;
	year?: number;
	page: number;
};

function str(value: unknown) {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

function num(value: unknown) {
	const n = typeof value === "string" ? Number(value) : value;
	return typeof n === "number" && Number.isInteger(n) ? n : undefined;
}

function normalizeSearch(search: Record<string, unknown>): ProjectsSearch {
	return {
		q: str(search.q),
		department: str(search.department),
		faculty: str(search.faculty),
		projectType: str(search.projectType),
		researchArea: str(search.researchArea),
		technology: str(search.technology),
		year: num(search.year),
		page: num(search.page) ?? 1,
	};
}

export const Route = createFileRoute("/projects")({
	validateSearch: normalizeSearch,
	loaderDeps: ({ search }) => search,
	loader: async ({ deps }) => {
		const [isSignedIn, results] = await Promise.all([
			getSession().then(Boolean),
			searchProjectsQuery({ data: deps }),
		]);
		return { isSignedIn, results };
	},
	pendingMs: 300,
	pendingComponent: ProjectsPending,
	component: ProjectsPage,
});

const FILTER_FIELDS = [
	{ key: "department", label: "Department" },
	{ key: "faculty", label: "Faculty" },
	{ key: "projectType", label: "Project type" },
	{ key: "researchArea", label: "Research area" },
	{ key: "technology", label: "Technology" },
	{ key: "year", label: "Year" },
] as const;

function ProjectsPending() {
	return (
		<main>
			<div className="projects-loading-bar" aria-hidden="true" />
		</main>
	);
}

function ProjectsPage() {
	const { isSignedIn, results } = Route.useLoaderData();
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const router = useRouter();
	const [queryDraft, setQueryDraft] = useState(search.q ?? "");
	const [filtersOpen, setFiltersOpen] = useState(false);

	useEffect(() => {
		setQueryDraft(search.q ?? "");
	}, [search.q]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: debounce timer should only reset when the draft text changes, not on every navigate/search.q identity change
	useEffect(() => {
		const timer = setTimeout(() => {
			if ((search.q ?? "") === queryDraft.trim()) return;
			navigate({
				search: (prev) => ({
					...prev,
					q: queryDraft.trim() || undefined,
					page: 1,
				}),
				replace: true,
			}).then(() => router.invalidate());
		}, 350);
		return () => clearTimeout(timer);
	}, [queryDraft]);

	function setFilter(
		key: keyof ProjectsSearch,
		value: string | number | undefined,
	) {
		navigate({
			search: (prev) => ({
				...prev,
				[key]: value === "" ? undefined : value,
				page: 1,
			}),
			replace: true,
		}).then(() => router.invalidate());
	}

	function clearFilter(key: keyof ProjectsSearch) {
		navigate({
			search: (prev) => ({ ...prev, [key]: undefined, page: 1 }),
			replace: true,
		}).then(() => router.invalidate());
	}

	function clearAllFilters() {
		navigate({ search: { page: 1 }, replace: true }).then(() =>
			router.invalidate(),
		);
		setQueryDraft("");
	}

	function goToPage(page: number) {
		navigate({ search: (prev) => ({ ...prev, page }), replace: true }).then(
			() => router.invalidate(),
		);
	}

	const activeFilterEntries = FILTER_FIELDS.filter(({ key }) => search[key]);
	const hasAnyFilters = activeFilterEntries.length > 0 || Boolean(search.q);
	const hasAnyFilterOptions =
		results.filterOptions.departments.length > 0 ||
		results.filterOptions.faculties.length > 0 ||
		results.filterOptions.projectTypes.length > 0 ||
		results.filterOptions.researchAreas.length > 0 ||
		results.filterOptions.technologies.length > 0 ||
		results.filterOptions.years.length > 0;

	return (
		<main>
			<SiteHeader isSignedIn={isSignedIn} />

			<section className="projects-page">
				<div className="container projects-shell">
					<div className="projects-heading">
						<h1>Explore student projects</h1>
						<p>
							Search and filter published final-year and SIWES projects from
							across departments.
						</p>
					</div>

					<div className="projects-toolbar">
						<label className="projects-search">
							<Search size={18} />
							<input
								value={queryDraft}
								onChange={(event) => setQueryDraft(event.target.value)}
								placeholder="Search by title, abstract, keywords..."
								aria-label="Search projects"
							/>
						</label>
						<button
							className="projects-filter-toggle"
							type="button"
							onClick={() => setFiltersOpen(true)}
							aria-label="Open filters"
						>
							<SlidersHorizontal size={17} /> Filters
							{activeFilterEntries.length > 0 && (
								<span>{activeFilterEntries.length}</span>
							)}
						</button>
					</div>

					{hasAnyFilters && (
						<div className="projects-active-filters">
							{search.q && (
								<span className="projects-chip">
									“{search.q}”
									<button
										type="button"
										onClick={() => {
											setQueryDraft("");
											clearFilter("q");
										}}
										aria-label="Clear search"
									>
										<X size={13} />
									</button>
								</span>
							)}
							{activeFilterEntries.map(({ key, label }) => (
								<span className="projects-chip" key={key}>
									{label}: {search[key]}
									<button
										type="button"
										onClick={() => clearFilter(key)}
										aria-label={`Clear ${label} filter`}
									>
										<X size={13} />
									</button>
								</span>
							))}
							<button
								className="projects-clear-all"
								type="button"
								onClick={clearAllFilters}
							>
								Clear all
							</button>
						</div>
					)}

					<div className="projects-layout">
						<button
							className={
								filtersOpen ? "dashboard-scrim is-open" : "dashboard-scrim"
							}
							type="button"
							onClick={() => setFiltersOpen(false)}
							aria-label="Close filters"
						/>
						<aside
							className={
								filtersOpen ? "projects-filters is-open" : "projects-filters"
							}
						>
							<div className="projects-filters-head">
								<strong>Filters</strong>
								<button
									type="button"
									onClick={() => setFiltersOpen(false)}
									aria-label="Close filters"
								>
									<X size={18} />
								</button>
							</div>
							{!hasAnyFilterOptions ? (
								<p className="projects-filters-empty">
									Filters will appear here once projects are published.
								</p>
							) : (
								<>
									<FilterGroup
										label="Department"
										value={search.department}
										options={results.filterOptions.departments}
										onChange={(value) => setFilter("department", value)}
									/>
									<FilterGroup
										label="Faculty"
										value={search.faculty}
										options={results.filterOptions.faculties}
										onChange={(value) => setFilter("faculty", value)}
									/>
									<FilterGroup
										label="Project type"
										value={search.projectType}
										options={results.filterOptions.projectTypes}
										onChange={(value) => setFilter("projectType", value)}
									/>
									<FilterGroup
										label="Research area"
										value={search.researchArea}
										options={results.filterOptions.researchAreas}
										onChange={(value) => setFilter("researchArea", value)}
									/>
									<FilterGroup
										label="Technology"
										value={search.technology}
										options={results.filterOptions.technologies}
										onChange={(value) => setFilter("technology", value)}
									/>
									<FilterGroup
										label="Year"
										value={search.year ? String(search.year) : undefined}
										options={results.filterOptions.years.map(String)}
										onChange={(value) =>
											setFilter("year", value ? Number(value) : undefined)
										}
									/>
								</>
							)}
						</aside>

						<div className="projects-results">
							<div className="projects-results-head">
								<output aria-live="polite">
									{results.totalCount === 0
										? "No projects found"
										: `${results.totalCount} project${results.totalCount === 1 ? "" : "s"} found`}
								</output>
							</div>

							{results.items.length === 0 ? (
								<div className="projects-empty">
									<span>
										<FolderKanban size={26} />
									</span>
									<h2>
										{hasAnyFilters
											? "No projects match your filters"
											: "No projects published yet"}
									</h2>
									<p>
										{hasAnyFilters
											? "Try clearing a filter or searching different terms."
											: "Check back soon — published student projects will appear here."}
									</p>
									{hasAnyFilters && (
										<button
											className="button button-primary"
											type="button"
											onClick={clearAllFilters}
										>
											Clear all filters
										</button>
									)}
								</div>
							) : (
								<>
									<div className="projects-grid">
										{results.items.map((item) => (
											<Link
												className="project-card"
												key={item.id}
												to="/projects/$projectId"
												params={{ projectId: item.id }}
											>
												<div className="project-card-tags">
													{item.projectType && <span>{item.projectType}</span>}
													{item.projectYear && <span>{item.projectYear}</span>}
												</div>
												<h3>{item.title ?? "Untitled project"}</h3>
												{item.abstract && (
													<p className="project-card-abstract">
														{item.abstract}
													</p>
												)}
												<div className="project-card-meta">
													{item.author && <span>{item.author}</span>}
													{item.department && <span>{item.department}</span>}
												</div>
												{item.technologies && item.technologies.length > 0 && (
													<div className="project-card-tech">
														{item.technologies.slice(0, 4).map((tech) => (
															<span key={tech}>{tech}</span>
														))}
													</div>
												)}
											</Link>
										))}
									</div>

									{results.pageCount > 1 && (
										<nav
											className="projects-pagination"
											aria-label="Project results pages"
										>
											<button
												type="button"
												onClick={() => goToPage(search.page - 1)}
												disabled={search.page <= 1}
												aria-label="Previous page"
											>
												<ChevronLeft size={17} />
											</button>
											<span>
												Page {search.page} of {results.pageCount}
											</span>
											<button
												type="button"
												onClick={() => goToPage(search.page + 1)}
												disabled={search.page >= results.pageCount}
												aria-label="Next page"
											>
												<ChevronRight size={17} />
											</button>
										</nav>
									)}
								</>
							)}
						</div>
					</div>
				</div>
			</section>

			<SiteFooter />
		</main>
	);
}

function FilterGroup({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: string | undefined;
	options: string[];
	onChange: (value: string) => void;
}) {
	if (options.length === 0) return null;
	return (
		<div className="projects-filter-group">
			<label htmlFor={`filter-${label}`}>{label}</label>
			<select
				id={`filter-${label}`}
				value={value ?? ""}
				onChange={(event) => onChange(event.target.value)}
			>
				<option value="">All</option>
				{options.map((option) => (
					<option key={option} value={option}>
						{option}
					</option>
				))}
			</select>
		</div>
	);
}
