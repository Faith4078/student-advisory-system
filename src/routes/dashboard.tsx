import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
	ArrowRight,
	Bell,
	BookOpen,
	CalendarDays,
	CheckCircle2,
	ChevronRight,
	ClipboardList,
	Clock3,
	Compass,
	FileText,
	GraduationCap,
	KeyRound,
	LayoutDashboard,
	Lightbulb,
	LogOut,
	Menu,
	MessageSquareText,
	Search,
	Settings,
	Sparkles,
	TrendingUp,
	UserRound,
	X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { getSession } from "../lib/auth.functions";
import { authClient } from "../lib/auth-client";

export const Route = createFileRoute("/dashboard")({
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
	component: DashboardPage,
});

const navItems = [
	{ label: "Topic workspace", icon: Lightbulb },
	{ label: "Research plan", icon: ClipboardList },
	{ label: "Resources", icon: BookOpen },
];

const roadmap = [
	{
		title: "Complete your research interests",
		meta: "Profile · 5 minutes",
		status: "Next step",
		tone: "blue",
	},
	{
		title: "Generate focused topic directions",
		meta: "Topic discovery",
		status: "Locked",
		tone: "violet",
	},
	{
		title: "Review your project blueprint",
		meta: "Scope and research questions",
		status: "Locked",
		tone: "mint",
	},
];

