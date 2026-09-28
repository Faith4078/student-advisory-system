import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles, UploadCloud } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import {
	DashboardSidebar,
	DashboardTopbar,
} from "../components/dashboard-shell";
import {
	EMPTY_PROJECT_FORM,
	formValuesToInput,
	ProjectForm,
	type ProjectFormValues,
	projectToFormValues,
} from "../components/project-form";
import {
	type LinkType,
	ReviewCard,
	type ReviewItem,
} from "../components/project-review-card";
import { getSession } from "../lib/auth.functions";
import {
	processUploadedDocument,
	requestDocumentUpload,
} from "../lib/ingestion.functions";
import {
	addOwnedProjectLink,
	loadOwnedProject,
	removeOwnedProjectLink,
	saveManualProject,
	saveProjectEdits,
	setOwnedProjectStatus,
} from "../lib/projects.functions";

export const Route = createFileRoute("/dashboard_/upload")({
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
	component: UploadPage,
});

function UploadPage() {
	const { user } = Route.useRouteContext();
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [mode, setMode] = useState<"ai" | "manual">("ai");

	const requestUpload = useServerFn(requestDocumentUpload);
	const processDocumentFn = useServerFn(processUploadedDocument);
	const loadProjectFn = useServerFn(loadOwnedProject);
	const saveManualFn = useServerFn(saveManualProject);
	const saveEditsFn = useServerFn(saveProjectEdits);
	const setStatusFn = useServerFn(setOwnedProjectStatus);
	const addLinkFn = useServerFn(addOwnedProjectLink);
	const removeLinkFn = useServerFn(removeOwnedProjectLink);

	const [file, setFile] = useState<File | null>(null);
	const [stage, setStage] = useState<
		"idle" | "uploading" | "processing" | "done"
	>("idle");
	const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
	const [manualValues, setManualValues] = useState(EMPTY_PROJECT_FORM);
	const [manualSaving, setManualSaving] = useState(false);

	async function loadReviewItem(projectId: string): Promise<ReviewItem> {
		const project = await loadProjectFn({ data: { projectId } });
		return {
			project,
			values: projectToFormValues(project),
			saving: false,
			publishing: false,
		};
	}

	async function handleUpload(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!file || stage === "uploading" || stage === "processing") return;

		setStage("uploading");
		try {
			const { documentId, uploadUrl } = await requestUpload({
				data: {
					fileName: file.name,
					mimeType: file.type,
					fileSizeBytes: file.size,
				},
			});

			const putResponse = await fetch(uploadUrl, {
				method: "PUT",
				headers: { "Content-Type": file.type },
				body: file,
			});
			if (!putResponse.ok) {
				throw new Error("The file upload failed. Please try again.");
			}

			setStage("processing");
			const result = await processDocumentFn({ data: { documentId } });

			if (result.status === "failed") {
				toast.error(
					result.errorMessage ?? "We couldn't analyze that document.",
				);
				setStage("idle");
				return;
			}

			const items = await Promise.all(result.projectIds.map(loadReviewItem));
			setReviewItems(items);
			setStage("done");
			toast.success(
				`Found ${items.length} project${items.length === 1 ? "" : "s"} in your document.`,
			);
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Upload failed. Please try again.",
			);
			setStage("idle");
		}
	}

	async function handleManualSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (manualSaving) return;
		setManualSaving(true);
		try {
			const { id } = await saveManualFn({
				data: formValuesToInput(manualValues),
			});
			const item = await loadReviewItem(id);
			setReviewItems((current) => [item, ...current]);
			setManualValues(EMPTY_PROJECT_FORM);
			toast.success("Project saved as a draft.");
		} catch {
			toast.error("We couldn't save that project.");
		} finally {
			setManualSaving(false);
		}
	}

	function updateReviewValues(projectId: string, values: ProjectFormValues) {
		setReviewItems((current) =>
			current.map((item) =>
				item.project?.id === projectId ? { ...item, values } : item,
			),
		);
	}

	async function saveReviewItem(projectId: string) {
		const item = reviewItems.find((entry) => entry.project?.id === projectId);
		if (!item) return;
		setReviewItems((current) =>
			current.map((entry) =>
				entry.project?.id === projectId ? { ...entry, saving: true } : entry,
			),
		);
		try {
			await saveEditsFn({
				data: { projectId, ...formValuesToInput(item.values) },
			});
			toast.success("Saved.");
		} catch {
			toast.error("We couldn't save your changes.");
		} finally {
			setReviewItems((current) =>
				current.map((entry) =>
					entry.project?.id === projectId ? { ...entry, saving: false } : entry,
				),
			);
		}
	}

	async function publishReviewItem(projectId: string) {
		setReviewItems((current) =>
			current.map((entry) =>
				entry.project?.id === projectId
					? { ...entry, publishing: true }
					: entry,
			),
		);
		try {
			await saveReviewItem(projectId);
			await setStatusFn({ data: { projectId, status: "published" } });
			toast.success("Project published.");
			const refreshed = await loadReviewItem(projectId);
			setReviewItems((current) =>
				current.map((entry) =>
					entry.project?.id === projectId ? refreshed : entry,
				),
			);
		} catch {
			toast.error("We couldn't publish that project.");
		} finally {
			setReviewItems((current) =>
				current.map((entry) =>
					entry.project?.id === projectId
						? { ...entry, publishing: false }
						: entry,
				),
			);
		}
	}

	function discardReviewItem(projectId: string) {
		setReviewItems((current) =>
			current.filter((entry) => entry.project?.id !== projectId),
		);
	}

	async function addLink(projectId: string, type: LinkType, url: string) {
		if (!url.trim()) return;
		try {
			await addLinkFn({ data: { projectId, type, url } });
			const refreshed = await loadReviewItem(projectId);
			setReviewItems((current) =>
				current.map((entry) =>
					entry.project?.id === projectId ? refreshed : entry,
				),
			);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Invalid link.");
		}
	}

	async function removeLink(projectId: string, linkId: string) {
		try {
			await removeLinkFn({ data: { projectId, linkId } });
			const refreshed = await loadReviewItem(projectId);
			setReviewItems((current) =>
				current.map((entry) =>
					entry.project?.id === projectId ? refreshed : entry,
				),
			);
		} catch {
			toast.error("We couldn't remove that link.");
		}
	}

	return (
		<main className="dashboard-page">
			<DashboardSidebar
				open={sidebarOpen}
				onClose={() => setSidebarOpen(false)}
				currentPath="/dashboard/upload"
				guide={
					<>
						<span>
							<Sparkles size={15} /> Submit a project
						</span>
						<strong>AI-powered or manual.</strong>
						<p>
							Upload a report and let AI detect every project inside it, or
							enter one yourself.
						</p>
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
							<span>SUBMIT A PROJECT</span>
							<h1>Add a project</h1>
							<p>
								Upload a project/SIWES report and let AI find every project it
								contains, or enter one manually.
							</p>
						</div>
					</div>

					<div className="upload-tabs">
						<button
							type="button"
							className={mode === "ai" ? "is-active" : undefined}
							onClick={() => setMode("ai")}
						>
							AI-powered
						</button>
						<button
							type="button"
							className={mode === "manual" ? "is-active" : undefined}
							onClick={() => setMode("manual")}
						>
							Manual
						</button>
					</div>

					{mode === "ai" ? (
						<form
							className="dashboard-card upload-card"
							onSubmit={handleUpload}
						>
							<header>
								<div>
									<span>STEP 1</span>
									<h2>Upload your document</h2>
								</div>
							</header>
							<div className="upload-card-body">
								<label className="upload-dropzone">
									<UploadCloud size={26} />
									<strong>{file ? file.name : "Choose a PDF to upload"}</strong>
									<small>PDF only, up to 25MB</small>
									<input
										type="file"
										accept="application/pdf"
										onChange={(event) =>
											setFile(event.target.files?.[0] ?? null)
										}
										hidden
									/>
								</label>
								<button
									className="button button-primary"
									type="submit"
									disabled={
										!file || stage === "uploading" || stage === "processing"
									}
								>
									{stage === "uploading" ? (
										<>
											<Loader2 size={18} className="spin" /> Uploading...
										</>
									) : stage === "processing" ? (
										<>
											<Loader2 size={18} className="spin" /> Analyzing with
											AI...
										</>
									) : (
										<>
											<Sparkles size={18} /> Upload & analyze
										</>
									)}
								</button>
							</div>
						</form>
					) : (
						<form
							className="dashboard-card upload-card"
							onSubmit={handleManualSubmit}
						>
							<header>
								<div>
									<span>MANUAL ENTRY</span>
									<h2>Enter project details</h2>
								</div>
							</header>
							<ProjectForm values={manualValues} onChange={setManualValues} />
							<footer className="profile-form-footer">
								<button
									className="dashboard-primary-action"
									type="submit"
									disabled={manualSaving}
								>
									{manualSaving ? "Saving..." : "Save as draft"}
								</button>
							</footer>
						</form>
					)}

					{reviewItems.length > 0 && (
						<div className="review-list">
							<h2 className="review-list-heading">
								{reviewItems.length} project
								{reviewItems.length === 1 ? "" : "s"} to review
							</h2>
							{reviewItems.map((item) =>
								item.project ? (
									<ReviewCard
										key={item.project.id}
										item={item}
										onChange={(values) =>
											updateReviewValues(item.project?.id ?? "", values)
										}
										onSave={() => saveReviewItem(item.project?.id ?? "")}
										onPublish={() => publishReviewItem(item.project?.id ?? "")}
										onDiscard={() => discardReviewItem(item.project?.id ?? "")}
										onAddLink={(type, url) =>
											addLink(item.project?.id ?? "", type, url)
										}
										onRemoveLink={(linkId) =>
											removeLink(item.project?.id ?? "", linkId)
										}
									/>
								) : null,
							)}
						</div>
					)}
				</div>
			</section>
		</main>
	);
}
