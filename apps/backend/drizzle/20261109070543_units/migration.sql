CREATE TYPE "unit_system" AS ENUM('metric', 'imperial');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "units" "unit_system" DEFAULT 'metric'::"unit_system" NOT NULL;