import {
	createFileRoute,
	Link,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
	Bot,
	Download,
	MessageSquareText,
	PanelLeft,
	Pencil,
	Plus,
	Send,
	Sparkles,
	Trash2,
	X,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import {
	DashboardSidebar,
	DashboardTopbar,
} from "../components/dashboard-shell";
import {
	deleteAdvisorChat,
	loadAdvisorState,
	renameAdvisorChat,
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
	component: AdvisorRoute,
});

function AdvisorRoute() {
	const { chat } = Route.useSearch();
	// Keying on `chat` forces a full remount (all local state, including
	// `displayMessages`, reset from scratch) whenever the active conversation
	// identity changes — switching chats or starting a new one — rather than
	// relying on an effect to notice and resync in time. That effect-based
	// sync is still correct for same-conversation updates (see below), but
	// proved too easy to race against a fast-follow navigation: TanStack
	// Router's own preload/cancellation timing could leave a stale fetch's
	// result landing after a navigation, and no amount of guarding that one
	// call site closed every path to it. A remount can't observe stale data
	// because it never existed in the new instance.
	return <AdvisorPage key={chat ?? "__latest__"} />;
}

const starterPrompts = [
	"Help me turn my project idea into a research topic",
	"Suggest project topics for my department",
	"Help me define scope and objectives",
];

type LoaderMessages = Awaited<ReturnType<typeof loadAdvisorState>>["messages"];
type ChatMessage = LoaderMessages[number];

type StreamEvent =
	| { type: "conversation"; conversationId: string }
	| { type: "delta"; text: string }
	| { type: "done"; citations: ChatMessage["sources"] }
	| { type: "error"; message: string };

function parseSseFrame(frame: string): StreamEvent | null {
	const trimmed = frame.trim();
	if (!trimmed.startsWith("data:")) return null;
	try {
		return JSON.parse(trimmed.slice(5).trim());
	} catch {
		return null;
	}
}

