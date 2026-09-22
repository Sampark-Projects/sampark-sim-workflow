CREATE TABLE "itsm_organization_link" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"sim_user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"webhook_url" text,
	"webhook_signing_secret_encrypted" text,
	"last_webhook_delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itsm_workflow_sync_state" (
	"workflow_id" text PRIMARY KEY NOT NULL,
	"last_synced_at" timestamp,
	"last_synced_updated_at" timestamp,
	"last_attempt_at" timestamp,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "itsm_organization_link" ADD CONSTRAINT "itsm_organization_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm_organization_link" ADD CONSTRAINT "itsm_organization_link_sim_user_id_user_id_fk" FOREIGN KEY ("sim_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm_workflow_sync_state" ADD CONSTRAINT "itsm_workflow_sync_state_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "itsm_organization_link_organization_unique" ON "itsm_organization_link" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "itsm_organization_link_customer_id_unique" ON "itsm_organization_link" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "itsm_organization_link_sim_user_id_unique" ON "itsm_organization_link" USING btree ("sim_user_id");