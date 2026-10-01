import { eq } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema";
import {
	type AdvisorMemory,
	forgetUserMemory,
	isMem0Configured,
	listUserMemories,
} from "./mem0";

export type ProfileDetails = {
	id: string;
	firstName: string;
	lastName: string;
	department: string;
	email: string;
	username: string | null;
	displayUsername: string | null;
	bio: string | null;
	interests: string[];
};

/**
 * The DB-only half of `getProfile` — no mem0 call. Used by the AI advisor,
 * which needs this on every chat turn and already runs its own separate
 * mem0 memory recall; fetching the full memory list here too would be a
 * redundant mem0 round-trip for data the advisor isn't using.
 */
export async function getStudentProfile(
	userId: string,
): Promise<ProfileDetails> {
	const [profile] = await db
		.select({
			id: user.id,
			firstName: user.firstName,
			lastName: user.lastName,
			department: user.department,
			email: user.email,
			username: user.username,
			displayUsername: user.displayUsername,
			bio: user.bio,
			interests: user.interests,
		})
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);

	if (!profile) throw new Error("Profile not found.");
	return profile;
}

export async function getProfile(userId: string): Promise<{
	profile: ProfileDetails;
	memories: AdvisorMemory[];
	memoriesEnabled: boolean;
}> {
	const [profile, memories] = await Promise.all([
		getStudentProfile(userId),
		listUserMemories(userId),
	]);
	return { profile, memories, memoriesEnabled: isMem0Configured() };
}

export async function updateProfile(input: {
	userId: string;
	firstName: string;
	lastName: string;
	department: string;
	bio: string | null;
	interests: string[];
}) {
	await db
		.update(user)
		.set({
			firstName: input.firstName,
			lastName: input.lastName,
			department: input.department,
			bio: input.bio,
			interests: input.interests,
		})
		.where(eq(user.id, input.userId));
}

export async function deleteProfileMemory(input: {
	userId: string;
	memoryId: string;
}) {
	await forgetUserMemory(input);
}
