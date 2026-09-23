import { CheckCircle2, Copy, KeyRound } from "lucide-react";
import { toast } from "sonner";

export function RecoveryCodeCard({
	recoveryCode,
	actionLabel,
	onContinue,
}: {
	recoveryCode: string;
	actionLabel: string;
	onContinue: () => void;
}) {
	async function copyCode() {
		try {
			await navigator.clipboard.writeText(recoveryCode);
			toast.success("Recovery code copied.");
		} catch {
			toast.error("Copy failed. Select the code and copy it manually.");
		}
	}

	return (
		<div className="recovery-code-card">
			<span className="recovery-code-icon"><KeyRound size={24} /></span>
			<h2>Save this code somewhere safe</h2>
			<p>
				This is the only way to reset your password without email. It is
				shown once and replaced after use.
			</p>
			<div className="recovery-code-value">
				<code>{recoveryCode}</code>
				<button type="button" onClick={copyCode} aria-label="Copy recovery code">
					<Copy size={18} />
				</button>
			</div>
			<p className="recovery-code-warning">
				Do not share this code. Anyone who has it can reset your password.
			</p>
			<button className="auth-submit" type="button" onClick={onContinue}>
				<CheckCircle2 size={18} /> {actionLabel}
			</button>
		</div>
	);
}

