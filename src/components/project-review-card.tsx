import {
	CheckCircle2,
	ExternalLink,
	FileText,
	Github,
	Globe,
	Link2,
	Plus,
	Share2,
	Trash2,
	X,
} from "lucide-react";
import { useState } from "react";
import type { loadOwnedProject } from "../lib/projects.functions";
import { ProjectForm, type ProjectFormValues } from "./project-form";

export type OwnedProject = Awaited<ReturnType<typeof loadOwnedProject>>;

export type ReviewItem = {
	project: OwnedProject;
	values: ProjectFormValues;
	saving: boolean;
	publishing: boolean;
};

export const LINK_TYPES = [
	{ value: "github", label: "GitHub", icon: Github },
	{ value: "live", label: "Live app", icon: Globe },
	{ value: "demo", label: "Demo", icon: ExternalLink },
	{ value: "social", label: "Social", icon: Share2 },
	{ value: "other", label: "Other", icon: Link2 },
] as const;

export type LinkType = (typeof LINK_TYPES)[number]["value"];

export function ReviewCard({
	item,
	onChange,
	onSave,
	onPublish,
	onDiscard,
	onAddLink,
	onRemoveLink,
}: {
	item: ReviewItem;
	onChange: (values: ProjectFormValues) => void;
	onSave: () => void;
	onPublish: () => void;
	onDiscard: () => void;
	onAddLink: (type: LinkType, url: string) => void;
	onRemoveLink: (linkId: string) => void;
}) {
	const [linkType, setLinkType] = useState<LinkType>("github");
	const [linkUrl, setLinkUrl] = useState("");

	if (!item.project) return null;
	const isPublished = item.project.status === "published";

	return (
		<div className="dashboard-card review-card">
			<header>
				<div>
					<span>{isPublished ? "PUBLISHED" : "DRAFT"}</span>
					<h2>{item.values.title || "Untitled project"}</h2>
				</div>
				<button
					type="button"
					className="review-discard"
					onClick={onDiscard}
					aria-label="Remove from this list"
				>
					<X size={18} />
				</button>
			</header>

			<ProjectForm
				values={item.values}
				onChange={onChange}
				abstractSource={item.project.abstractSource}
			/>

			<div className="project-form-body">
				<div className="form-field">
					<label htmlFor={`link-url-${item.project.id}`}>Project links</label>
					<div className="interest-input-row">
						<select
							value={linkType}
							onChange={(event) => setLinkType(event.target.value as LinkType)}
						>
							{LINK_TYPES.map((type) => (
								<option key={type.value} value={type.value}>
									{type.label}
								</option>
							))}
						</select>
						<input
							id={`link-url-${item.project.id}`}
							value={linkUrl}
							onChange={(event) => setLinkUrl(event.target.value)}
							placeholder="https://..."
						/>
						<button
							type="button"
							onClick={() => {
								onAddLink(linkType, linkUrl);
								setLinkUrl("");
							}}
						>
							<Plus size={15} /> Add
						</button>
					</div>
					{item.project.links.length > 0 && (
						<ul className="project-link-list">
							{item.project.links.map((link) => (
								<li key={link.id}>
									<a href={link.url} target="_blank" rel="noreferrer">
										<ExternalLink size={14} /> {link.label || link.type}
									</a>
									<button
										type="button"
										onClick={() => onRemoveLink(link.id)}
										aria-label="Remove link"
									>
										<Trash2 size={14} />
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>

			<footer className="profile-form-footer review-card-footer">
				<button
					type="button"
					className="review-save-button"
					onClick={onSave}
					disabled={item.saving}
				>
					{item.saving ? "Saving..." : "Save draft"}
				</button>
				<button
					type="button"
					className="dashboard-primary-action"
					onClick={onPublish}
					disabled={item.publishing || isPublished}
				>
					{isPublished ? (
						<>
							<CheckCircle2 size={16} /> Published
						</>
					) : item.publishing ? (
						"Publishing..."
					) : (
						<>
							<FileText size={16} /> Publish
						</>
					)}
				</button>
			</footer>
		</div>
	);
}
