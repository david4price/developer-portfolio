CREATE TABLE "projects" (
	"slug" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"description" text NOT NULL,
	"kind" text NOT NULL,
	"technologies" text[] NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"repository_url" text,
	"live_url" text,
	"mini_app_slug" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
