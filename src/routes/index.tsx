import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowRight,
	BrainCircuit,
	Check,
	Cpu,
	Globe,
	MessageSquareText,
	Search,
	ShieldCheck,
	Sparkles,
	UploadCloud,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { getSession } from "../lib/auth.functions";

export const Route = createFileRoute("/")({
	loader: async () => ({ isSignedIn: Boolean(await getSession()) }),
	component: Home,
});

const steps = [
	{
		number: "01",
		icon: Search,
		title: "Search the repository",
		text: "Find past projects by title, technology, or topic.",
	},
	{
		number: "02",
		icon: MessageSquareText,
		title: "Ask your AI Advisor",
		text: "Get answers backed by real projects, not guesses.",
	},
	{
		number: "03",
		icon: UploadCloud,
		title: "Upload your own report",
		text: "Upload your project report to be added to the repository",
	},
];

const domains = [
	{
		icon: BrainCircuit,
		name: "Artificial Intelligence",
		examples: "Machine learning · Computer vision · NLP",
		tone: "violet",
	},
	{
		icon: ShieldCheck,
		name: "Cybersecurity",
		examples: "Network security · Cryptography · Pentesting",
		tone: "green",
	},
	{
		icon: Globe,
		name: "Web & Mobile Systems",
		examples: "Full-stack apps · APIs · Mobile platforms",
		tone: "blue",
	},
	{
		icon: Cpu,
		name: "Systems & Networking",
		examples: "IoT · Embedded systems · Infrastructure",
		tone: "orange",
	},
];

function Home() {
	const { isSignedIn } = Route.useLoaderData();

	return (
		<main>
			<SiteHeader isSignedIn={isSignedIn} />

			<section className="hero" id="top">
				<div className="hero-grid container">
					<div className="hero-copy">
						<h1>
							Central repository.
							<br />
							<span>Grounded AI guidance.</span>
						</h1>
						<p className="hero-lead">
							A searchable record of past projects, paired with an AI Advisor
							that helps you explore ideas and only cites what's actually here.
						</p>
						<div className="hero-actions">
							<Link
								className="button button-primary"
								to="/projects"
								search={{ page: 1 }}
							>
								Explore the project repository <ArrowRight size={19} />
							</Link>
						</div>
						<div className="hero-proof">
							<span>
								<Check size={15} /> Grounded in real past projects
							</span>
							<span>
								<Check size={15} /> Free to explore
							</span>
						</div>
					</div>

					<div className="hero-product">
						<div className="product-window">
							<div className="window-bar">
								<div className="window-dots">
									<i />
									<i />
									<i />
								</div>
								<span>AI ACADEMIC ADVISOR</span>
								<span className="ai-status">
									<Sparkles size={12} /> Preview
								</span>
							</div>
							<div className="window-body">
								<div className="advisor-preview-msg user">
									<span>You</span>
									<p>
										I'm interested in computer vision, but I don't want to
										repeat what's already been done.
									</p>
								</div>
								<div className="advisor-preview-msg assistant">
									<span>AI Advisor</span>
									<p>
										Two related projects are already in the repository, both
										using convolutional neural networks on mobile hardware.
									</p>
									<div className="advisor-preview-sources">
										<span>Sources</span>
										<strong>Smart Waste Sorting System</strong>
										<strong>Crop Disease Detection App</strong>
									</div>
								</div>
								<Link
									className="blueprint-action"
									to="/dashboard/advisor"
									search={{ chat: undefined }}
								>
									Ask your own question <ArrowRight size={17} />
								</Link>
							</div>
						</div>
						<div className="floating-note note-left">
							<Check size={16} /> Cited, not invented
						</div>
					</div>
				</div>
			</section>

			<section className="section process-section" id="how-it-works">
				<div className="container">
					<div className="section-heading centered">
						<span className="section-kicker">HOW IT WORKS</span>
						<h2>Explore Thesisly in 3 Steps</h2>
					</div>
					<div className="process-grid">
						{steps.map(({ number, icon: Icon, title, text }) => (
							<article className="process-card" key={number}>
								<span className="step-number">{number}</span>
								<div className="step-icon">
									<Icon size={25} />
								</div>
								<h3>{title}</h3>
								<p>{text}</p>
							</article>
						))}
					</div>
				</div>
			</section>

			<section className="section disciplines-section" id="disciplines">
				<div className="container disciplines-layout">
					<div className="disciplines-copy">
						<span className="section-kicker">
							ONE REPOSITORY, EVERY SPECIALISATION
						</span>
						<h2>If it's computing, there's probably a project behind it.</h2>
						<p>Browse by area and see what's already been explored.</p>
					</div>
					<div className="discipline-grid">
						{domains.map(({ icon: Icon, name, examples, tone }) => (
							<Link
								className={`discipline-card ${tone}`}
								key={name}
								to="/projects"
								search={{ page: 1, q: name }}
							>
								<span className="discipline-icon">
									<Icon size={23} />
								</span>
								<strong>{name}</strong>
								<small>{examples}</small>
								<ArrowRight className="card-arrow" size={18} />
							</Link>
						))}
					</div>
				</div>
			</section>

			<section className="starter-section" id="starter">
				<div className="container starter-shell">
					<div className="starter-copy">
						<span className="section-kicker light-kicker">YOUR NEXT STEP</span>
						<h2>The repository already exists. Come see what's in it.</h2>
					</div>
					<div className="starter-card">
						<div className="form-progress">
							<span>Get started</span>
							<strong>Free</strong>
						</div>
						<Link
							className="button button-mint"
							to="/projects"
							search={{ page: 1 }}
						>
							Explore the project repository <ArrowRight size={18} />
						</Link>
						<Link className="button button-outline" to="/signup">
							Create your account
						</Link>
						<small>
							Already have an account?{" "}
							<Link to="/signin" search={{ redirect: "/dashboard" }}>
								Sign in
							</Link>
						</small>
					</div>
				</div>
			</section>

			<SiteFooter />
		</main>
	);
}
