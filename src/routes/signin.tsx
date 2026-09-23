import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AuthShell } from "../components/auth-shell";
import { AUTH_TOAST_KEY } from "../components/auth-toast-bridge";
import { PasswordField } from "../components/password-field";
import { authClient } from "../lib/auth-client";
import { getSession } from "../lib/auth.functions";

function safeRedirect(value: unknown) {
	return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
		? value
		: "/dashboard";
}

export const Route = createFileRoute("/signin")({
	validateSearch: (search) => ({ redirect: safeRedirect(search.redirect) }),
	beforeLoad: async ({ search }) => {
		if (await getSession()) throw redirect({ href: search.redirect });
	},
	component: SignInPage,
});

function SignInPage() {
	const { redirect: destination } = Route.useSearch();
	const [password, setPassword] = useState("");
	const [pending, setPending] = useState(false);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (pending) return;

		const form = new FormData(event.currentTarget);
		const username = String(form.get("matricNo") ?? "").trim();

		setPending(true);
		try {
			const result = await authClient.signIn.username({ username, password });

			if (result.error) {
				toast.error("Matric number or password is incorrect.");
				return;
			}

			sessionStorage.setItem(AUTH_TOAST_KEY, "Welcome back!");
			globalThis.location.assign(destination);
		} catch {
			toast.error("We couldn't reach the server. Please try again.");
		} finally {
			setPending(false);
		}
	}

	return (
		<AuthShell
			title="Welcome back"
			description="Sign in with your matric number to continue your project journey."
		>
			<form className="auth-form" onSubmit={handleSubmit}>
				<div className="form-field">
					<label htmlFor="matricNo">Matric no.</label>
					<input
						id="matricNo"
						name="matricNo"
						autoComplete="username"
						placeholder="Enter your matric number"
						pattern="[A-Za-z]{3}/[0-9]{4}/[0-9]{3}"
						title="Use the format CSC/2019/061"
						required
					/>
				</div>
				<div className="form-field">
					<label htmlFor="password">Password</label>
					<PasswordField
						value={password}
						onChange={setPassword}
						autoComplete="current-password"
					/>
				</div>
				<button className="auth-submit" type="submit" disabled={pending}>
					{pending ? (
						<>
							<LoaderCircle className="spin" size={19} /> Signing in…
						</>
					) : (
						<>
							Sign in <ArrowRight size={18} />
						</>
					)}
				</button>
			</form>
			<p className="auth-switch">
				New to Thesisly? <Link to="/signup">Create an account</Link>
			</p>
		</AuthShell>
	);
}
