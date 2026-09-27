import { createFileRoute } from "@tanstack/react-router";
import {
	ArrowRight,
	BookOpen,
	BrainCircuit,
	Check,
	ChevronRight,
	ClipboardCheck,
	Compass,
	Lightbulb,
	MessageSquareText,
	Search,
	ShieldCheck,
	Sparkles,
	Target,
	Users,
} from "lucide-react";
import { useState } from "react";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { getSession } from "../lib/auth.functions";

export const Route = createFileRoute("/")({
	loader: async () => ({ isSignedIn: Boolean(await getSession()) }),
	component: Home,
});

const disciplines = [
	{
		icon: BrainCircuit,
		name: "Computer Science",
		examples: "AI · Cybersecurity · Web systems",
		tone: "violet",
	},
	{
		icon: Target,
		name: "Business & Management",
		examples: "Fintech · Strategy · Operations",
		tone: "orange",
	},
	{
		icon: Users,
		name: "Social Sciences",
		examples: "Education · Policy · Behaviour",
		tone: "blue",
	},
	{
		icon: ShieldCheck,
		name: "Engineering",
		examples: "Energy · IoT · Sustainability",
		tone: "green",
	},
];

const process = [
	{
		number: "01",
		icon: MessageSquareText,
		title: "Tell us what matters to you",
		text: "Share your course, interests, strengths, and the problems you care about solving.",
	},
	{
		number: "02",
		icon: Compass,
		title: "Explore focused directions",
		text: "Our AI connects your profile to relevant research gaps and practical project paths.",
	},
	{
		number: "03",
		icon: ClipboardCheck,
		title: "Leave with a clear blueprint",
		text: "Get a refined topic, scope, research questions, and a realistic plan you can defend.",
	},
];