function DashboardPage() {
	const { user } = Route.useRouteContext();
	const navigate = Route.useNavigate();
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const firstName = user.firstName || user.name.split(" ")[0] || "Student";
	const initials =
		`${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}` || "ST";

	async function signOut() {
		const result = await authClient.signOut();
		if (result.error) {
			toast.error("We couldn't sign you out. Please try again.");
			return;
		}
		toast.success("You have been signed out.");
		await navigate({ to: "/signin", search: { redirect: "/dashboard" } });
	}

	return (
		<main className="dashboard-page">
			<button
				className={sidebarOpen ? "dashboard-scrim is-open" : "dashboard-scrim"}
				type="button"
				onClick={() => setSidebarOpen(false)}
				aria-label="Close navigation"
			/>
			<aside
				className={
					sidebarOpen ? "dashboard-sidebar is-open" : "dashboard-sidebar"
				}
			>
				<div className="dashboard-logo-row">
					<Link className="brand" to="/">
						<span className="brand-mark">
							<GraduationCap size={20} />
						</span>
						<span>thesisly</span>
					</Link>
					<button
						className="sidebar-close"
						type="button"
						onClick={() => setSidebarOpen(false)}
						aria-label="Close navigation"
					>
						<X size={20} />
					</button>
				</div>
				<nav className="dashboard-nav" aria-label="Dashboard navigation">
					<p>Your workspace</p>
					<Link to="/dashboard" activeOptions={{ exact: true }}>
						<LayoutDashboard size={18} /> Overview
					</Link>
					<Link to="/dashboard/advisor" search={{ chat: undefined }}>
						<MessageSquareText size={18} /> AI Advisor
					</Link>
					{navItems.map(({ label, icon: Icon }) => (
						<button type="button" key={label}>
							<Icon size={18} /> {label}
						</button>
					))}
					<p>Account</p>
					<button type="button">
						<UserRound size={18} /> Profile
					</button>
					<button type="button">
						<Settings size={18} /> Settings
					</button>
					<Link to="/recovery-code">
						<KeyRound size={18} /> Recovery code
					</Link>
					<button className="sidebar-logout" type="button" onClick={signOut}>
						<LogOut size={18} /> Logout
					</button>
				</nav>
				<div className="sidebar-guide">
					<span>
						<Sparkles size={15} /> Thesisly guide
					</span>
					<strong>Not sure where to begin?</strong>
					<p>We’ll help you take one clear step at a time.</p>
					<button type="button">
						Ask for guidance <ArrowRight size={15} />
					</button>
				</div>
			</aside>

			<section className="dashboard-main">
				<header className="dashboard-topbar">
					<button
						className="mobile-sidebar-toggle"
						type="button"
						onClick={() => setSidebarOpen(true)}
						aria-label="Open navigation"
					>
						<Menu size={22} />
					</button>
					<label className="dashboard-search">
						<Search size={17} />
						<input
							placeholder="Search your topics, plans, and resources"
							aria-label="Search dashboard"
						/>
					</label>
					<div className="topbar-actions">
						<button
							className="notification-button"
							type="button"
							aria-label="Notifications"
						>
							<Bell size={20} />
							<span />
						</button>
						<div className="profile-chip">
							<span>{initials.toUpperCase()}</span>
							<div>
								<strong>
									{user.firstName} {user.lastName}
								</strong>
								<small>{user.department}</small>
							</div>
						</div>
					</div>
				</header>

				<div className="dashboard-content">
					<div className="dashboard-title-row">
						<div>
							<span>STUDENT DASHBOARD</span>
							<h1>Good morning, {firstName}.</h1>
							<p>
								Let’s turn your interests into a project direction you’re proud
								of.
							</p>
						</div>
						<button className="dashboard-primary-action" type="button">
							<Compass size={18} /> Discover a topic
						</button>
					</div>

					<section className="dashboard-hero-card">
						<div className="dashboard-hero-copy">
							<span className="dashboard-hero-kicker">
								<Sparkles size={14} /> YOUR NEXT BEST STEP
							</span>
							<h2>Build your research profile</h2>
							<p>
								Tell us what you study, what fascinates you, and the constraints
								you’re working with. We’ll use it to shape focused topic
								directions.
							</p>
							<button type="button">
								Complete my profile <ArrowRight size={17} />
							</button>
						</div>
						<div
							className="dashboard-progress-visual"
							role="progressbar"
							aria-label="Profile completion"
							aria-valuenow={20}
							aria-valuemin={0}
							aria-valuemax={100}
						>
							<div className="progress-ring">
								<strong>20%</strong>
								<span>complete</span>
							</div>
							<div className="progress-steps">
								<span className="done">
									<CheckCircle2 size={16} /> Account created
								</span>
								<span>
									<i className="step-dot" /> Research interests
								</span>
								<span>
									<i className="step-dot" /> Project constraints
								</span>
							</div>
						</div>
					</section>

					<section className="dashboard-metrics" aria-label="Project overview">
						<article>
							<span className="metric-icon blue">
								<Lightbulb size={20} />
							</span>
							<div>
								<small>Saved directions</small>
								<strong>0</strong>
								<p>Ready when you are</p>
							</div>
						</article>
						<article>
							<span className="metric-icon violet">
								<FileText size={20} />
							</span>
							<div>
								<small>Project blueprints</small>
								<strong>0</strong>
								<p>Create your first one</p>
							</div>
						</article>
						<article>
							<span className="metric-icon mint">
								<TrendingUp size={20} />
							</span>
							<div>
								<small>Journey progress</small>
								<strong>20%</strong>
								<p>Account setup complete</p>
							</div>
						</article>
					</section>

					<div className="dashboard-grid">
						<section className="dashboard-card journey-card">
							<header>
								<div>
									<span>YOUR ROADMAP</span>
									<h2>Project journey</h2>
								</div>
								<button type="button">
									View plan <ChevronRight size={15} />
								</button>
							</header>
							<div className="roadmap-list">
								{roadmap.map((item, index) => (
									<article key={item.title}>
										<span className={`roadmap-number ${item.tone}`}>
											{String(index + 1).padStart(2, "0")}
										</span>
										<div>
											<strong>{item.title}</strong>
											<small>{item.meta}</small>
										</div>
										<em>{item.status}</em>
									</article>
								))}
							</div>
						</section>
						<aside className="dashboard-card profile-card">
							<header>
								<div>
									<span>YOUR DETAILS</span>
									<h2>Student profile</h2>
								</div>
								<UserRound size={20} />
							</header>
							<div className="student-avatar-large">
								{initials.toUpperCase()}
							</div>
							<strong>
								{user.firstName} {user.lastName}
							</strong>
							<small>{user.displayUsername ?? user.username}</small>
							<dl>
								<div>
									<dt>Department</dt>
									<dd>{user.department}</dd>
								</div>
								<div>
									<dt>School email</dt>
									<dd>{user.email}</dd>
								</div>
							</dl>
							<button type="button">Edit profile</button>
						</aside>
						<section className="dashboard-card activity-card">
							<header>
								<div>
									<span>RECENT ACTIVITY</span>
									<h2>Your workspace</h2>
								</div>
								<Clock3 size={20} />
							</header>
							<div className="empty-state">
								<span>
									<FileText size={24} />
								</span>
								<strong>Your work will appear here</strong>
								<p>
									Save a topic direction or create a blueprint to start building
									your project history.
								</p>
							</div>
						</section>
						<aside className="dashboard-card deadline-card">
							<header>
								<div>
									<span>STAY ON TRACK</span>
									<h2>Upcoming</h2>
								</div>
								<CalendarDays size={20} />
							</header>
							<div className="deadline-empty">
								<CalendarDays size={26} />
								<strong>No deadlines yet</strong>
								<p>Add your academic timeline after completing your profile.</p>
							</div>
							<button type="button">Add timeline</button>
						</aside>
					</div>
				</div>
			</section>
		</main>
	);
}
