import { Link } from "@tanstack/react-router";
import { GraduationCap, ShieldCheck, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

export function AuthShell({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<main className="auth-page">
			<section className="auth-story" aria-label="About Thesisly">
				<Link className="brand auth-brand" to="/">
					<span className="brand-mark">
						<GraduationCap size={22} strokeWidth={2.2} />
					</span>
					<span>thesisly</span>
				</Link>
				<div className="auth-story-copy">
					<span className="auth-kicker">
						<Sparkles size={15} /> Built for your final-year journey
					</span>
					<h2>Move from a broad idea to a project you can defend.</h2>
					<p>
						Keep your research direction, milestones, advisor feedback, and
						next steps together in one calm workspace.
					</p>
				</div>
				<div className="auth-trust">
					<ShieldCheck size={20} />
					<div>
						<strong>Your school identity stays yours.</strong>
						<span>We store the school email you provide—never a made-up one.</span>
					</div>
				</div>
			</section>

			<section className="auth-panel">
				<div className="auth-mobile-brand">
					<Link className="brand" to="/">
						<span className="brand-mark">
							<GraduationCap size={20} />
						</span>
						<span>thesisly</span>
					</Link>
				</div>
				<div className="auth-card">
					<header className="auth-heading">
						<h1>{title}</h1>
						<p>{description}</p>
					</header>
					{children}
				</div>
			</section>
		</main>
	);
}
