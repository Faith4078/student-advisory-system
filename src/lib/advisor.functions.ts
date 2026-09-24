import { createServerFn } from "@tanstack/react-start";
import {
	getRequestHeaders,
	setResponseHeader,
} from "@tanstack/react-start/server";
import {
	deleteAdvisorConversation,
	getAdvisorState,
	renameAdvisorConversation,
	sendAdvisorMessage,
} from "./advisor.server";
import { auth } from "./auth";

type ChatIdInput = {
	chatId?: string;
};

type SendMessageInput = {
	conversationId?: string;
	content: string;
};

type RenameConversationInput = {
	conversationId: string;
	title: string;
};

type DeleteConversationInput = {
	conversationId: string;
};

async function requireUser() {
	const session = await auth.api.getSession({ headers: getRequestHeaders() });
	if (!session) throw new Error("Unauthorized");
	return session.user;
}

function cleanOptionalId(value: unknown) {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export const loadAdvisorState = createServerFn({ method: "GET" })
	.validator((data: ChatIdInput) => ({ chatId: cleanOptionalId(data.chatId) }))
	.handler(async ({ data }) => {
		setResponseHeader("Cache-Control", "no-store");
		const user = await requireUser();
		return getAdvisorState({ userId: user.id, chatId: data.chatId });
	});

export const sendAdvisorPrompt = createServerFn({ method: "POST" })
	.validator((data: SendMessageInput) => {
		const content = data.content.trim();
		if (content.length < 2 || content.length > 4000) {
			throw new Error("Message must be between 2 and 4000 characters.");
		}
		return {
			conversationId: cleanOptionalId(data.conversationId),
			content,
		};
	})
	.handler(async ({ data }) => {
		setResponseHeader("Cache-Control", "no-store");
		const user = await requireUser();
		return sendAdvisorMessage({
			userId: user.id,
			firstName: user.firstName || user.name.split(" ")[0] || "Student",
			conversationId: data.conversationId,
			content: data.content,
		});
	});

export const renameAdvisorChat = createServerFn({ method: "POST" })
	.validator((data: RenameConversationInput) => {
		const title = data.title.replace(/\s+/g, " ").trim();
		if (!data.conversationId || title.length < 1 || title.length > 80) {
			throw new Error("Invalid conversation title.");
		}
		return { conversationId: data.conversationId, title };
	})
	.handler(async ({ data }) => {
		setResponseHeader("Cache-Control", "no-store");
		const user = await requireUser();
		await renameAdvisorConversation({ userId: user.id, ...data });
		return { ok: true };
	});

export const deleteAdvisorChat = createServerFn({ method: "POST" })
	.validator((data: DeleteConversationInput) => {
		if (!data.conversationId) throw new Error("Conversation is required.");
		return { conversationId: data.conversationId };
	})
	.handler(async ({ data }) => {
		setResponseHeader("Cache-Control", "no-store");
		const user = await requireUser();
		await deleteAdvisorConversation({ userId: user.id, ...data });
		return { ok: true };
	});
