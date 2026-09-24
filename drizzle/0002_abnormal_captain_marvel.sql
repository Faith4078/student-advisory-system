CREATE TABLE "advisor_conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advisor_message" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "advisor_conversation" ADD CONSTRAINT "advisor_conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisor_message" ADD CONSTRAINT "advisor_message_conversation_id_advisor_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."advisor_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advisor_conversation_userId_idx" ON "advisor_conversation" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "advisor_message_conversationId_idx" ON "advisor_message" USING btree ("conversation_id");