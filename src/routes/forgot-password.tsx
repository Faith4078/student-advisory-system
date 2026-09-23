import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Check, KeyRound, LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AuthShell } from "../components/auth-shell";
import { AUTH_TOAST_KEY } from "../components/auth-toast-bridge";
import { PasswordField } from "../components/password-field";
import { RecoveryCodeCard } from "../components/recovery-code-card";
import { PASSWORD_RULES } from "../lib/auth-validation";
import { getSession } from "../lib/auth.functions";
import { resetPasswordUsingRecoveryCode } from "../lib/recovery.functions";

export const Route = createFileRoute("/forgot-password")({
	beforeLoad: async () => {
		if (await getSession()) throw redirect({ to: "/dashboard" });
	},
	component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
	const resetPassword = useServerFn(resetPasswordUsingRecoveryCode);
	const [password, setPassword] = useState("");
	const [confirmation, setConfirmation] = useState("");
	const [pending, setPending] = useState(false);
	const [nextRecoveryCode, setNextRecoveryCode] = useState("");

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (pending) return;

		if (!PASSWORD_RULES.every((rule) => rule.test(password))) {
			toast.error("Your password does not meet every requirement.");
			return;
		}
		if (password !== confirmation) {
			toast.error("The passwords do not match.");
			return;
		}

		const form = new FormData(event.currentTarget);
		setPending(true);
		try {
			const result = await resetPassword({
				data: {
					matricNo: String(form.get("matricNo") ?? ""),
					recoveryCode: String(form.get("recoveryCode") ?? ""),
					newPassword: password,
				},
			});

			if (!result.ok) {
				toast.error(
					result.rateLimited
						? "Too many attempts. Please wait 15 minutes and try again."
						: "The matric number or recovery code is incorrect.",
				);
				return;
			}

			setNextRecoveryCode(result.nextRecoveryCode);
			toast.success("Password reset successfully.");
		} catch {
			toast.error("We couldn't reset your password. Please check the details and try again.");
		} finally {
			setPending(false);
		}
	}

	function continueToSignIn() {
		sessionStorage.setItem(
			AUTH_TOAST_KEY,
			"Password reset successfully. Sign in with your new password.",
		);
		globalThis.location.assign("/signin");
	}

	if (nextRecoveryCode) {
		return (
			<AuthShell
				title="Your password has been reset"
				description="Your old recovery code has been replaced."
				showJourneyTag={false}
				showTrustMessage={false}
			>
				<RecoveryCodeCard
					recoveryCode={nextRecoveryCode}
					actionLabel="I saved it — sign in"
					onContinue={continueToSignIn}
				/>
			</AuthShell>
		);
	}

	return (
		<AuthShell
			title="Reset your password"
			description="Use the recovery code you saved when your account was created."
			showJourneyTag={false}
			showTrustMessage={false}
		>
			<form className="auth-form" onSubmit={handleSubmit}>
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
					<label htmlFor="recoveryCode">Recovery code</label>
					<div className="input-with-icon">
						<KeyRound size={18} />
						<input
							id="recoveryCode"
							name="recoveryCode"
							placeholder="THSLY-XXXXX-XXXXX-XXXXX-XXXXX"
							pattern="THSLY-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}"
							autoCapitalize="characters"
							autoComplete="off"
							required
						/>
					</div>
				</div>
				<div className="form-field">
					<label htmlFor="password">New password</label>
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
				<div className="form-field">
					<label htmlFor="passwordConfirmation">Confirm new password</label>
					<PasswordField
						id="passwordConfirmation"
						name="passwordConfirmation"
						value={confirmation}
						onChange={setConfirmation}
						autoComplete="new-password"
					/>
				</div>
				<button className="auth-submit" type="submit" disabled={pending}>
					{pending ? (
						<><LoaderCircle className="spin" size={19} /> Resetting password…</>
					) : (
						"Reset password"
					)}
				</button>
			</form>
			<p className="auth-switch">
				<Link to="/signin" search={{ redirect: "/dashboard" }}>
					<ArrowLeft size={14} /> Back to sign in
				</Link>
			</p>
		</AuthShell>
	);
}

