import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AuthShell } from "../components/auth-shell";
import { PasswordField } from "../components/password-field";
import { authClient } from "../lib/auth-client";
import { getSession } from "../lib/auth.functions";

const PASSWORD_RULES = [
	{ label: "8 or more characters", test: (value: string) => value.length >= 8 },
	{ label: "An uppercase letter", test: (value: string) => /[A-Z]/.test(value) },
	{ label: "A lowercase letter", test: (value: string) => /[a-z]/.test(value) },
	{ label: "A number", test: (value: string) => /\d/.test(value) },
	{
		label: "A special character",
		test: (value: string) => /[^A-Za-z0-9]/.test(value),
	},
];

export const Route = createFileRoute("/signup")({
	beforeLoad: async () => {
		if (await getSession()) throw redirect({ to: "/dashboard" });
	},
	component: SignUpPage,
});

function SignUpPage() {
	const navigate = Route.useNavigate();
	const [pending, setPending] = useState(false);
	const [password, setPassword] = useState("");

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (pending) return;

		const form = new FormData(event.currentTarget);
		const firstName = String(form.get("firstName") ?? "").trim();
		const lastName = String(form.get("lastName") ?? "").trim();
		const matricNo = String(form.get("matricNo") ?? "").trim();
		const department = String(form.get("department") ?? "").trim();
		const email = String(form.get("email") ?? "").trim().toLowerCase();

		if (!PASSWORD_RULES.every((rule) => rule.test(password))) {
			toast.error("Your password does not meet every requirement.");
			return;
		}

		setPending(true);
		try {
			const result = await authClient.signUp.email({
				name: `${firstName} ${lastName}`,
				firstName,
				lastName,
				username: matricNo,
				displayUsername: matricNo,
				department,
				email,
				password,
			});

			if (result.error) {
				toast.error(result.error.message ?? "We couldn't create your account.");
				return;
			}

			toast.success("Account created. Welcome to Thesisly!");
			await navigate({ to: "/dashboard" });
		} catch {
			toast.error("We couldn't reach the server. Please try again.");
		} finally {
			setPending(false);
		}
	}

	return (
		<AuthShell
			title="Create your student account"
			description="Use your school details to set up your private project workspace."
		>
			<form className="auth-form" onSubmit={handleSubmit}>
				<div className="auth-field-grid">
					<div className="form-field">
						<label htmlFor="firstName">First name</label>
						<input id="firstName" name="firstName" autoComplete="given-name" required />
					</div>
					<div className="form-field">
						<label htmlFor="lastName">Last name</label>
						<input id="lastName" name="lastName" autoComplete="family-name" required />
					</div>
				</div>

				<div className="form-field">
					<label htmlFor="matricNo">Matric no.</label>
					<input
						id="matricNo"
						name="matricNo"
						autoComplete="username"
						placeholder="e.g. CSC/2019/061"
						pattern="[A-Za-z]{3}/[0-9]{4}/[0-9]{3}"
						title="Use the format CSC/2019/061"
						required
					/>
				</div>

				<div className="form-field">
					<label htmlFor="department">Department</label>
					<input
						id="department"
						name="department"
						placeholder="e.g. Computer Science"
						required
					/>
				</div>

				<div className="form-field">
					<label htmlFor="email">School email</label>
					<input
						id="email"
						name="email"
						type="email"
						autoComplete="email"
						placeholder="you@school.edu"
						required
					/>
				</div>

				<div className="form-field">
					<label htmlFor="password">Password</label>
					<PasswordField
						value={password}
						onChange={setPassword}
						autoComplete="new-password"
						describedBy="password-rules"
					/>
					<ul className="password-rules" id="password-rules">
						{PASSWORD_RULES.map((rule) => {
							const met = rule.test(password);
							return (
								<li className={met ? "is-met" : undefined} key={rule.label}>
									<Check size={13} /> {rule.label}
								</li>
							);
						})}
					</ul>
				</div>

				<button className="auth-submit" type="submit" disabled={pending}>
					{pending ? (
						<>
							<LoaderCircle className="spin" size={19} /> Creating account…
						</>
					) : (
						<>
							Create account <ArrowRight size={18} />
						</>
					)}
				</button>
			</form>
			<p className="auth-switch">
				Already have an account?{" "}
				<Link to="/signin" search={{ redirect: "/dashboard" }}>Sign in</Link>
			</p>
		</AuthShell>
	);
}
