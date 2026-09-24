import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { advisorConversation, advisorMessage } from "../db/schema";

export type AdvisorConversationSummary = {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	lastMessage: string | null;
};

export type AdvisorChatMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	createdAt: string;
};

function serializeDate(value: Date) {
	return value.toISOString();
}

function makeTitle(prompt: string) {
	const cleaned = prompt.replace(/\s+/g, " ").trim();
	return cleaned.length > 42
		? `${cleaned.slice(0, 39)}...`
		: cleaned || "New chat";
}

function generateAdvisorReply(
	prompt: string,
	history: AdvisorChatMessage[],
	firstName: string,
) {
	const previousUserTurns = history.filter(
		(message) => message.role === "user",
	).length;
	const continuation =
		previousUserTurns > 0
			? `I remember the ${previousUserTurns} earlier point${previousUserTurns === 1 ? "" : "s"} in this conversation, so I will keep building from that context.`
			: "I will keep this conversation saved so we can continue from here later.";

	return [
		`Got it, ${firstName}. ${continuation}`,
		`For now, here is a structured advisor draft for: "${prompt}"`,
		"1. Clarify the exact academic problem you want to solve.",
		"2. List the data, tools, and constraints available in your department.",
		"3. Turn the idea into one focused research question before expanding the scope.",
		"Once LangChain is added, this function can call the real advisor agent with the stored conversation history.",
	].join("\n");
}

export async function getAdvisorState(input: {
	userId: string;
	chatId?: string;
}) {
	const conversations = await db
		.select({
			id: advisorConversation.id,
			title: advisorConversation.title,
			createdAt: advisorConversation.createdAt,
			updatedAt: advisorConversation.updatedAt,
		})
		.from(advisorConversation)
		.where(eq(advisorConversation.userId, input.userId))
		.orderBy(desc(advisorConversation.updatedAt));

	const activeConversation: string | null =
		conversations.find((conversation) => conversation.id === input.chatId)
			?.id ?? (input.chatId ? null : (conversations[0]?.id ?? null));

	const messages = activeConversation
		? await db
				.select({
					id: advisorMessage.id,
					role: advisorMessage.role,
					content: advisorMessage.content,
					createdAt: advisorMessage.createdAt,
				})
				.from(advisorMessage)
				.where(eq(advisorMessage.conversationId, activeConversation))
				.orderBy(asc(advisorMessage.createdAt))
		: [];

	return {
		conversations: conversations.map((conversation) => ({
			...conversation,
			createdAt: serializeDate(conversation.createdAt),
			updatedAt: serializeDate(conversation.updatedAt),
			lastMessage: null,
		})) satisfies AdvisorConversationSummary[],
		activeConversation,
		messages: messages.map((message) => ({
			...message,
			role: message.role === "assistant" ? "assistant" : "user",
			createdAt: serializeDate(message.createdAt),
		})) satisfies AdvisorChatMessage[],
	};
}

export async function sendAdvisorMessage(input: {
	userId: string;
	firstName: string;
	conversationId?: string;
	content: string;
}) {
	const now = new Date();
	let conversationId = input.conversationId;

	if (conversationId) {
		const existing = await db
			.select({ id: advisorConversation.id })
			.from(advisorConversation)
			.where(
				and(
					eq(advisorConversation.id, conversationId),
					eq(advisorConversation.userId, input.userId),
				),
			)
			.limit(1);
		if (existing.length === 0) conversationId = undefined;
	}

	if (!conversationId) {
		conversationId = randomUUID();
		await db.insert(advisorConversation).values({
			id: conversationId,
			userId: input.userId,
			title: makeTitle(input.content),
			createdAt: now,
			updatedAt: now,
		});
	}

	const history = await db
		.select({
			id: advisorMessage.id,
			role: advisorMessage.role,
			content: advisorMessage.content,
			createdAt: advisorMessage.createdAt,
		})
		.from(advisorMessage)
		.where(eq(advisorMessage.conversationId, conversationId))
		.orderBy(asc(advisorMessage.createdAt));

	const normalizedHistory = history.map((message) => ({
		...message,
		role: message.role === "assistant" ? "assistant" : "user",
		createdAt: serializeDate(message.createdAt),
	})) satisfies AdvisorChatMessage[];
	const assistantContent = generateAdvisorReply(
		input.content,
		normalizedHistory,
		input.firstName,
	);

	await db.transaction(async (transaction) => {
		await transaction.insert(advisorMessage).values([
			{
				id: randomUUID(),
				conversationId,
				role: "user",
				content: input.content,
				createdAt: now,
			},
			{
				id: randomUUID(),
				conversationId,
				role: "assistant",
				content: assistantContent,
				createdAt: new Date(now.getTime() + 1),
			},
		]);
		await transaction
			.update(advisorConversation)
			.set({ updatedAt: new Date() })
			.where(eq(advisorConversation.id, conversationId));
	});

	return { conversationId };
}

export async function renameAdvisorConversation(input: {
	userId: string;
	conversationId: string;
	title: string;
}) {
	await db
		.update(advisorConversation)
		.set({ title: input.title, updatedAt: new Date() })
		.where(
			and(
				eq(advisorConversation.id, input.conversationId),
				eq(advisorConversation.userId, input.userId),
			),
		);
}

export async function deleteAdvisorConversation(input: {
	userId: string;
	conversationId: string;
}) {
	await db
		.delete(advisorConversation)
		.where(
			and(
				eq(advisorConversation.id, input.conversationId),
				eq(advisorConversation.userId, input.userId),
			),
		);
}
