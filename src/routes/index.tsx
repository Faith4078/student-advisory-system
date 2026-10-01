import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowRight,
	BrainCircuit,
	Check,
	ChevronRight,
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

const problems = [
	{
		number: "01",
		text: "Past projects sit in bound reports and personal folders, not anywhere a student can actually search them.",
	},
	{
		number: "02",
		text: "Keyword search misses work described in different words, so similar projects stay invisible to each other.",
	},
	{
		number: "03",
		text: "A general AI chatbot has never read your department's projects, so it can only guess, not tell you.",
	},
];

const steps = [
	{
		number: "01",
		icon: Search,
		title: "Search the catalogue",
		text: "Look up past projects by title, technology, department, or research area. Hybrid lexical and semantic search surfaces work that matches your meaning, not just your exact words.",
	},
	{
		number: "02",
		icon: MessageSquareText,
		title: "Ask your AI Advisor",
		text: "Discuss an idea in plain language. The advisor retrieves relevant projects before it answers, so every claim it makes can be traced back to something real in the catalogue.",
	},
	{
		number: "03",
		icon: UploadCloud,
		title: "Upload your own report",
		text: "Submit your project as a PDF and the system extracts the title, abstract, objectives, and methodology for you to review, so your work joins the catalogue too.",
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
						<div className="eyebrow">
							<Sparkles size={15} /> Dept. of Computer Science & Engineering,
							Obafemi Awolowo University
						</div>
						<h1>
							Don't start your project
							<br />
							<span>from a blank page.</span>
						</h1>
						<p className="hero-lead">
							Thesisly is a searchable catalogue of the department's past
							undergraduate projects, paired with an AI Academic Advisor that
							only answers from what's actually in it. Every suggestion traces
							back to a real project, not a guess, and it's built for every
							undergraduate, not just final-year students.
						</p>
						<div className="hero-actions">
							<Link
								className="button button-primary"
								to="/projects"
								search={{ page: 1 }}
							>
								Explore the project catalogue <ArrowRight size={19} />
							</Link>
							<a className="text-link" href="#how-it-works">
								See how it works <ChevronRight size={17} />
							</a>
						</div>
						<div className="hero-proof">
							<span>
								<Check size={15} /> Grounded in real past projects
							</span>
							<span>
								<Check size={15} /> Every level, not just final year
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
										Two related projects are already in the catalogue, both
										using convolutional neural networks on mobile hardware. One
										gap I don't see covered yet is low-light detection for
										campus security.
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
						<div className="floating-note note-right">
							<Check size={16} /> Every project, searchable
						</div>
					</div>
				</div>
			</section>

			<section className="proof-strip" aria-label="The problem Thesisly solves">
				<div className="container proof-grid">
					{problems.map(({ number, text }) => (
						<div key={number}>
							<strong>{number}</strong>
							<p>{text}</p>
						</div>
					))}
					<div className="proof-quote">
						<p>
							Thesisly exists to close that gap with one searchable, AI-guided
							catalogue.
						</p>
						<span>
							Built for the Department of Computer Science and Engineering
						</span>
					</div>
				</div>
			</section>

			<section className="student-moment">
				<div className="container student-moment-grid">
					<figure className="student-photo">
						<img
							src="/coding-session.jpg"
							alt="An undergraduate student focused on a laptop in a university computer lab"
						/>
						<figcaption>
							Built for Computer Science and Engineering undergraduates, at
							every level of study.
						</figcaption>
					</figure>
					<div className="student-moment-copy">
						<span className="section-kicker">BUILT FOR EVERY LEVEL</span>
						<h2>From your first course project to your final defense.</h2>
						<p>
							You don't need to be in your final year to use Thesisly. Browse
							the catalogue to see what previous students have built, ask the AI
							Advisor to help you think through an idea, or upload a report of
							your own so it becomes part of the record for students after you.
						</p>
						<ul>
							<li>
								<Check size={17} /> Search by topic, technology, or keyword
								across every published project
							</li>
							<li>
								<Check size={17} /> Ask the AI Advisor to compare approaches or
								spot a gap
							</li>
							<li>
								<Check size={17} /> Upload your own report and let AI structure
								it for you
							</li>
						</ul>
					</div>
				</div>
			</section>

			<section className="section process-section" id="how-it-works">
				<div className="container">
					<div className="section-heading centered">
						<span className="section-kicker">HOW IT WORKS</span>
						<h2>Three steps from a vague idea to a grounded one.</h2>
						<p>No generic topic lists. No unexplained AI guesses.</p>
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
							ONE DEPARTMENT, EVERY SPECIALISATION
						</span>
						<h2>
							If it's computer science and engineering, there's probably a
							project behind it.
						</h2>
						<p>
							Search the catalogue by the area you care about and see what's
							already been explored, from artificial intelligence to networking
							and everything in between.
						</p>
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

			<section className="section testimonial-section" id="grounded">
				<div className="container testimonial-grid">
					<div className="quote-mark">
						<ShieldCheck size={38} />
					</div>
					<div className="outcome-story">
						Ask a question. Get an answer that links back to{" "}
						<em>the exact projects it came from, every time.</em>
					</div>
					<div className="outcome-card">
						<span>GROUNDED, NOT GENERATED</span>
						<strong>Retrieve first, answer second.</strong>
						<p>
							<Check size={15} /> The advisor searches the catalogue before it
							replies, and only cites projects it actually found there.
						</p>
					</div>
				</div>
			</section>

			<section className="starter-section" id="starter">
				<div className="container starter-shell">
					<div className="starter-copy">
						<span className="section-kicker light-kicker">YOUR NEXT STEP</span>
						<h2>The catalogue already exists. Come see what's in it.</h2>
						<p>
							Browse published projects for free, no account required, or create
							an account to start a conversation with the AI Advisor about your
							own idea.
						</p>
						<div className="privacy-note">
							<ShieldCheck size={19} /> Your profile stays private. Only your
							department, bio, and interests are ever used to personalise
							advisor guidance.
						</div>
					</div>
					<div className="starter-card">
						<div className="form-progress">
							<span>Get started</span>
							<strong>Free</strong>
						</div>
						<ul className="starter-recap">
							<li>
								<Check size={17} /> Free to browse the full catalogue
							</li>
							<li>
								<Check size={17} /> Grounded, citation-backed AI guidance
							</li>
							<li>
								<Check size={17} /> Built for CSE undergraduates, any level
							</li>
						</ul>
						<Link
							className="button button-mint"
							to="/projects"
							search={{ page: 1 }}
						>
							Explore the project catalogue <ArrowRight size={18} />
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
