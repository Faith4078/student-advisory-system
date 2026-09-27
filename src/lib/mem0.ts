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
				updatedAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : null,
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
