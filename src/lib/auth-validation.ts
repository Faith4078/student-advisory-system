export const PASSWORD_REQUIREMENTS =
	/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])\S{8,128}$/;

export const MATRIC_NUMBER_PATTERN = /^[A-Za-z]{3}\/\d{4}\/\d{3}$/;

export const RECOVERY_CODE_PATTERN =
	/^THSLY-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/;

export const PASSWORD_RULES = [
	{
		label: "8–128 characters",
		test: (value: string) => value.length >= 8 && value.length <= 128,
	},
	{ label: "An uppercase letter", test: (value: string) => /[A-Z]/.test(value) },
	{ label: "A lowercase letter", test: (value: string) => /[a-z]/.test(value) },
	{ label: "A number", test: (value: string) => /\d/.test(value) },
	{
		label: "A special character",
		test: (value: string) => /[^A-Za-z0-9]/.test(value),
	},
	{ label: "No spaces", test: (value: string) => !/\s/.test(value) },
] as const;
