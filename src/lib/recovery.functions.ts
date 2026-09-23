import { createServerFn } from "@tanstack/react-start";
import {
	getRequest,
	getRequestHeaders,
	setResponseHeader,
} from "@tanstack/react-start/server";
import { auth } from "./auth";
import {
	MATRIC_NUMBER_PATTERN,
	PASSWORD_REQUIREMENTS,
	RECOVERY_CODE_PATTERN,
} from "./auth-validation";
import {
	consumeRecoveryAttempt,
	issueRecoveryCode,
	resetPasswordWithRecovery,
} from "./recovery.server";

type ResetInput = {
	matricNo: string;
	recoveryCode: string;
	newPassword: string;
};

function validateResetInput(data: ResetInput) {
	const matricNo = data.matricNo.trim().toUpperCase();
	const recoveryCode = data.recoveryCode.trim().toUpperCase();
	if (!MATRIC_NUMBER_PATTERN.test(matricNo)) throw new Error("Invalid input.");
	if (!RECOVERY_CODE_PATTERN.test(recoveryCode)) throw new Error("Invalid input.");
	if (!PASSWORD_REQUIREMENTS.test(data.newPassword)) throw new Error("Invalid input.");
	return { matricNo, recoveryCode, newPassword: data.newPassword };
}

function isSameOriginRequest() {
	const request = getRequest();
	return request.headers.get("origin") === new URL(request.url).origin;
}

export const createRecoveryCode = createServerFn({ method: "POST" }).handler(
	async () => {
		setResponseHeader("Cache-Control", "no-store");
		if (!isSameOriginRequest()) throw new Error("Invalid request origin.");

		const currentSession = await auth.api.getSession({
			headers: getRequestHeaders(),
		});
		if (!currentSession) throw new Error("Unauthorized");

		return {
			recoveryCode: await issueRecoveryCode(currentSession.user.id),
		};
	},
);

export const resetPasswordUsingRecoveryCode = createServerFn({ method: "POST" })
	.validator(validateResetInput)
	.handler(async ({ data }) => {
		setResponseHeader("Cache-Control", "no-store");
		const request = getRequest();
		if (!isSameOriginRequest()) {
			return { ok: false as const, rateLimited: false };
		}

		const ip =
			request.headers.get("cf-connecting-ip") ??
			request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
			"unknown";
		if (!consumeRecoveryAttempt(ip)) {
			return { ok: false as const, rateLimited: true };
		}

		const nextRecoveryCode = await resetPasswordWithRecovery(data);
		if (!nextRecoveryCode) {
			return { ok: false as const, rateLimited: false };
		}

		return { ok: true as const, nextRecoveryCode };
	});
