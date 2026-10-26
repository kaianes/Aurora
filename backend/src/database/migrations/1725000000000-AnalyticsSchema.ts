import { MigrationInterface, QueryRunner } from 'typeorm';

// E7: introduces content_submission_metric_snapshot,
// performance_metric_ingestion_attempt, campaign_performance_aggregate,
// campaign_performance_report, and client_performance_report (the
// analytics module's own tables), plus an additive extension to the
// existing agency module, agency_branding_profile (ADR-0048). Section 2 of
// the E7 architecture document. No existing E1-E6 row needs a backfill.
export class AnalyticsSchema1725000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- TABLES ----

    await queryRunner.query(`
      CREATE TABLE "content_submission_metric_snapshot" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "content_submission_id" uuid NOT NULL REFERENCES "content_submission"("id"),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "creator_id" uuid NOT NULL REFERENCES "creator"("id"),
        "platform" text NOT NULL,
        "reach" int,
        "engagement" int,
        "impressions" int,
        "ingestion_status" text NOT NULL DEFAULT 'pending_first_pull' CHECK (
          "ingestion_status" IN (
            'pending_first_pull', 'fresh', 'stale_rate_limited',
            'stale_unreachable', 'stale_auth_revoked'
          )
        ),
        "last_successful_pull_at" timestamptz,
        "last_attempted_pull_at" timestamptz,
        "next_retry_at" timestamptz,
        "consecutive_failure_count" int NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_metric_snapshot_submission" UNIQUE ("content_submission_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "performance_metric_ingestion_attempt" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "content_submission_metric_snapshot_id" uuid NOT NULL
          REFERENCES "content_submission_metric_snapshot"("id"),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "creator_id" uuid NOT NULL REFERENCES "creator"("id"),
        "attempted_at" timestamptz NOT NULL,
        "outcome" text NOT NULL CHECK (
          "outcome" IN ('success', 'rate_limited', 'auth_revoked', 'unreachable')
        ),
        "reach" int,
        "engagement" int,
        "impressions" int,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "campaign_performance_aggregate" (
        "campaign_id" uuid PRIMARY KEY REFERENCES "campaign"("id"),
        "delivered_creator_count" int NOT NULL DEFAULT 0,
        "pending_delivery_creator_count" int NOT NULL DEFAULT 0,
        "total_delivered_reach" bigint NOT NULL DEFAULT 0,
        "total_delivered_engagement" bigint NOT NULL DEFAULT 0,
        "total_delivered_impressions" bigint NOT NULL DEFAULT 0,
        "any_stale" boolean NOT NULL DEFAULT false,
        "last_computed_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_performance_aggregate_campaign" UNIQUE ("campaign_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "campaign_performance_report" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'ready', 'failed')),
        "has_deliveries" boolean,
        "spend_amount" numeric,
        "spend_source" text CHECK ("spend_source" IN ('locked_price', 'invoice')),
        "total_delivered_reach" int,
        "total_delivered_engagement" int,
        "cost_per_engagement" numeric,
        "cpm_equivalent" numeric,
        "campaign_progress_label" text CHECK ("campaign_progress_label" IN ('in_progress', 'final')),
        "pdf_document_url" text,
        "csv_document_url" text,
        "requested_by_user_id" uuid NOT NULL REFERENCES "user"("id"),
        "requested_at" timestamptz NOT NULL DEFAULT now(),
        "resolved_at" timestamptz
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "client_performance_report" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "account_id" uuid NOT NULL REFERENCES "account"("id"),
        "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'ready', 'failed')),
        "campaign_count" int,
        "total_spend" numeric,
        "total_delivered_reach" int,
        "total_delivered_engagement" int,
        "cost_per_engagement" numeric,
        "cpm_equivalent" numeric,
        "branding_applied" boolean,
        "pdf_document_url" text,
        "csv_document_url" text,
        "requested_by_user_id" uuid NOT NULL REFERENCES "user"("id"),
        "requested_at" timestamptz NOT NULL DEFAULT now(),
        "resolved_at" timestamptz
      )
    `);

    // Additive extension to the existing agency module (section 2.3,
    // ADR-0048). Owned long-term by E9.
    await queryRunner.query(`
      CREATE TABLE "agency_branding_profile" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "workspace_id" uuid NOT NULL REFERENCES "workspace"("id"),
        "logo_url" text,
        "primary_color_hex" text,
        "secondary_color_hex" text,
        "updated_by_user_id" uuid REFERENCES "user"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_branding_workspace" UNIQUE ("workspace_id")
      )
    `);

    // ---- CONSTRAINTS (section 2.6) ----

    await queryRunner.query(`
      ALTER TABLE "campaign_performance_report" ADD CONSTRAINT "chk_cost_efficiency_consistency"
        CHECK (
          ("has_deliveries" IS DISTINCT FROM true AND "cost_per_engagement" IS NULL AND "cpm_equivalent" IS NULL)
          OR ("has_deliveries" = true)
          OR ("status" != 'ready')
        )
    `);

    // ---- APPEND-ONLY TRIGGER (same precedent as audit_log,
    // payout_execution_attempt) ----

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_ingestion_attempt_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'performance_metric_ingestion_attempt is append-only: UPDATE and DELETE are prohibited';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER ingestion_attempt_immutable
        BEFORE UPDATE OR DELETE ON "performance_metric_ingestion_attempt"
        FOR EACH ROW EXECUTE FUNCTION prevent_ingestion_attempt_mutation()
    `);

    // ---- ROW-LEVEL SECURITY (section 2.5 of the E7 architecture doc) ----

    await queryRunner.query(
      `ALTER TABLE "content_submission_metric_snapshot" ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_submission_metric_snapshot" FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "content_submission_metric_snapshot"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
          )
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);
    // Actual "only this creator's own snapshots" restriction is enforced in
    // application code (filtering by creator_id against the caller's JWT
    // claim), the same discipline E3/E5/E6 already apply for this actor type.

    await queryRunner.query(
      `ALTER TABLE "performance_metric_ingestion_attempt" ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE "performance_metric_ingestion_attempt" FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "performance_metric_ingestion_attempt"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
          )
        )
    `);
    // No creator_portal branch: this append-only log is never read by a
    // creator directly, same precedent as briefing_distribution_recipient.

    // campaign_performance_aggregate carries the one new escape hatch this
    // epic introduces, app.agency_cross_client_read (US-46, ADR-0048),
    // narrower in scope than app.aurora_operator -- gated on the caller's
    // own workspace, not an unrestricted cross-tenant reach. The service
    // layer independently validates operator_client_access per requested
    // client_account_id before this flag is ever set on the connection
    // (section 2.5 of the E7 architecture doc).
    await queryRunner.query(`ALTER TABLE "campaign_performance_aggregate" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "campaign_performance_aggregate" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "campaign_performance_aggregate"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
          )
          OR (
            current_setting('app.agency_cross_client_read', true) = 'true'
            AND "campaign_id" IN (
              SELECT c."id" FROM "campaign" c
              JOIN "account" a ON a."id" = c."account_id"
              WHERE a."workspace_id" = current_setting('app.current_workspace_id', true)::uuid
            )
          )
        )
    `);

    await queryRunner.query(`ALTER TABLE "campaign_performance_report" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "campaign_performance_report" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "campaign_performance_report"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
          )
        )
    `);
    // No creator-portal branch: neither Marina's dashboard nor her report
    // export is a creator-facing surface.

    await queryRunner.query(`ALTER TABLE "client_performance_report" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "client_performance_report" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "client_performance_report"
        USING ("account_id" = current_setting('app.current_account_id', true)::uuid)
    `);

    // agency_branding_profile: workspace-level settings, not account-scoped
    // (no campaign_id or account_id to join through). Readable/writable
    // only by agency_admin via application-layer @Roles() checks (section
    // 2.4); no RLS policy is defined since this table carries no
    // account_id/campaign_id column for the standard tenant join to key
    // off, the same posture E1 takes toward workspace itself.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "client_performance_report"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "campaign_performance_report"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "campaign_performance_aggregate"`);
    await queryRunner.query(
      `DROP POLICY IF EXISTS tenant_isolation ON "performance_metric_ingestion_attempt"`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS tenant_isolation ON "content_submission_metric_snapshot"`,
    );

    await queryRunner.query(
      `DROP TRIGGER IF EXISTS ingestion_attempt_immutable ON "performance_metric_ingestion_attempt"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_ingestion_attempt_mutation()`);

    await queryRunner.query(
      `ALTER TABLE "campaign_performance_report" DROP CONSTRAINT IF EXISTS "chk_cost_efficiency_consistency"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "agency_branding_profile"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "client_performance_report"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "campaign_performance_report"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "campaign_performance_aggregate"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "performance_metric_ingestion_attempt"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "content_submission_metric_snapshot"`);
  }
}
