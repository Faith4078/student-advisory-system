import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { advisorConversation, advisorMessage } from "../db/schema";
import {
	type AdvisorCitation,
	runAdvisorAgent,
	streamAdvisorAgent,
} from "./advisor-agent.server";
import { rememberConversationTurn } from "./mem0";
import { getStudentProfile } from "./profile.server";

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
	sources: AdvisorCitation[] | null;
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

/**
 * Sentinel `chatId` meaning "force a blank new-chat screen" — distinct from
 * an *absent* chatId (landing on /dashboard/advisor with no query param),
 * which defaults to the user's most recent conversation. Real conversation
 * ids are UUIDs, so this can never collide with one.
 */
export const NEW_CHAT_SENTINEL = "new";

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
		input.chatId === NEW_CHAT_SENTINEL
			? null
			: (conversations.find((conversation) => conversation.id === input.chatId)
					?.id ?? (input.chatId ? null : (conversations[0]?.id ?? null)));

	const messages = activeConversation
		? await db
				.select({
					id: advisorMessage.id,
					role: advisorMessage.role,
					content: advisorMessage.content,
					sources: advisorMessage.sources,
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
			sources: (message.sources as AdvisorCitation[] | null) ?? null,
			createdAt: serializeDate(message.createdAt),
		})) satisfies AdvisorChatMessage[],
	};
}

/**
 * Ensures a conversation exists (creating one if `conversationId` is absent
 * or doesn't belong to this user) and loads its prior turns as agent-ready
 * history. Shared by both the buffered (`sendAdvisorMessage`) and streaming
 * (`streamAdvisorMessage`) send paths so conversation bookkeeping can't
 * drift between the two.
 */
async function resolveConversation(input: {
	userId: string;
	conversationId?: string;
	firstUserMessage: string;
}): Promise<{
	conversationId: string;
	history: Array<{ role: "user" | "assistant"; content: string }>;
}> {
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
			title: makeTitle(input.firstUserMessage),
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		return { conversationId, history: [] };
	}

	const history = await db
		.select({
			role: advisorMessage.role,
			content: advisorMessage.content,
		})
		.from(advisorMessage)
		.where(eq(advisorMessage.conversationId, conversationId))
		.orderBy(asc(advisorMessage.createdAt));

	return {
		conversationId,
		history: history.map((message) => ({
			role:
				message.role === "assistant"
					? ("assistant" as const)
					: ("user" as const),
			content: message.content,
		})),
	};
}

/**
 * Persists a completed turn (both messages + citations), bumps the
 * conversation's `updatedAt`, and best-effort teaches mem0 from it. Shared
 * by both send paths — called once the assistant's full reply is known,
 * whether that arrived in one shot or was streamed token by token.
 */
async function persistTurn(input: {
	userId: string;
	conversationId: string;
	userMessage: string;
	assistantContent: string;
	citations: AdvisorCitation[];
}) {
	const now = new Date();
	await db.transaction(async (transaction) => {
		await transaction.insert(advisorMessage).values([
			{
				id: randomUUID(),
				conversationId: input.conversationId,
				role: "user",
				content: input.userMessage,
				createdAt: now,
			},
			{
				id: randomUUID(),
				conversationId: input.conversationId,
				role: "assistant",
				content: input.assistantContent,
				sources: input.citations.length ? input.citations : null,
				createdAt: new Date(now.getTime() + 1),
			},
		]);
		await transaction
			.update(advisorConversation)
			.set({ updatedAt: new Date() })
			.where(eq(advisorConversation.id, input.conversationId));
	});

	// Best-effort: let the AI Advisor's long-term memory learn from this turn.
	// mem0 decides on its own which facts are worth adding, updating, or
	// discarding, so this call never blocks or fails the chat itself.
	await rememberConversationTurn({
		userId: input.userId,
		userMessage: input.userMessage,
		assistantMessage: input.assistantContent,
	});
}

export async function sendAdvisorMessage(input: {
	userId: string;
	conversationId?: string;
	content: string;
}) {
	const [{ conversationId, history }, profile] = await Promise.all([
		resolveConversation({
			userId: input.userId,
			conversationId: input.conversationId,
			firstUserMessage: input.content,
		}),
		getStudentProfile(input.userId),
	]);

	const { reply: assistantContent, citations } = await runAdvisorAgent({
		userId: input.userId,
		profile,
		history,
		message: input.content,
	});

	await persistTurn({
		userId: input.userId,
		conversationId,
		userMessage: input.content,
		assistantContent,
		citations,
	});

	return { conversationId };
}

export type AdvisorStreamMessageEvent =
	| { type: "conversation"; conversationId: string }
	| { type: "delta"; text: string }
	| { type: "done"; citations: AdvisorCitation[] }
	| { type: "error"; message: string };

/**
 * Streaming counterpart to {@link sendAdvisorMessage}, for the
 * `/api/advisor/stream` route: yields the resolved conversation id first
 * (the client needs it before the reply finishes, to update the URL), then
 * text deltas as they're generated, then persists the full turn exactly
 * like the buffered path before yielding `done`.
 */
export async function* streamAdvisorMessage(input: {
	userId: string;
	conversationId?: string;
	content: string;
}): AsyncGenerator<AdvisorStreamMessageEvent> {
	// Started concurrently with conversation resolution, not awaited together:
	// the conversation id must still reach the client as soon as possible (see
	// below), so this is only actually awaited right before it's needed.
	const profilePromise = getStudentProfile(input.userId);

	const { conversationId, history } = await resolveConversation({
		userId: input.userId,
		conversationId: input.conversationId,
		firstUserMessage: input.content,
	});
	yield { type: "conversation", conversationId };

	let fullText = "";
	let citations: AdvisorCitation[] = [];

	for await (const event of streamAdvisorAgent({
		userId: input.userId,
		profile: await profilePromise,
		history,
		message: input.content,
	})) {
		if (event.type === "delta") {
			fullText += event.text;
			yield { type: "delta", text: event.text };
		} else if (event.type === "done") {
			fullText = event.fullText;
			citations = event.citations;
		} else if (event.type === "error") {
			yield { type: "error", message: event.message };
			return;
		}
	}

	await persistTurn({
		userId: input.userId,
		conversationId,
		userMessage: input.content,
		assistantContent: fullText,
		citations,
	});

	yield { type: "done", citations };
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
