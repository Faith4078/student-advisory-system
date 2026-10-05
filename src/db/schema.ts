import { relations, sql } from "drizzle-orm";
import {
	boolean,
	customType,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	real,
	text,
	timestamp,
	vector,
} from "drizzle-orm/pg-core";

// Confirmed live against Jina's embeddings API (model "jina-embeddings-v3")
// on 2026-09-28 — see src/lib/jina.server.ts's EMBEDDING_DIMENSIONS constant,
// which is the source of truth this must stay in sync with.
const EMBEDDING_DIMENSIONS = 1024;

const tsvector = customType<{ data: string }>({
	dataType() {
		return "tsvector";
	},
});

// A concrete, recursively JSON-safe type for jsonb columns — `unknown` (the
// default drizzle infers without `.$type()`) can't be proven serializable
// across the TanStack Start server-function RPC boundary.
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").default(false).notNull(),
	image: text("image"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.defaultNow()
		.$onUpdate(() => /* @__PURE__ */ new Date())
		.notNull(),
	username: text("username").unique(),
	displayUsername: text("display_username"),
	firstName: text("first_name").notNull(),
	lastName: text("last_name").notNull(),
	department: text("department").notNull(),
	bio: text("bio"),
	interests: text("interests").array().notNull().default(sql`'{}'::text[]`),
});