function AdvisorPage() {
	const { user } = Route.useRouteContext();
	const { chat } = Route.useSearch();
	const { conversations, messages, activeConversation } = Route.useLoaderData();
	const navigate = Route.useNavigate();
	const router = useRouter();
	const renameChat = useServerFn(renameAdvisorChat);
	const deleteChat = useServerFn(deleteAdvisorChat);
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [chatListOpen, setChatListOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const [prompt, setPrompt] = useState("");
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [draftTitle, setDraftTitle] = useState("");
	// The one cited page currently shown inline, if any — only ever one at a
	// time, toggled open/closed by clicking its "p. N" chip in a message's
	// Sources list (see the image panel rendered just below that list).
	const [openPage, setOpenPage] = useState<{
		projectId: string;
		pageNumber: number;
	} | null>(null);
	const [displayMessages, setDisplayMessages] =
		useState<ChatMessage[]>(messages);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const firstName = user.firstName || user.name.split(" ")[0] || "Student";
	const initials =
		`${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}` || "ST";

	// The loader's `messages` is the source of truth whenever we're not
	// actively streaming a reply (switching conversations, after rename,
	// after a stream persists and we invalidate). During a stream, local
	// deltas are appended directly instead of re-syncing from here.
	useEffect(() => {
		setDisplayMessages(messages);
	}, [messages]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-scrolls on every streamed delta, not just when the message list itself changes
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({
			behavior: "smooth",
			block: "end",
		});
	}, [displayMessages]);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (pending) return;
		const content = prompt.trim();
		if (content.length < 2) return;

		setPrompt("");
		setPending(true);

		const now = new Date().toISOString();
		const userMessageId = `pending-user-${Date.now()}`;
		const assistantMessageId = `pending-assistant-${Date.now()}`;
		setDisplayMessages((prev) => [
			...prev,
			{
				id: userMessageId,
				role: "user",
				content,
				sources: null,
				createdAt: now,
			},
			{
				id: assistantMessageId,
				role: "assistant",
				content: "",
				sources: null,
				createdAt: now,
			},
		]);

		let resolvedConversationId = activeConversation ?? undefined;
		let streamFailed = false;

		try {
			const response = await fetch("/api/advisor/stream", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					conversationId: resolvedConversationId,
					content,
				}),
			});
			if (!response.ok || !response.body) {
				throw new Error(`Advisor stream request failed (${response.status})`);
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const frames = buffer.split("\n\n");
				buffer = frames.pop() ?? "";
				for (const frame of frames) {
					const event = parseSseFrame(frame);
					if (!event) continue;
					if (event.type === "conversation") {
						resolvedConversationId = event.conversationId;
					} else if (event.type === "delta") {
						setDisplayMessages((prev) =>
							prev.map((message) =>
								message.id === assistantMessageId
									? { ...message, content: message.content + event.text }
									: message,
							),
						);
					} else if (event.type === "done") {
						setDisplayMessages((prev) =>
							prev.map((message) =>
								message.id === assistantMessageId
									? { ...message, sources: event.citations }
									: message,
							),
						);
					} else if (event.type === "error") {
						streamFailed = true;
						setDisplayMessages((prev) =>
							prev.map((message) =>
								message.id === assistantMessageId
									? { ...message, content: event.message }
									: message,
							),
						);
					}
				}
			}
		} catch {
			streamFailed = true;
			toast.error("The advisor could not answer that.");
			setDisplayMessages((prev) =>
				prev.filter(
					(message) =>
						message.id !== userMessageId && message.id !== assistantMessageId,
				),
			);
		} finally {
			setPending(false);
		}

		// Sync the URL/sidebar to the resolved conversation — but only if the
		// user is still exactly where they were when this send started. If
		// they've since navigated away (clicked "New chat", switched to a
		// different conversation), none of this has any business running: a
		// late-landing `navigate()` would silently override where they just
		// went, and a late-landing `invalidate()` can refetch/overwrite the
		// view they're now looking at with data for the view they left. Their
		// own navigation already triggers a fresh loader call on its own, so
		// skipping this entirely when they've moved on loses nothing.
		if (!streamFailed && resolvedConversationId) {
			const stillOnSameView = () => router.state.location.search.chat === chat;
			if (stillOnSameView() && resolvedConversationId !== chat) {
				await navigate({
					to: "/dashboard/advisor",
					search: { chat: resolvedConversationId },
				});
			}
			if (stillOnSameView()) {
				await router.invalidate({ sync: true });
			}
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
								search={{ chat: "new" }}
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
							{displayMessages.length === 0 ? (
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
								displayMessages.map((message, index) => {
									const projectSources = Array.from(
										(message.sources ?? [])
											.filter((source) => source.projectId)
											.reduce(
												(map, source) => {
													const projectId = source.projectId as string;
													const existing = map.get(projectId) ?? {
														id: projectId,
														title: source.title ?? null,
														allowDownload: false,
														pages: [] as Array<{
															pageNumber: number;
															sectionTitle: string | null;
														}>,
													};
													if (!existing.title && source.title) {
														existing.title = source.title;
													}
													if (source.allowDownload) {
														existing.allowDownload = true;
													}
													// Chunk-level citations carry a section/page
													// location; project-level ones don't — only the former
													// lets the student open the exact cited page inline.
													if (
														source.pageNumber &&
														!existing.pages.some(
															(p) => p.pageNumber === source.pageNumber,
														)
													) {
														existing.pages.push({
															pageNumber: source.pageNumber,
															sectionTitle: source.sectionTitle ?? null,
														});
													}
													map.set(projectId, existing);
													return map;
												},
												new Map<
													string,
													{
														id: string;
														title: string | null;
														allowDownload: boolean;
														pages: Array<{
															pageNumber: number;
															sectionTitle: string | null;
														}>;
													}
												>(),
											)
											.values(),
									);
									const isStreamingPlaceholder =
										pending &&
										index === displayMessages.length - 1 &&
										message.role === "assistant" &&
										message.content.length === 0;
									return (
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
												{isStreamingPlaceholder ? (
													<output
														className="advisor-typing"
														aria-label="AI Advisor is thinking"
													>
														<span />
														<span />
														<span />
													</output>
												) : message.role === "assistant" ? (
													<div className="advisor-markdown">
														<ReactMarkdown remarkPlugins={[remarkGfm]}>
															{message.content}
														</ReactMarkdown>
													</div>
												) : (
													<p>{message.content}</p>
												)}
												{projectSources.length > 0 && (
													<div className="advisor-message-sources">
														<span>Sources:</span>
														{projectSources.map((source) => (
															<span className="advisor-source" key={source.id}>
																<Link
																	to="/projects/$projectId"
																	params={{ projectId: source.id }}
																	target="_blank"
																>
																	{source.title || "View project"}
																</Link>
																{source.pages.length > 0 && (
																	<span className="advisor-source-pages">
																		{source.pages.map((page) => {
																			const isOpen =
																				openPage?.projectId === source.id &&
																				openPage.pageNumber === page.pageNumber;
																			return (
																				<button
																					type="button"
																					key={page.pageNumber}
																					className={
																						isOpen
																							? "advisor-page-chip is-open"
																							: "advisor-page-chip"
																					}
																					title={page.sectionTitle ?? undefined}
																					onClick={() =>
																						setOpenPage(
																							isOpen
																								? null
																								: {
																										projectId: source.id,
																										pageNumber: page.pageNumber,
																									},
																						)
																					}
																				>
																					p. {page.pageNumber}
																				</button>
																			);
																		})}
																	</span>
																)}
															</span>
														))}
													</div>
												)}
												{openPage &&
													(() => {
														const openSource = projectSources.find(
															(source) =>
																source.id === openPage?.projectId &&
																source.pages.some(
																	(page) =>
																		page.pageNumber === openPage?.pageNumber,
																),
														);
														if (!openSource) return null;
														return (
															<div className="advisor-page-preview">
																<div className="advisor-page-preview-head">
																	<span>Page {openPage.pageNumber}</span>
																	<div className="advisor-page-preview-actions">
																		{openSource.allowDownload && (
																			<a
																				href={`/api/projects/${openPage.projectId}/document?download=1`}
																				target="_blank"
																				rel="noreferrer"
																				className="advisor-page-download"
																			>
																				<Download size={14} /> Download PDF
																			</a>
																		)}
																		<button
																			type="button"
																			onClick={() => setOpenPage(null)}
																			aria-label="Close document preview"
																		>
																			<X size={15} />
																		</button>
																	</div>
																</div>
																<iframe
																	key={`${openPage.projectId}-${openPage.pageNumber}`}
																	src={`/api/projects/${openPage.projectId}/document#page=${openPage.pageNumber}`}
																	title={`Cited report, page ${openPage.pageNumber}`}
																	className="advisor-page-preview-frame"
																/>
															</div>
														);
													})()}
											</div>
										</article>
									);
								})
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
