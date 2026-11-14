ALTER TABLE "ai_usage" ADD COLUMN "client_key" text;--> statement-breakpoint
CREATE INDEX "ai_usage_client_created_idx" ON "ai_usage" USING btree ("client_key","created_at");