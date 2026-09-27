import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, FolderKanban, Sparkles } from "lucide-react";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { getSession } from "../lib/auth.functions";

export const Route = createFileRoute("/projects")({
	loader: async () => ({ isSignedIn: Boolean(await getSession()) }),
	component: ProjectsPage,
});

function ProjectsPage() {
	const { isSignedIn } = Route.useLoaderData();

	return (
		<main>
			<SiteHeader isSignedIn={isSignedIn} />

			<section className="section projects-placeholder">
				<div className="container">
					<div className="section-heading centered">
						<span className="eyebrow">
							<Sparkles size={15} /> Coming soon
						</span>
						<span className="projects-placeholder-icon">
							<FolderKanban size={30} />
						</span>
						<h2>A home for every project you build with Thesisly.</h2>
						<p>
							We're building a place to browse project blueprints, track your
							progress, and see what other students in your field are working
							on. Check back soon.
						</p>
						<Link
							className="button button-primary"
							to={isSignedIn ? "/dashboard" : "/signup"}
						>
							{isSignedIn ? "Go to your dashboard" : "Get started"}{" "}
							<ArrowRight size={18} />
						</Link>
					</div>
				</div>
			</section>

			<SiteFooter />
		</main>
	);
}
