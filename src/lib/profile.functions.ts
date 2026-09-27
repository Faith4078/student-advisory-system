import { createServerFn } from "@tanstack/react-start";
import {
	getRequestHeaders,
	setResponseHeader,
} from "@tanstack/react-start/server";
import { auth } from "./auth";
import { deleteProfileMemory, getProfile, updateProfile } from "./profile.server";

const MAX_BIO_LENGTH = 600;
const MAX_INTEREST_LENGTH = 40;
const MAX_INTERESTS = 12;

type UpdateProfileInput = {
	firstName: string;
	lastName: string;
	department: string;
	bio: string;
	interests: string[];
};

type DeleteMemoryInput = {
	memoryId: string;
};

async function requireUser() {
	const session = await auth.api.getSession({ headers: getRequestHeaders() });
	if (!session) throw new Error("Unauthorized");
	return session.user;
}

function normalizeInterests(values: string[]) {
	const seen = new Set<string>();
	const cleaned: string[] = [];
	for (const raw of values) {
		const value = raw
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, MAX_INTEREST_LENGTH);
		if (!value) continue;
		const key = value.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		cleaned.push(value);
		if (cleaned.length >= MAX_INTERESTS) break;
	}
	return cleaned;
}

export const loadProfile = createServerFn({ method: "GET" }).handler(
	async () => {
		setResponseHeader("Cache-Control", "no-store");
		const user = await requireUser();
		return getProfile(user.id);
	},
);

export const saveProfile = createServerFn({ method: "POST" })
	.validator((data: UpdateProfileInput) => {
		const firstName = data.firstName.replace(/\s+/g, " ").trim();
		const lastName = data.lastName.replace(/\s+/g, " ").trim();
		const department = data.department.replace(/\s+/g, " ").trim();
		const bio = data.bio.trim().slice(0, MAX_BIO_LENGTH);

		if (firstName.length < 1 || firstName.length > 60) {
			throw new Error("First name must be 1–60 characters.");
		}
		if (lastName.length < 1 || lastName.length > 60) {
			throw new Error("Last name must be 1–60 characters.");
		}
		if (department.length < 1 || department.length > 80) {
			throw new Error("Department must be 1–80 characters.");
		}

		return {
			firstName,
			lastName,
			department,
			bio: bio.length > 0 ? bio : null,
			interests: normalizeInterests(data.interests ?? []),
		};
	})
	.handler(async ({ data }) => {
		setResponseHeader("Cache-Control", "no-store");
		const user = await requireUser();
		await updateProfile({ userId: user.id, ...data });
		return { ok: true };
	});

export const deleteAdvisorMemory = createServerFn({ method: "POST" })
	.validator((data: DeleteMemoryInput) => {
		if (!data.memoryId) throw new Error("Memory id is required.");
		return { memoryId: data.memoryId };
	})
	.handler(async ({ data }) => {
		setResponseHeader("Cache-Control", "no-store");
		const user = await requireUser();
		await deleteProfileMemory({ userId: user.id, memoryId: data.memoryId });
		return { ok: true };
	});
