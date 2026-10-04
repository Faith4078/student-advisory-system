-- (1) The project search_vector trigger previously omitted department and
-- project_type, so a plain-text search for e.g. "SIWES" or a department name
-- could not match via lexical search at all, only via the separate exact-
-- equality filter dropdown. Fold both into the indexed text.
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
		coalesce(array_to_string(NEW.technologies, ' '), '') || ' ' ||
		coalesce(NEW.department, '') || ' ' ||
		coalesce(NEW.project_type, '')
	);
	RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS project_search_vector_update ON "project";--> statement-breakpoint
CREATE TRIGGER project_search_vector_update
	BEFORE INSERT OR UPDATE OF title, abstract, research_area, keywords, technologies, department, project_type
	ON "project"
	FOR EACH ROW
	EXECUTE FUNCTION public.project_search_vector_trigger();--> statement-breakpoint
-- Backfill already-published rows so existing projects benefit immediately,
-- without waiting for an unrelated future edit to re-fire the trigger. This
-- sets search_vector directly rather than touching title/etc., so it does
-- not fire the trigger above again and does not bump updated_at.
UPDATE "project" SET search_vector = public.english_tsvector(
	coalesce(title, '') || ' ' ||
	coalesce(abstract, '') || ' ' ||
	coalesce(research_area, '') || ' ' ||
	coalesce(array_to_string(keywords, ' '), '') || ' ' ||
	coalesce(array_to_string(technologies, ' '), '') || ' ' ||
	coalesce(department, '') || ' ' ||
	coalesce(project_type, '')
);--> statement-breakpoint
-- (2) pg_trgm: trigram similarity for typo-tolerant title matching. Neither
-- a plain lexical tsquery nor a semantic embedding reliably survives an
-- unambiguous misspelling of an otherwise-exact title (a few swapped/dropped
-- letters can shift an embedding just enough to miss the distance
-- threshold). pg_trgm is a standard, bundled Postgres extension — no new
-- external service, no added latency beyond an indexed similarity() query —
-- and is the conventional fix for exactly this failure mode.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_title_trgm_idx" ON "project" USING gin ("title" gin_trgm_ops);
