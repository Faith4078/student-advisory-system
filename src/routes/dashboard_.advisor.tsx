import {
	createFileRoute,
	Link,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
	Bot,
	MessageSquareText,
	PanelLeft,
	Pencil,
	Plus,
	Send,
	Sparkles,
	Trash2,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DashboardSidebar, DashboardTopbar } from "../components/dashboard-shell";
import {
	deleteAdvisorChat,
	loadAdvisorState,
	renameAdvisorChat,
	sendAdvisorPrompt,
} from "../lib/advisor.functions";
import { getSession } from "../lib/auth.functions";

function normalizeSearch(search: Record<string, unknown>) {
	return { chat: typeof search.chat === "string" ? search.chat : undefined };
}

export const Route = createFileRoute("/dashboard_/advisor")({
	validateSearch: normalizeSearch,
	beforeLoad: async ({ location }) => {
		const session = await getSession();
		if (!session) {
			throw redirect({
				to: "/signin",
				search: { redirect: location.href },
			});
		}
		return { user: session.user };
	},
	loaderDeps: ({ search }) => ({ chat: search.chat }),
	loader: ({ deps }) => loadAdvisorState({ data: { chatId: deps.chat } }),
	component: AdvisorPage,
});

const starterPrompts = [
	"Help me turn my project idea into a research topic",
	"Suggest project topics for my department",
	"Help me define scope and objectives",
];

