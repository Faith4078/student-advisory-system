import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AuthShell } from "../components/auth-shell";
import { RecoveryCodeCard } from "../components/recovery-code-card";
import { getSession } from "../lib/auth.functions";
import { createRecoveryCode } from "../lib/recovery.functions";

export const Route = createFileRoute("/recovery-code")({
	beforeLoad: async () => {
		if (!(await getSession())) {
			throw redirect({ to: "/signin", search: { redirect: "/recovery-code" } });
		}
	},
	component: RecoveryCodePage,
});

function RecoveryCodePage() {
	const generateCode = useServerFn(createRecoveryCode);
	const navigate = Route.useNavigate();
	const [pending, setPending] = useState(false);
	const [recoveryCode, setRecoveryCode] = useState("");

	async function generate() {
		if (pending) return;
		setPending(true);
		try {
			const result = await generateCode();
			setRecoveryCode(result.recoveryCode);
			toast.success("A new recovery code was created.");
		} catch {
			toast.error("We couldn't generate a recovery code. Please try again.");
		} finally {
			setPending(false);
		}
	}

	return (
		<AuthShell
			title="Password recovery"
			description="Create a code you can use if you forget your password."
			showJourneyTag={false}
			showTrustMessage={false}
		>
			{recoveryCode ? (
				<RecoveryCodeCard
					recoveryCode={recoveryCode}
					actionLabel="I saved it — return to dashboard"
					onContinue={() => navigate({ to: "/dashboard" })}
				/>
			) : (
				<div className="recovery-code-card recovery-code-intro">
					<span className="recovery-code-icon"><KeyRound size={24} /></span>
					<h2>Generate a recovery code</h2>
					<p>
						Creating a new code immediately invalidates any previous recovery
						code for your account.
					</p>
					<button className="auth-submit" type="button" onClick={generate} disabled={pending}>
						{pending ? (
							<><LoaderCircle className="spin" size={19} /> Generating…</>
						) : (
							"Generate recovery code"
						)}
					</button>
				</div>
			)}
		</AuthShell>
	);
}