function Home() {
	const { isSignedIn } = Route.useLoaderData();
	const [discipline, setDiscipline] = useState("Computer Science");
	const [interest, setInterest] = useState("");
	const [generated, setGenerated] = useState(false);

	const scrollToStarter = () => {
		document.querySelector("#starter")?.scrollIntoView({ behavior: "smooth" });
	};

	return (
		<main>
			<SiteHeader isSignedIn={isSignedIn} />

			<section className="hero" id="top">
				<div className="hero-grid container">
					<div className="hero-copy">
						<div className="eyebrow">
							<Sparkles size={15} /> Your project starts with a better question
						</div>
						<h1>
							Stop searching.
							<br />
							<span>Start discovering.</span>
						</h1>
						<p className="hero-lead">
							Turn your interests into a focused, research-worthy project
							topic—with AI guidance that feels like a conversation with your
							best advisor.
						</p>
						<div className="hero-actions">
							<button
								className="button button-primary"
								type="button"
								onClick={scrollToStarter}
							>
								Discover my project topic <ArrowRight size={19} />
							</button>
							<a className="text-link" href="#how-it-works">
								See how it works <ChevronRight size={17} />
							</a>
						</div>
						<div className="hero-proof">
							<span>
								<Check size={15} /> No generic topic lists
							</span>
							<span>
								<Check size={15} /> Free to explore
							</span>
							<span>
								<Check size={15} /> Ready in minutes
							</span>
						</div>
					</div>

					<div className="hero-product">
						<div className="orbit orbit-one" />
						<div className="orbit orbit-two" />
						<div className="product-window">
							<div className="window-bar">
								<div className="window-dots">
									<i />
									<i />
									<i />
								</div>
								<span>YOUR TOPIC BLUEPRINT</span>
								<span className="ai-status">
									<Sparkles size={12} /> AI guided
								</span>
							</div>
							<div className="window-body">
								<div className="topic-header">
									<div className="topic-icon">
										<Lightbulb size={24} />
									</div>
									<div>
										<span className="topic-label">RECOMMENDED DIRECTION</span>
										<h2>Smart waste sorting for university campuses</h2>
									</div>
								</div>
								<p className="topic-summary">
									A computer vision system that helps students sort waste
									correctly and gives facilities teams useful recycling data.
								</p>
								<div className="fit-row">
									<span>Why it fits you</span>
									<strong>92% match</strong>
								</div>
								<div className="match-track">
									<span />
								</div>
								<div className="topic-tags">
									<span>Computer vision</span>
									<span>Sustainability</span>
									<span>Campus impact</span>
								</div>
								<div className="blueprint-grid">
									<div>
										<Search size={17} />
										<span>Research gap</span>
										<strong>Identified</strong>
									</div>
									<div>
										<BookOpen size={17} />
										<span>Scope</span>
										<strong>12–16 weeks</strong>
									</div>
									<div>
										<Target size={17} />
										<span>Feasibility</span>
										<strong>High</strong>
									</div>
								</div>
								<button
									className="blueprint-action"
									type="button"
									onClick={scrollToStarter}
								>
									Build a topic like this <ArrowRight size={17} />
								</button>
							</div>
						</div>
						<div className="floating-note note-left">
							<span>03</span> clear research questions
						</div>
						<div className="floating-note note-right">
							<Check size={16} /> Supervisor-ready
						</div>
					</div>
				</div>
			</section>

			<section className="proof-strip" aria-label="Thesisly benefits">
				<div className="container proof-grid">
					<div>
						<strong>01</strong>
						<p>Profile-aware guidance</p>
					</div>
					<div>
						<strong>02</strong>
						<p>Feasibility checks</p>
					</div>
					<div>
						<strong>03</strong>
						<p>Structured blueprint</p>
					</div>
					<div className="proof-quote">
						<p>From a broad interest to a project direction you can act on.</p>
						<span>One focused, guided flow</span>
					</div>
				</div>
			</section>

			<section className="student-moment">
				<div className="container student-moment-grid">
					<figure className="student-photo">
						<img
							src="/students-collaborating.png"
							alt="Two university students developing a project idea together in a campus library"
						/>
						<figcaption>
							Built for real students, real constraints, and work you can be
							proud of.
						</figcaption>
					</figure>
					<div className="student-moment-copy">
						<span className="section-kicker">MORE THAN AN IDEA GENERATOR</span>
						<h2>Choose a topic you can explain, defend, and finish.</h2>
						<p>
							A good title is only the beginning. Thesisly helps you test
							relevance, feasibility, available resources, and academic value
							before you commit.
						</p>
						<ul>
							<li>
								<Check size={17} /> Personal to your interests and strengths
							</li>
							<li>
								<Check size={17} /> Grounded in a clear problem and audience
							</li>
							<li>
								<Check size={17} /> Scoped to your timeline and resources
							</li>
						</ul>
					</div>
				</div>
			</section>

			<section className="section process-section" id="how-it-works">
				<div className="container">
					<div className="section-heading centered">
						<span className="section-kicker">A CLEARER WAY FORWARD</span>
						<h2>
							From “I have no idea” to
							<br />
							“this is the one.”
						</h2>
						<p>Thoughtful guidance at every step—without the overwhelm.</p>
					</div>
					<div className="process-grid">
						{process.map(({ number, icon: Icon, title, text }) => (
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
						<span className="section-kicker">BUILT AROUND YOUR FIELD</span>
						<h2>
							Your degree is the starting point. Your curiosity leads the way.
						</h2>
						<p>
							Thesisly adapts its questions and recommendations to your
							discipline, level, and available resources.
						</p>
						<button
							className="text-link dark-link"
							type="button"
							onClick={scrollToStarter}
						>
							Explore your discipline <ArrowRight size={17} />
						</button>
					</div>
					<div className="discipline-grid">
						{disciplines.map(({ icon: Icon, name, examples, tone }) => (
							<button
								className={`discipline-card ${tone}`}
								type="button"
								key={name}
								onClick={scrollToStarter}
							>
								<span className="discipline-icon">
									<Icon size={23} />
								</span>
								<strong>{name}</strong>
								<small>{examples}</small>
								<ArrowRight className="card-arrow" size={18} />
							</button>
						))}
					</div>
				</div>
			</section>

			<section className="section testimonial-section" id="stories">
				<div className="container testimonial-grid">
					<div className="quote-mark">
						<Lightbulb size={38} />
					</div>
					<div className="outcome-story">
						Start with broad interests in AI and healthcare. Finish with a
						direction that is{" "}
						<em>focused, practical, and actually achievable.</em>
					</div>
					<div className="student-profile">
						<div className="avatar">AI</div>
						<div>
							<strong>Example student profile</strong>
							<span>Computer Science · AI + healthcare</span>
						</div>
					</div>
					<div className="outcome-card">
						<span>EXAMPLE DIRECTION</span>
						<strong>
							AI-assisted early screening for diabetic retinopathy
						</strong>
						<p>
							<Check size={15} /> Focused, relevant, and realistically scoped
						</p>
					</div>
				</div>
			</section>

			<section className="starter-section" id="starter">
				<div className="container starter-shell">
					<div className="starter-copy">
						<span className="section-kicker light-kicker">YOUR NEXT STEP</span>
						<h2>A strong project begins with a direction.</h2>
						<p>
							Give Thesisly two details. We’ll show you what focused, personal
							guidance feels like.
						</p>
						<div className="privacy-note">
							<ShieldCheck size={19} /> Your answers stay private and are only
							used to shape your recommendations.
						</div>
					</div>
					<div className="starter-card">
						{!generated ? (
							<>
								<div className="form-progress">
									<span>Quick topic starter</span>
									<strong>1 min</strong>
								</div>
								<label htmlFor="discipline">What are you studying?</label>
								<select
									id="discipline"
									value={discipline}
									onChange={(event) => setDiscipline(event.target.value)}
								>
									{disciplines.map((item) => (
										<option key={item.name}>{item.name}</option>
									))}
									<option>Health Sciences</option>
									<option>Arts & Humanities</option>
								</select>
								<label htmlFor="interest">
									What problem or idea interests you?
								</label>
								<textarea
									id="interest"
									value={interest}
									onChange={(event) => setInterest(event.target.value)}
									placeholder="e.g. I want to use technology to make campus life easier..."
									rows={3}
								/>
								<button
									className="button button-mint"
									type="button"
									onClick={() => setGenerated(true)}
								>
									Show me a direction <Sparkles size={18} />
								</button>
								<small>
									No account needed to preview your first direction.
								</small>
							</>
						) : (
							<output className="generated-result">
								<div className="result-icon">
									<Sparkles size={23} />
								</div>
								<span>A DIRECTION FOR YOU</span>
								<h3>
									{discipline}: a practical study around{" "}
									{interest.trim() || "a real problem in your local community"}
								</h3>
								<p>
									Thesisly would now help you narrow the users, context, method,
									and measurable outcome before suggesting focused topics.
								</p>
								<button className="button button-mint" type="button">
									Continue to my recommendations <ArrowRight size={18} />
								</button>
								<button
									className="reset-button"
									type="button"
									onClick={() => setGenerated(false)}
								>
									Try a different direction
								</button>
							</output>
						)}
					</div>
				</div>
			</section>

			<SiteFooter />
		</main>
	);
}
