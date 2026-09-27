ALTER TABLE "user" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "interests" text[] DEFAULT '{}'::text[] NOT NULL;