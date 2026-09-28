CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
-- Small helper so search-vector triggers don't repeat the 'english' config.
CREATE OR REPLACE FUNCTION public.english_tsvector(input text)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
	SELECT to_tsvector('english', coalesce(input, ''));
$$;--> statement-breakpoint
CREATE TYPE "public"."abstract_source" AS ENUM('explicit', 'generated');--> statement-breakpoint
CREATE TYPE "public"."ingestion_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."project_link_type" AS ENUM('github', 'live', 'demo', 'social', 'other');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'ready_to_publish', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "document" (
	"id" text PRIMARY KEY NOT NULL,
	"uploaded_by_user_id" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"page_count" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "ingestion_job" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"status" "ingestion_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"created_by_user_id" text NOT NULL,
	"source_document_id" text,
	"source_ingestion_job_id" text,
	"source_page_range_start" integer,
	"source_page_range_end" integer,
	"source_sections" text[],
	"title" text,
	"author" text,
	"department" text,
	"faculty" text,
	"project_type" text,
	"research_area" text,
	"keywords" text[],
	"technologies" text[],
	"problem_statement" text,
	"objectives" text[],
	"methodology" text,
	"results" text,
	"conclusion" text,
	"project_year" integer,
	"abstract" text,
	"abstract_source" "abstract_source",
	"original_abstract" text,
	"generated_abstract" text,
	"abstract_evidence" jsonb,
	"extraction_confidence" real,
	"extraction_evidence" jsonb,
	"status" "project_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp,
	"search_vector" "tsvector",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_chunk" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"document_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"page_number" integer,
	"section_title" text,
	"content" text NOT NULL,
	"search_vector" "tsvector",
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_link" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"type" "project_link_type" NOT NULL,
	"url" text NOT NULL,
	"label" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_job" ADD CONSTRAINT "ingestion_job_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_source_document_id_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_source_ingestion_job_id_ingestion_job_id_fk" FOREIGN KEY ("source_ingestion_job_id") REFERENCES "public"."ingestion_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_chunk" ADD CONSTRAINT "project_chunk_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_chunk" ADD CONSTRAINT "project_chunk_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_link" ADD CONSTRAINT "project_link_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_uploadedByUserId_idx" ON "document" USING btree ("uploaded_by_user_id");--> statement-breakpoint
CREATE INDEX "ingestion_job_documentId_idx" ON "ingestion_job" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "ingestion_job_status_idx" ON "ingestion_job" USING btree ("status");--> statement-breakpoint
CREATE INDEX "project_createdByUserId_idx" ON "project" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "project_sourceDocumentId_idx" ON "project" USING btree ("source_document_id");--> statement-breakpoint
CREATE INDEX "project_status_idx" ON "project" USING btree ("status");--> statement-breakpoint
CREATE INDEX "project_department_idx" ON "project" USING btree ("department");--> statement-breakpoint
CREATE INDEX "project_projectYear_idx" ON "project" USING btree ("project_year");--> statement-breakpoint
CREATE INDEX "project_searchVector_idx" ON "project" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "project_chunk_projectId_idx" ON "project_chunk" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_chunk_documentId_idx" ON "project_chunk" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "project_chunk_searchVector_idx" ON "project_chunk" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "project_link_projectId_idx" ON "project_link" USING btree ("project_id");--> statement-breakpoint
-- search_vector is trigger-populated rather than a GENERATED column: Postgres
-- inlines english_tsvector() (a simple one-line SQL function) before checking
-- immutability for GENERATED ALWAYS AS, which surfaces to_tsvector's real
-- (non-immutable) volatility. A trigger has no such restriction.
CREATE OR REPLACE FUNCTION public.project_search_vector_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	NEW.search_vector := english_tsvector(
		coalesce(NEW.title, '') || ' ' ||
		coalesce(NEW.abstract, '') || ' ' ||
		coalesce(NEW.research_area, '') || ' ' ||
		coalesce(array_to_string(NEW.keywords, ' '), '') || ' ' ||
		coalesce(array_to_string(NEW.technologies, ' '), '')
	);
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER project_search_vector_update
	BEFORE INSERT OR UPDATE OF title, abstract, research_area, keywords, technologies
	ON "project"
	FOR EACH ROW
	EXECUTE FUNCTION public.project_search_vector_trigger();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.project_chunk_search_vector_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	NEW.search_vector := english_tsvector(NEW.content);
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER project_chunk_search_vector_update
	BEFORE INSERT OR UPDATE OF content
	ON "project_chunk"
	FOR EACH ROW
	EXECUTE FUNCTION public.project_chunk_search_vector_trigger();