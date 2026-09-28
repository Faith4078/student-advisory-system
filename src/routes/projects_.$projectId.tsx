import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, FileText } from "lucide-react";
import { LINK_TYPES } from "../components/project-review-card";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { getSession } from "../lib/auth.functions";
import { loadPublicProject } from "../lib/projects.functions";

export const Route = createFileRoute("/projects_/$projectId")({
	loader: async ({ params }) => {
		const [isSignedIn, project] = await Promise.all([
			getSession().then(Boolean),
			loadPublicProject({ data: { projectId: params.projectId } }),
		]);
		return { isSignedIn, project };
	},
	component: ProjectDetailPage,
});

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="project-detail-section">
			<h2>{title}</h2>
			{children}
		</div>
	);
}

function ProjectDetailPage() {
	const { isSignedIn, project } = Route.useLoaderData();

	return (
		<main>
			<SiteHeader isSignedIn={isSignedIn} />

			<section className="project-detail-page">
				<div className="container project-detail">
					<Link
						className="project-detail-back"
						to="/projects"
						search={{ page: 1 }}
					>
						<ArrowLeft size={16} /> Back to projects
					</Link>

					<header className="project-detail-header">
						<div className="project-card-tags">
							{project.projectType && <span>{project.projectType}</span>}
							{project.projectYear && <span>{project.projectYear}</span>}
						</div>
						<h1>{project.title ?? "Untitled project"}</h1>
						<div className="project-card-meta">
							{project.author && <span>{project.author}</span>}
							{project.department && <span>{project.department}</span>}
							{project.faculty && <span>{project.faculty}</span>}
						</div>
					</header>

					{project.abstract && (
						<Section title="Abstract">
							<p>{project.abstract}</p>
							{project.abstractSource === "generated" && (
								<span className="ai-generated-badge">AI-generated summary</span>
							)}
						</Section>
					)}

					{project.problemStatement && (
						<Section title="Problem statement">
							<p>{project.problemStatement}</p>
						</Section>
					)}

					{project.objectives && project.objectives.length > 0 && (
						<Section title="Objectives">
							<ul>
								{project.objectives.map((objective) => (
									<li key={objective}>{objective}</li>
								))}
							</ul>
						</Section>
					)}

					{project.methodology && (
						<Section title="Methodology">
							<p>{project.methodology}</p>
						</Section>
					)}

					{project.results && (
						<Section title="Results">
							<p>{project.results}</p>
						</Section>
					)}

					{project.conclusion && (
						<Section title="Conclusion">
							<p>{project.conclusion}</p>
						</Section>
					)}

					{project.technologies && project.technologies.length > 0 && (
						<Section title="Technologies">
							<div className="project-card-tech">
								{project.technologies.map((tech) => (
									<span key={tech}>{tech}</span>
								))}
							</div>
						</Section>
					)}

					{project.keywords && project.keywords.length > 0 && (
						<Section title="Keywords">
							<div className="project-card-tech">
								{project.keywords.map((keyword) => (
									<span key={keyword}>{keyword}</span>
								))}
							</div>
						</Section>
					)}

					{project.links.length > 0 && (
						<Section title="Links">
							<div className="project-detail-links">
								{project.links.map((link) => {
									const meta =
										LINK_TYPES.find((entry) => entry.value === link.type) ??
										LINK_TYPES[LINK_TYPES.length - 1];
									const Icon = meta.icon;
									return (
										<a
											key={link.id}
											href={link.url}
											target="_blank"
											rel="noreferrer noopener"
										>
											<Icon size={15} />
											{link.label || meta.label}
										</a>
									);
								})}
							</div>
						</Section>
					)}

					{project.sourceDocument && (
						<Section title="Source document">
							<div className="project-detail-source">
								<FileText size={16} />
								<span>{project.sourceDocument.fileName}</span>
								{project.sourceDocument.pageCount && (
									<span>{project.sourceDocument.pageCount} pages</span>
								)}
							</div>
						</Section>
					)}
				</div>
			</section>

			<SiteFooter />
		</main>
	);
}
