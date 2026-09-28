import { Link } from "@tanstack/react-router";
import { GraduationCap } from "lucide-react";

export function SiteFooter() {
	return (
		<footer className="footer">
			<div className="container footer-grid">
				<div>
					<Link className="brand footer-brand" to="/">
						<span className="brand-mark">
							<GraduationCap size={21} />
						</span>
						<span>thesisly</span>
					</Link>
					<p>Clarity for the project that defines your degree.</p>
				</div>
				<div className="footer-links">
					<Link to="/" hash="how-it-works">
						How it works
					</Link>
				</div>
				<p className="copyright">© 2026 Thesisly. Built for curious minds.</p>
			</div>
		</footer>
	);
}