export const session = pgTable(
	"session",
	{
		id: text("id").primaryKey(),
		expiresAt: timestamp("expires_at").notNull(),
		token: text("token").notNull().unique(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: timestamp("access_token_expires_at"),
		refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
		scope: text("scope"),
		password: text("password"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: timestamp("expires_at").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const recoveryCredential = pgTable("recovery_credential", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	codeHash: text("code_hash").notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.defaultNow()
		.$onUpdate(() => /* @__PURE__ */ new Date())
		.notNull(),
});

export const advisorConversation = pgTable(
	"advisor_conversation",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("advisor_conversation_userId_idx").on(table.userId)],
);

export const advisorMessage = pgTable(
	"advisor_message",
	{
		id: text("id").primaryKey(),
		conversationId: text("conversation_id")
			.notNull()
			.references(() => advisorConversation.id, { onDelete: "cascade" }),
		role: text("role").notNull(),
		content: text("content").notNull(),
		// Structured, server-resolved citations for an assistant message: the
		// project/chunk records the agent's tools actually retrieved this turn
		// (never text the model merely claims). Null for user messages and for
		// assistant replies that used no tools.
		sources: jsonb("sources").$type<Json | null>(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("advisor_message_conversationId_idx").on(table.conversationId),
	],
);

export const ingestionStatusEnum = pgEnum("ingestion_status", [
	"pending",
	"processing",
	"completed",
	"failed",
]);

export const projectStatusEnum = pgEnum("project_status", [
	"draft",
	"ready_to_publish",
	"published",
	"archived",
]);

export const projectLinkTypeEnum = pgEnum("project_link_type", [
	"github",
	"live",
	"demo",
	"social",
	"other",
]);

export const abstractSourceEnum = pgEnum("abstract_source", [
	"explicit",
	"generated",
]);

export const document = pgTable(
	"document",
	{
		id: text("id").primaryKey(),
		uploadedByUserId: text("uploaded_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		fileName: text("file_name").notNull(),
		mimeType: text("mime_type").notNull(),
		fileSizeBytes: integer("file_size_bytes").notNull(),
		// Cloudflare R2 object key. The document's bytes live in R2, never in Postgres.
		storageKey: text("storage_key").notNull().unique(),
		pageCount: integer("page_count"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("document_uploadedByUserId_idx").on(table.uploadedByUserId),
	],
);

export const ingestionJob = pgTable(
	"ingestion_job",
	{
		id: text("id").primaryKey(),
		documentId: text("document_id")
			.notNull()
			.references(() => document.id, { onDelete: "cascade" }),
		status: ingestionStatusEnum("status").notNull().default("pending"),
		attempts: integer("attempts").notNull().default(0),
		errorMessage: text("error_message"),
		startedAt: timestamp("started_at"),
		completedAt: timestamp("completed_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("ingestion_job_documentId_idx").on(table.documentId),
		index("ingestion_job_status_idx").on(table.status),
	],
);

export const project = pgTable(
	"project",
	{
		id: text("id").primaryKey(),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		sourceDocumentId: text("source_document_id").references(() => document.id, {
			onDelete: "set null",
		}),
		sourceIngestionJobId: text("source_ingestion_job_id").references(
			() => ingestionJob.id,
			{ onDelete: "set null" },
		),
		sourcePageRangeStart: integer("source_page_range_start"),
		sourcePageRangeEnd: integer("source_page_range_end"),
		sourceSections: text("source_sections").array(),

		// Every extractable field is nullable: the AI must return null rather
		// than invent a value it cannot support from the source document.
		title: text("title"),
		author: text("author"),
		department: text("department"),
		faculty: text("faculty"),
		projectType: text("project_type"),
		researchArea: text("research_area"),
		keywords: text("keywords").array(),
		technologies: text("technologies").array(),
		problemStatement: text("problem_statement"),
		objectives: text("objectives").array(),
		methodology: text("methodology"),
		results: text("results"),
		conclusion: text("conclusion"),
		projectYear: integer("project_year"),

		// Full verbatim text of this project's own source pages (not the short
		// structured summary fields above) — the basis for late-chunked, full-
		// document-aware chunk embeddings. Null for manually-entered projects,
		// which have no source document to transcribe; they keep chunking from
		// structured fields (see chunking.server.ts).
		fullText: text("full_text"),

		// Abstract provenance (section 7): the displayed `abstract` is either the
		// explicit one found in the source, or one Gemini generated because none
		// existed or the existing text was inadequate/non-academic.
		abstract: text("abstract"),
		abstractSource: abstractSourceEnum("abstract_source"),
		originalAbstract: text("original_abstract"),
		generatedAbstract: text("generated_abstract"),
		abstractEvidence: jsonb("abstract_evidence").$type<Json | null>(),

		extractionConfidence: real("extraction_confidence"),
		extractionEvidence: jsonb("extraction_evidence").$type<Json | null>(),

		status: projectStatusEnum("status").notNull().default("draft"),
		publishedAt: timestamp("published_at"),

		// Author-controlled: whether other students may download this
		// project's full source PDF. Off by default — the report can always
		// be viewed inline (e.g. the AI Advisor's cited-page viewer), but
		// saving a copy requires the author's explicit opt-in.
		allowDownload: boolean("allow_download").notNull().default(false),

		// Lexical search vector for fast project-level filtering on /projects,
		// independent of the deeper chunk-level hybrid retrieval. Populated by
		// a BEFORE INSERT/UPDATE trigger (see the migration), not a generated
		// column: to_tsvector(regconfig, text) is STABLE, and Postgres/Neon
		// rejects STABLE calls in a GENERATED ALWAYS AS expression even behind
		// an IMMUTABLE SQL wrapper, since simple SQL functions get inlined
		// before that check runs.
		searchVector: tsvector("search_vector"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("project_createdByUserId_idx").on(table.createdByUserId),
		index("project_sourceDocumentId_idx").on(table.sourceDocumentId),
		index("project_status_idx").on(table.status),
		index("project_department_idx").on(table.department),
		index("project_projectYear_idx").on(table.projectYear),
		index("project_searchVector_idx").using("gin", table.searchVector),
	],
);

export const projectLink = pgTable(
	"project_link",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		type: projectLinkTypeEnum("type").notNull(),
		url: text("url").notNull(),
		label: text("label"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [index("project_link_projectId_idx").on(table.projectId)],
);

export const projectChunk = pgTable(
	"project_chunk",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		// Nullable: manually-entered projects have no source document, but still
		// get chunked/embedded from their structured fields for hybrid search
		// parity with AI-extracted ones (see chunking.server.ts).
		documentId: text("document_id").references(() => document.id, {
			onDelete: "cascade",
		}),
		chunkIndex: integer("chunk_index").notNull(),
		pageNumber: integer("page_number"),
		sectionTitle: text("section_title"),
		content: text("content").notNull(),
		// Confirmed live against Jina's real embeddings API — see
		// EMBEDDING_DIMENSIONS above. Nullable: populated by the ingestion
		// pipeline after a chunk is created, not at insert time.
		embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
		// Populated by a BEFORE INSERT/UPDATE trigger — see the migration and
		// the project.searchVector comment above for why.
		searchVector: tsvector("search_vector"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("project_chunk_projectId_idx").on(table.projectId),
		index("project_chunk_documentId_idx").on(table.documentId),
		index("project_chunk_searchVector_idx").using("gin", table.searchVector),
		index("project_chunk_embedding_idx").using(
			"hnsw",
			table.embedding.op("vector_cosine_ops"),
		),
	],
);

export const userRelations = relations(user, ({ many }) => ({
	sessions: many(session),
	accounts: many(account),
	advisorConversations: many(advisorConversation),
	documents: many(document),
	projects: many(project),
}));

export const documentRelations = relations(document, ({ one, many }) => ({
	uploadedBy: one(user, {
		fields: [document.uploadedByUserId],
		references: [user.id],
	}),
	ingestionJobs: many(ingestionJob),
	projects: many(project),
	chunks: many(projectChunk),
}));

export const ingestionJobRelations = relations(
	ingestionJob,
	({ one, many }) => ({
		document: one(document, {
			fields: [ingestionJob.documentId],
			references: [document.id],
		}),
		projects: many(project),
	}),
);

export const projectRelations = relations(project, ({ one, many }) => ({
	createdBy: one(user, {
		fields: [project.createdByUserId],
		references: [user.id],
	}),
	sourceDocument: one(document, {
		fields: [project.sourceDocumentId],
		references: [document.id],
	}),
	sourceIngestionJob: one(ingestionJob, {
		fields: [project.sourceIngestionJobId],
		references: [ingestionJob.id],
	}),
	links: many(projectLink),
	chunks: many(projectChunk),
}));

export const projectLinkRelations = relations(projectLink, ({ one }) => ({
	project: one(project, {
		fields: [projectLink.projectId],
		references: [project.id],
	}),
}));

export const projectChunkRelations = relations(projectChunk, ({ one }) => ({
	project: one(project, {
		fields: [projectChunk.projectId],
		references: [project.id],
	}),
	document: one(document, {
		fields: [projectChunk.documentId],
		references: [document.id],
	}),
}));

export const recoveryCredentialRelations = relations(
	recoveryCredential,
	({ one }) => ({
		user: one(user, {
			fields: [recoveryCredential.userId],
			references: [user.id],
		}),
	}),
);

export const sessionRelations = relations(session, ({ one }) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id],
	}),
}));

export const accountRelations = relations(account, ({ one }) => ({
	user: one(user, {
		fields: [account.userId],
		references: [user.id],
	}),
}));

export const advisorConversationRelations = relations(
	advisorConversation,
	({ one, many }) => ({
		user: one(user, {
			fields: [advisorConversation.userId],
			references: [user.id],
		}),
		messages: many(advisorMessage),
	}),
);

export const advisorMessageRelations = relations(advisorMessage, ({ one }) => ({
	conversation: one(advisorConversation, {
		fields: [advisorMessage.conversationId],
		references: [advisorConversation.id],
	}),
}));
