import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
	account,
	recoveryCredential,
	session,
	user,
} from "../db/schema";

const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_ATTEMPTS = 6;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const attemptBuckets = new Map<string, { count: number; resetsAt: number }>();

function recoverySecret() {
	const secret = process.env.BETTER_AUTH_SECRET;
	if (!secret) throw new Error("BETTER_AUTH_SECRET is required.");
	return secret;
}

function hashRecoveryCode(code: string) {
	return createHmac("sha256", recoverySecret()).update(code).digest("hex");
}

function generateRecoveryCode() {
	const bytes = randomBytes(20);
	const characters = Array.from(bytes, (byte) => RECOVERY_ALPHABET[byte & 31]);
	const body = characters.join("");
	return `THSLY-${body.slice(0, 5)}-${body.slice(5, 10)}-${body.slice(10, 15)}-${body.slice(15)}`;
}

function hashesMatch(left: string, right: string) {
	const leftBytes = Buffer.from(left, "hex");
	const rightBytes = Buffer.from(right, "hex");
	return (
		leftBytes.length === rightBytes.length &&
		timingSafeEqual(leftBytes, rightBytes)
	);
}

export function consumeRecoveryAttempt(key: string) {
	const now = Date.now();
	const current = attemptBuckets.get(key);
	if (!current || current.resetsAt <= now) {
		attemptBuckets.set(key, { count: 1, resetsAt: now + ATTEMPT_WINDOW_MS });
		return true;
	}
	if (current.count >= MAX_ATTEMPTS) return false;
	current.count += 1;
	return true;
}

export async function issueRecoveryCode(userId: string) {
	const recoveryCode = generateRecoveryCode();
	const codeHash = hashRecoveryCode(recoveryCode);

	await db
		.insert(recoveryCredential)
		.values({ userId, codeHash })
		.onConflictDoUpdate({
			target: recoveryCredential.userId,
			set: { codeHash, updatedAt: new Date() },
		});

	return recoveryCode;
}

export async function resetPasswordWithRecovery(input: {
	matricNo: string;
	recoveryCode: string;
	newPassword: string;
}) {
	const record = await db
		.select({
			userId: user.id,
			codeHash: recoveryCredential.codeHash,
		})
		.from(user)
		.leftJoin(recoveryCredential, eq(recoveryCredential.userId, user.id))
		.where(eq(user.username, input.matricNo.toLowerCase()))
		.limit(1);

	const submittedHash = hashRecoveryCode(input.recoveryCode);
	const expectedHash =
		record[0]?.codeHash ?? hashRecoveryCode("THSLY-DUMMY-DUMMY-DUMMY-DUMMY");
	const verified = hashesMatch(submittedHash, expectedHash);
	const userId = record[0]?.userId;

	if (!verified || !userId || !record[0]?.codeHash) return null;

	const passwordHash = await hashPassword(input.newPassword);
	const nextRecoveryCode = generateRecoveryCode();
	const nextCodeHash = hashRecoveryCode(nextRecoveryCode);

	const reset = await db.transaction(async (transaction) => {
		const consumed = await transaction
			.delete(recoveryCredential)
			.where(
				and(
					eq(recoveryCredential.userId, userId),
					eq(recoveryCredential.codeHash, expectedHash),
				),
			)
			.returning({ userId: recoveryCredential.userId });
		if (consumed.length === 0) return false;

		const updated = await transaction
			.update(account)
			.set({ password: passwordHash, updatedAt: new Date() })
			.where(
				and(eq(account.userId, userId), eq(account.providerId, "credential")),
			)
			.returning({ id: account.id });
		if (updated.length === 0) throw new Error("Credential account not found.");

		await transaction.delete(session).where(eq(session.userId, userId));
		await transaction
			.insert(recoveryCredential)
			.values({ userId, codeHash: nextCodeHash });
		return true;
	});

	return reset ? nextRecoveryCode : null;
}