function AdvisorPage() {
	const { user } = Route.useRouteContext();
	const { chat } = Route.useSearch();
	const { conversations, messages, activeConversation } = Route.useLoaderData();
	const navigate = Route.useNavigate();
	const router = useRouter();
	const sendPrompt = useServerFn(sendAdvisorPrompt);
	const renameChat = useServerFn(renameAdvisorChat);
	const deleteChat = useServerFn(deleteAdvisorChat);
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [chatListOpen, setChatListOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const [prompt, setPrompt] = useState("");
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [draftTitle, setDraftTitle] = useState("");
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const firstName = user.firstName || user.name.split(" ")[0] || "Student";
	const initials =
		`${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}` || "ST";

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({
			behavior: "smooth",
			block: "end",
		});
	}, []);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (pending) return;
		const content = prompt.trim();
		if (content.length < 2) return;

		setPending(true);
		try {
			const result = await sendPrompt({
				data: { conversationId: activeConversation ?? undefined, content },
			});
			setPrompt("");
			if (result.conversationId !== chat) {
				await navigate({
					to: "/dashboard/advisor",
					search: { chat: result.conversationId },
				});
			}
			await router.invalidate({ sync: true });
		} catch {
			toast.error("The advisor could not save that message.");
		} finally {
			setPending(false);
		}
	}

	async function submitRename(conversationId: string) {
		const title = draftTitle.trim();
		if (!title) return;
		try {
			await renameChat({ data: { conversationId, title } });
			setRenamingId(null);
			setDraftTitle("");
			await router.invalidate({ sync: true });
			toast.success("Conversation renamed.");
		} catch {
			toast.error("We couldn't rename that conversation.");
		}
	}

	async function removeConversation(conversationId: string) {
		try {
			await deleteChat({ data: { conversationId } });
			if (conversationId === activeConversation) {
				await navigate({
					to: "/dashboard/advisor",
					search: { chat: undefined },
				});
			}
			await router.invalidate({ sync: true });
			toast.success("Conversation deleted.");
		} catch {
			toast.error("We couldn't delete that conversation.");
		}
	}

	function startRename(conversation: { id: string; title: string }) {
		setRenamingId(conversation.id);
		setDraftTitle(conversation.title);
	}

	return (
		<main className="dashboard-page advisor-page">
			<DashboardSidebar
				open={sidebarOpen}
				onClose={() => setSidebarOpen(false)}
				currentPath="/dashboard/advisor"
				guide={
					<>
						<span>
							<Sparkles size={15} /> Advisor memory
						</span>
						<strong>Every chat is saved.</strong>
						<p>Rename, delete, or continue previous conversations anytime.</p>
					</>
				}
			/>

			<section className="dashboard-main advisor-main">
				<DashboardTopbar
					user={user}
					onOpenSidebar={() => setSidebarOpen(true)}
				/>

				<div className="advisor-shell">
					<button
						className={
							chatListOpen ? "dashboard-scrim is-open" : "dashboard-scrim"
						}
						type="button"
						onClick={() => setChatListOpen(false)}
						aria-label="Close conversations"
					/>
					<aside
						className={
							chatListOpen ? "advisor-history is-open" : "advisor-history"
						}
					>
						<div className="advisor-history-head">
							<div>
								<span>AI ADVISOR</span>
								<h1>Conversations</h1>
							</div>
							<Link
								className="advisor-new-chat"
								to="/dashboard/advisor"
								search={{ chat: undefined }}
							>
								<Plus size={17} /> New
							</Link>
						</div>
						<div className="advisor-history-list">
							{conversations.length === 0 ? (
								<div className="advisor-history-empty">
									<MessageSquareText size={22} />
									<p>Your advisor chats will appear here.</p>
								</div>
							) : (
								conversations.map((conversation) => (
									<article
										className={
											conversation.id === activeConversation
												? "is-active"
												: undefined
										}
										key={conversation.id}
									>
										{renamingId === conversation.id ? (
											<form
												className="advisor-rename-form"
												onSubmit={(event) => {
													event.preventDefault();
													void submitRename(conversation.id);
												}}
											>
												<input
													value={draftTitle}
													onChange={(event) =>
														setDraftTitle(event.target.value)
													}
													maxLength={80}
												/>
											</form>
										) : (
											<Link
												to="/dashboard/advisor"
												search={{ chat: conversation.id }}
											>
												<strong>{conversation.title}</strong>
												<small>
													{new Date(
														conversation.updatedAt,
													).toLocaleDateString()}
												</small>
											</Link>
										)}
										<div className="advisor-chat-actions">
											<button
												type="button"
												onClick={() => startRename(conversation)}
												aria-label="Rename conversation"
											>
												<Pencil size={15} />
											</button>
											<button
												type="button"
												onClick={() => removeConversation(conversation.id)}
												aria-label="Delete conversation"
											>
												<Trash2 size={15} />
											</button>
										</div>
									</article>
								))
							)}
						</div>
					</aside>

					<section className="advisor-chat-panel">
						<header className="advisor-chat-header">
							<button
								type="button"
								onClick={() => setChatListOpen((value) => !value)}
								aria-label="Toggle conversations"
							>
								<PanelLeft size={19} />
							</button>
							<div>
								<span>AI ADVISOR</span>
								<h2>
									{activeConversation
										? conversations.find(
												(item) => item.id === activeConversation,
											)?.title
										: `Welcome back, ${firstName}`}
								</h2>
							</div>
						</header>

						<div className="advisor-messages">
							{messages.length === 0 ? (
								<div className="advisor-welcome">
									<span>
										<Bot size={26} />
									</span>
									<h2>What should we work through today?</h2>
									<p>
										Start a conversation about topic discovery, scope,
										objectives, methodology, or advisor feedback.
									</p>
									<div>
										{starterPrompts.map((starter) => (
											<button
												type="button"
												key={starter}
												onClick={() => setPrompt(starter)}
											>
												{starter}
											</button>
										))}
									</div>
								</div>
							) : (
								messages.map((message) => (
									<article
										className={`advisor-message ${message.role}`}
										key={message.id}
									>
										<span>
											{message.role === "assistant" ? (
												<Bot size={17} />
											) : (
												initials.toUpperCase()
											)}
										</span>
										<div>
											<strong>
												{message.role === "assistant" ? "AI Advisor" : "You"}
											</strong>
											<p>{message.content}</p>
										</div>
									</article>
								))
							)}
							<div ref={messagesEndRef} />
						</div>

						<form className="advisor-composer" onSubmit={handleSubmit}>
							<textarea
								value={prompt}
								onChange={(event) => setPrompt(event.target.value)}
								placeholder="Ask your advisor about topics, scope, methodology, or next steps..."
								rows={1}
							/>
							<button
								type="submit"
								disabled={pending || prompt.trim().length < 2}
								aria-label="Send message"
							>
								<Send size={18} />
							</button>
						</form>
					</section>
				</div>
			</section>
		</main>
	);
}
