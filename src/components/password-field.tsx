import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

export function PasswordField({
	value,
	onChange,
	autoComplete,
	describedBy,
}: {
	value: string;
	onChange: (value: string) => void;
	autoComplete: "current-password" | "new-password";
	describedBy?: string;
}) {
	const [visible, setVisible] = useState(false);

	return (
		<div className="password-input-wrap">
			<input
				id="password"
				name="password"
				type={visible ? "text" : "password"}
				autoComplete={autoComplete}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				aria-describedby={describedBy}
				required
			/>
			<button
				className="password-toggle"
				type="button"
				onClick={() => setVisible((current) => !current)}
				aria-label={visible ? "Hide password" : "Show password"}
				aria-pressed={visible}
			>
				{visible ? <EyeOff size={19} /> : <Eye size={19} />}
			</button>
		</div>
	);
}
