import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, FolderKanban, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	DashboardSidebar,
	DashboardTopbar,
} from "../components/dashboard-shell";
import {
	formValuesToInput,
	type ProjectFormValues,
	projectToFormValues,
} from "../components/project-form";
import {
	type LinkType,
	type OwnedProject,
	ReviewCard,
} from "../components/project-review-card";
import { getSession } from "../lib/auth.functions";
import {
	addOwnedProjectLink,
	deleteOwnedProject,
	loadOwnedProject,
	loadOwnedProjects,
	removeOwnedProjectLink,
	saveProjectEdits,
	setOwnedProjectStatus,
} from "../lib/projects.functions";

export const Route = createFileRoute("/dashboard_/my-projects")({
	beforeLoad: async ({ location }) => {
		const session = await getSession();
		if (!session) {
			throw redirect({
				to: "/signin",
				search: { redirect: location.href },
			});
		}
		return { user: session.user };
	},
	loader: () => loadOwnedProjects(),
	component: MyProjectsPage,
});

const STATUS_LABELS: Record<string, string> = {
	draft: "Draft",
	ready_to_publish: "Ready to publish",
	published: "Published",
	archived: "Archived",
};

function MyProjectsPage() {
	const { user } = Route.useRouteContext();
	const projects = Route.useLoaderData();
	const router = useRouter();
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [expandedProject, setExpandedProject] = useState<OwnedProject | null>(
		null,
	);
	const [expandedValues, setExpandedValues] =
		useState<ProjectFormValues | null>(null);
	const [saving, setSaving] = useState(false);
	const [publishing, setPublishing] = useState(false);

	const loadProjectFn = useServerFn(loadOwnedProject);
	const saveEditsFn = useServerFn(saveProjectEdits);
	const setStatusFn = useServerFn(setOwnedProjectStatus);
	const deleteProjectFn = useServerFn(deleteOwnedProject);
	const addLinkFn = useServerFn(addOwnedProjectLink);
	const removeLinkFn = useServerFn(removeOwnedProjectLink);

	async function toggleExpand(projectId: string) {
		if (expandedId === projectId) {
			setExpandedId(null);
			setExpandedProject(null);
			setExpandedValues(null);
			return;
		}
		const project = await loadProjectFn({ data: { projectId } });
		setExpandedId(projectId);
		setExpandedProject(project);
		setExpandedValues(projectToFormValues(project));
	}

	async function refreshExpanded() {
		if (!expandedId) return;
		const project = await loadProjectFn({ data: { projectId: expandedId } });
		setExpandedProject(project);
		setExpandedValues(projectToFormValues(project));
	}

	async function handleSave() {
		if (!expandedId || !expandedValues || saving) return;
		setSaving(true);
		try {
			await saveEditsFn({
				data: { projectId: expandedId, ...formValuesToInput(expandedValues) },
			});
			toast.success("Saved.");
		} catch {
			toast.error("We couldn't save your changes.");
		} finally {
			setSaving(false);
		}
	}

	async function handlePublish() {
		if (!expandedId) return;
		setPublishing(true);
		try {
			await handleSave();
			await setStatusFn({
				data: { projectId: expandedId, status: "published" },
			});
			toast.success("Project published.");
			await refreshExpanded();
			await router.invalidate();
		} catch {
			toast.error("We couldn't publish that project.");
		} finally {
			setPublishing(false);
		}
	}

	async function handleDelete(projectId: string) {
		try {
			await deleteProjectFn({ data: { projectId } });
			if (expandedId === projectId) {
				setExpandedId(null);
				setExpandedProject(null);
				setExpandedValues(null);
			}
			toast.success("Project deleted.");
			await router.invalidate();
		} catch {
			toast.error("We couldn't delete that project.");
		}
	}

	async function handleAddLink(type: LinkType, url: string) {
		if (!expandedId || !url.trim()) return;
		try {
			await addLinkFn({ data: { projectId: expandedId, type, url } });
			await refreshExpanded();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Invalid link.");
		}
	}

	async function handleRemoveLink(linkId: string) {
		if (!expandedId) return;
		try {
			await removeLinkFn({ data: { projectId: expandedId, linkId } });
			await refreshExpanded();
		} catch {
			toast.error("We couldn't remove that link.");
		}
	}

	return (
		<main className="dashboard-page">
			<DashboardSidebar
				open={sidebarOpen}
				onClose={() => setSidebarOpen(false)}
				currentPath="/dashboard/my-projects"
				guide={
					<>
						<span>
							<FolderKanban size={15} /> Your submissions
						</span>
						<strong>Drafts stay yours.</strong>
						<p>Publish when you're ready — nothing goes live automatically.</p>
					</>
				}
			/>

			<section className="dashboard-main">
				<DashboardTopbar
					user={user}
					onOpenSidebar={() => setSidebarOpen(true)}
				/>

				<div className="dashboard-content">
					<div className="dashboard-title-row">
						<div>
							<span>MY PROJECTS</span>
							<h1>Your submissions</h1>
							<p>Manage drafts, published projects, and everything between.</p>
						</div>
					</div>

					{projects.length === 0 ? (
						<div className="dashboard-card">
							<div className="empty-state">
								<span>
									<FolderKanban size={24} />
								</span>
								<strong>Nothing submitted yet</strong>
								<p>
									Upload a document or add a project manually to get started.
								</p>
							</div>
						</div>
					) : (
						<div className="my-projects-list">
							{projects.map((item) => (
								<div className="dashboard-card my-project-row" key={item.id}>
									<button
										type="button"
										className="my-project-summary"
										onClick={() => toggleExpand(item.id)}
									>
										<div>
											<span className={`status-pill status-${item.status}`}>
												{STATUS_LABELS[item.status] ?? item.status}
											</span>
											<strong>{item.title || "Untitled project"}</strong>
											<small>
												{[item.department, item.projectYear]
													.filter(Boolean)
													.join(" · ")}
											</small>
										</div>
										{expandedId === item.id ? (
											<ChevronUp size={18} />
										) : (
											<ChevronDown size={18} />
										)}
									</button>
									<button
										type="button"
										className="my-project-delete"
										onClick={() => handleDelete(item.id)}
										aria-label="Delete project"
									>
										<Trash2 size={16} />
									</button>

									{expandedId === item.id &&
										expandedProject &&
										expandedValues && (
											<ReviewCard
												item={{
													project: expandedProject,
													values: expandedValues,
													saving,
													publishing,
												}}
												onChange={setExpandedValues}
												onSave={handleSave}
												onPublish={handlePublish}
												onDiscard={() => toggleExpand(item.id)}
												onAddLink={handleAddLink}
												onRemoveLink={handleRemoveLink}
											/>
										)}
								</div>
							))}
						</div>
					)}
				</div>
			</section>
		</main>
	);
}
