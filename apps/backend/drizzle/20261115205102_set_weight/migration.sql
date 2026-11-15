ALTER TABLE "set_entries" ADD COLUMN "weight_kg" numeric(7,3);--> statement-breakpoint
CREATE INDEX "set_entries_exercise_created_idx" ON "set_entries" ("exercise_id","created_at");--> statement-breakpoint
ALTER TABLE "set_entries" ADD CONSTRAINT "set_entries_weight_positive" CHECK ("weight_kg" is null or "weight_kg" > 0);