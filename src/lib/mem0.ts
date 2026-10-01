import MemoryClient from "mem0ai";

const ADVISOR_AGENT_ID = "ai-advisor";

let client: MemoryClient | null | undefined;
let warned = false;

function getClient(): MemoryClient | null {
	if (client !== undefined) return client;
	const apiKey = process.env.MEM0_API_KEY;
	if (!apiKey) {
		if (!warned) {
			console.warn(
				"MEM0_API_KEY is not set — AI Advisor memory features are disabled.",
			);
			warned = true;
		}
		client = null;
		return client;
	}
	client = new MemoryClient({ apiKey });
	return client;
}

export function isMem0Configured() {
	return Boolean(process.env.MEM0_API_KEY);
}

export type AdvisorMemory = {
	id: string;
	memory: string;
	updatedAt: string | null;
	categories: string[];
};

export async function rememberConversationTurn(input: {
	userId: string;
	userMessage: string;
	assistantMessage: string;
}) {
	const memory = getClient();
	if (!memory) return;
	try {
		await memory.add(
			[
				{ role: "user", content: input.userMessage },
				{ role: "assistant", content: input.assistantMessage },
			],
			{ userId: input.userId, agentId: ADVISOR_AGENT_ID },
		);
	} catch (error) {
		console.error("mem0: failed to store conversation memory", error);
	}
}

/**
 * Semantic recall for the AI advisor agent: memories relevant to the
 * current message, not the full history. Used to ground a reply in what
 * this specific user has told the advisor before, without dumping every
 * stored memory into the prompt on every turn.
 */
export async function recallRelevantMemories(input: {
	userId: string;
	query: string;
	limit?: number;
}): Promise<string[]> {
	const memory = getClient();
	if (!memory) return [];
	try {
		const result = await memory.search(input.query, {
			filters: { user_id: input.userId },
			topK: input.limit ?? 5,
		});
		return result.results
			.map((entry) => entry.memory ?? "")
			.filter((text) => text.length > 0);
	} catch (error) {
		console.error("mem0: failed to recall relevant memories", error);
		return [];
	}
}

export async function listUserMemories(
	userId: string,
): Promise<AdvisorMemory[]> {
	const memory = getClient();
	if (!memory) return [];
	try {
		const result = await memory.getAll({
			filters: { user_id: userId },
			pageSize: 50,
		});
		return result.results
			.map((entry) => ({
				id: entry.id,
				memory: entry.memory ?? "",
				updatedAt: entry.updatedAt
					? new Date(entry.updatedAt).toISOString()
					: null,
				categories: entry.categories ?? [],
			}))
			.filter((entry) => entry.memory.length > 0);
	} catch (error) {
		console.error("mem0: failed to list memories", error);
		return [];
	}
}

export async function forgetUserMemory(input: {
	userId: string;
	memoryId: string;
}) {
	const memory = getClient();
	if (!memory) return;
	try {
		// The API key is project-scoped, not per-user, so a memory id alone does
		// not prove ownership — confirm it belongs to this user before deleting.
		const existing = await memory.get(input.memoryId);
		if (existing.userId !== input.userId) return;
		await memory.delete(input.memoryId);
	} catch (error) {
		console.error("mem0: failed to delete memory", error);
	}
}

/**
 * Explicit, user-requested "remember this" — as opposed to
 * `rememberConversationTurn`'s passive best-effort learning from ordinary
 * chat. Routed through `memory.add()` rather than a raw insert because mem0's
 * add pipeline already does its own semantic ADD/UPDATE/DELETE/NONE
 * resolution against this user's existing memories: a fact that conflicts
 * with something already stored (e.g. "actually I'm now interested in X, not
 * Y") is updated in place rather than stored as a second, contradictory
 * memory alongside the old one.
 */
export async function rememberExplicitFact(input: {
	userId: string;
	fact: string;
}): Promise<boolean> {
	const memory = getClient();
	if (!memory) return false;
	try {
		await memory.add([{ role: "user", content: input.fact }], {
			userId: input.userId,
			agentId: ADVISOR_AGENT_ID,
		});
		return true;
	} catch (error) {
		console.error("mem0: failed to remember explicit fact", error);
		return false;
	}
}

// A search hit below this relevance score is treated as "not actually what
// the student meant" rather than deleted — an explicit forget request should
// not have a side effect of silently deleting an unrelated memory just
// because it was the least-bad match in the search results.
const FORGET_RELEVANCE_THRESHOLD = 0.4;

/**
 * Explicit, user-requested "forget this" — finds memories semantically
 * matching a natural-language description (the model doesn't know raw
 * memory ids) and deletes the ones that clear a relevance bar, returning
 * what was actually deleted so the advisor can confirm it accurately rather
 * than just claiming success.
 */
export async function forgetMatchingMemories(input: {
	userId: string;
	description: string;
	limit?: number;
}): Promise<AdvisorMemory[]> {
	const memory = getClient();
	if (!memory) return [];
	try {
		const result = await memory.search(input.description, {
			filters: { user_id: input.userId },
			topK: input.limit ?? 3,
		});
		const matches = result.results.filter(
			(entry) =>
				(entry.memory ?? "").length > 0 &&
				(entry.score ?? 0) >= FORGET_RELEVANCE_THRESHOLD,
		);
		await Promise.all(matches.map((entry) => memory.delete(entry.id)));
		return matches.map((entry) => ({
			id: entry.id,
			memory: entry.memory ?? "",
			updatedAt: null,
			categories: entry.categories ?? [],
		}));
	} catch (error) {
		console.error("mem0: failed to forget matching memories", error);
		return [];
	}
}
