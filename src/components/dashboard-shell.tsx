import { Link, useNavigate } from "@tanstack/react-router";
import {
	Bell,
	BookOpen,
	ClipboardList,
	FolderKanban,
	GraduationCap,
	KeyRound,
	LayoutDashboard,
	Lightbulb,
	LogOut,
	Menu,
	MessageSquareText,
	Settings,
	UploadCloud,
	UserRound,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { authClient } from "../lib/auth-client";

const workspaceNavItems = [
	{ label: "Topic workspace", icon: Lightbulb },
	{ label: "Research plan", icon: ClipboardList },
	{ label: "Resources", icon: BookOpen },
];

export function DashboardSidebar({
	open,
	onClose,
	currentPath,
	guide,
}: {
	open: boolean;
	onClose: () => void;
	currentPath: string;
	guide: ReactNode;
}) {
	const navigate = useNavigate();

	async function signOut() {
		const result = await authClient.signOut();
		if (result.error) {
			toast.error("We couldn't sign you out. Please try again.");
			return;
		}
		toast.success("You have been signed out.");
		await navigate({ to: "/signin", search: { redirect: currentPath } });
	}

	return (
		<>
			<button
				className={open ? "dashboard-scrim is-open" : "dashboard-scrim"}
				type="button"
				onClick={onClose}
				aria-label="Close navigation"
			/>
			<aside
				className={open ? "dashboard-sidebar is-open" : "dashboard-sidebar"}
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
						onClick={onClose}
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
					<Link to="/dashboard/upload">
						<UploadCloud size={18} /> Upload project
					</Link>
					<Link to="/dashboard/my-projects">
						<FolderKanban size={18} /> My projects
					</Link>
					{workspaceNavItems.map(({ label, icon: Icon }) => (
						<button type="button" key={label}>
							<Icon size={18} /> {label}
						</button>
					))}
					<p>Account</p>
					<Link to="/dashboard/profile">
						<UserRound size={18} /> Profile
					</Link>
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
				<div className="sidebar-guide">{guide}</div>
			</aside>
		</>
	);
}

export function DashboardTopbar({
	user,
	onOpenSidebar,
}: {
	user: {
		firstName: string | null | undefined;
		lastName: string | null | undefined;
		department: string;
	};
	onOpenSidebar: () => void;
}) {
	const initials =
		`${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}` || "ST";

	return (
		<header className="dashboard-topbar">
			<button
				className="mobile-sidebar-toggle"
				type="button"
				onClick={onOpenSidebar}
				aria-label="Open navigation"
			>
				<Menu size={22} />
			</button>
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
	);
}
