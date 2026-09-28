import { Link } from "@tanstack/react-router";
import { GraduationCap, Menu, X } from "lucide-react";
import { useState } from "react";

export function SiteHeader({ isSignedIn }: { isSignedIn: boolean }) {
	const [menuOpen, setMenuOpen] = useState(false);
	const closeMenu = () => setMenuOpen(false);

	return (
		<header className="site-header">
			<div className="container nav-wrap">
				<Link
					className="brand"
					to="/"
					aria-label="Thesisly home"
					onClick={closeMenu}
				>
					<span className="brand-mark">
						<GraduationCap size={22} strokeWidth={2.2} />
					</span>
					<span>thesisly</span>
				</Link>
				<nav
					className={menuOpen ? "main-nav is-open" : "main-nav"}
					aria-label="Primary navigation"
				>
					<Link to="/" hash="how-it-works" onClick={closeMenu}>
						How it works
					</Link>
					<Link to="/projects" search={{ page: 1 }} onClick={closeMenu}>
						Projects
					</Link>
					{isSignedIn ? (
						<Link to="/dashboard" onClick={closeMenu}>
							Dashboard
						</Link>
					) : (
						<>
							<Link
								to="/signin"
								search={{ redirect: "/dashboard" }}
								onClick={closeMenu}
							>
								Sign in
							</Link>
							<Link to="/signup" onClick={closeMenu}>
								Get started
							</Link>
						</>
					)}
				</nav>
				<button
					className="menu-toggle"
					type="button"
					aria-label={menuOpen ? "Close menu" : "Open menu"}
					aria-expanded={menuOpen}
					onClick={() => setMenuOpen((current) => !current)}
				>
					{menuOpen ? <X /> : <Menu />}
				</button>
			</div>
		</header>
	);
}
