ALTER TABLE "project_chunk" ADD COLUMN "embedding" vector(1024);--> statement-breakpoint
CREATE INDEX "project_chunk_embedding_idx" ON "project_chunk" USING hnsw ("embedding" vector_cosine_ops);