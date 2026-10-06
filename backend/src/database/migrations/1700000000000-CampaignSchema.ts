import { MigrationInterface, QueryRunner } from 'typeorm';

export class CampaignSchema1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- TABLES ----

    await queryRunner.query(`
      CREATE TABLE "campaign" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "account_id" uuid NOT NULL REFERENCES "account"("id"),
        "created_by_user_id" uuid NOT NULL REFERENCES "user"("id"),
        "template_id" uuid,
        "name" text NOT NULL,
        "state" text NOT NULL DEFAULT 'draft' CHECK ("state" IN
          ('draft', 'quoted', 'confirmed', 'active', 'paused', 'completed', 'cancelled')),
        "budget_amount" numeric,
        "budget_currency" text NOT NULL DEFAULT 'BRL',
        "audience_targeting" jsonb,
        "message" text,
        "deliverable_formats" jsonb,
        "timeline_start" timestamptz,
        "timeline_end" timestamptz,
        "missing_fields" text,
        "locked_price" numeric,
        "guaranteed_min_pool_size" int,
        "brand_profile_drift" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_campaign_minimum_budget" CHECK ("budget_amount" IS NULL OR "budget_amount" >= 2000.00)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "campaign_quote" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'ready', 'failed', 'no_viable_pool')),
        "guaranteed_min_pool_size" int,
        "projected_reach_low" int,
        "projected_reach_high" int,
        "total_price" numeric,
        "failure_reason" text,
        "superseded" boolean NOT NULL DEFAULT false,
        "requested_at" timestamptz NOT NULL DEFAULT now(),
        "resolved_at" timestamptz
      )
    `);

    // Only one active (non-terminal) quote request in flight per campaign at a time
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_campaign_pending_quote"
        ON "campaign_quote" ("campaign_id")
        WHERE "status" = 'pending'
    `);

    await queryRunner.query(`
      CREATE TABLE "campaign_pool_member" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "creator_id" uuid NOT NULL,
        "allocated_budget" numeric NOT NULL,
        "original_budget" numeric NOT NULL,
        "committed_budget" numeric NOT NULL DEFAULT 0,
        "status" text NOT NULL DEFAULT 'pending_publish' CHECK ("status" IN
          ('pending_publish', 'published', 'reallocation_eligible', 'excluded')),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_pool_member" UNIQUE ("campaign_id", "creator_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "campaign_reallocation_event" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "before_allocations" jsonb NOT NULL DEFAULT '{}',
        "after_allocations" jsonb NOT NULL DEFAULT '{}',
        "trigger" text NOT NULL CHECK ("trigger" IN ('scheduled', 'manual')),
        "outcome" text NOT NULL CHECK ("outcome" IN ('applied', 'skipped_stale_metrics', 'skipped_no_data')),
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "campaign_state_transition" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "from_state" text,
        "to_state" text NOT NULL,
        "actor_user_id" uuid,
        "reason" text,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "campaign_template" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "account_id" uuid NOT NULL REFERENCES "account"("id"),
        "source_campaign_id" uuid,
        "name" text NOT NULL,
        "audience_targeting" jsonb,
        "message" text,
        "deliverable_formats" jsonb,
        "timeline_shape" jsonb,
        "brand_profile_snapshot" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "reallocation_bounds" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "max_shift_pct" numeric NOT NULL DEFAULT 20,
        "min_guaranteed_share_pct" numeric NOT NULL DEFAULT 50,
        "enabled" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_reallocation_bounds_campaign" UNIQUE ("campaign_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "pool_shortfall_resolution" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "resolution_type" text NOT NULL CHECK ("resolution_type" IN ('partial_refund', 'revised_guarantee')),
        "refund_amount" numeric,
        "revised_min_pool_size" int,
        "choice_offered" boolean NOT NULL DEFAULT false,
        "chosen_by" text NOT NULL CHECK ("chosen_by" IN ('buyer', 'aurora_default')),
        "notified_at" timestamptz NOT NULL DEFAULT now(),
        "resolved_at" timestamptz,
        CONSTRAINT "uq_shortfall_campaign" UNIQUE ("campaign_id")
      )
    `);

    // ---- APPEND-ONLY TRIGGERS ----

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_campaign_state_transition_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'campaign_state_transition is append-only: UPDATE and DELETE are prohibited';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER campaign_state_transition_immutable
        BEFORE UPDATE OR DELETE ON "campaign_state_transition"
        FOR EACH ROW EXECUTE FUNCTION prevent_campaign_state_transition_mutation()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_reallocation_event_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'campaign_reallocation_event is append-only: UPDATE and DELETE are prohibited';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER reallocation_event_immutable
        BEFORE UPDATE OR DELETE ON "campaign_reallocation_event"
        FOR EACH ROW EXECUTE FUNCTION prevent_reallocation_event_mutation()
    `);

    // committed_budget can never decrease
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_committed_budget_decrease()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.committed_budget < OLD.committed_budget THEN
          RAISE EXCEPTION 'committed_budget cannot decrease';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER pool_member_committed_budget_guard
        BEFORE UPDATE ON "campaign_pool_member"
        FOR EACH ROW EXECUTE FUNCTION prevent_committed_budget_decrease()
    `);

    // ---- ROW-LEVEL SECURITY ----

    await queryRunner.query(`ALTER TABLE "campaign" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "campaign" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "campaign"
        USING ("account_id" = current_setting('app.current_account_id', true)::uuid)
    `);

    await queryRunner.query(`ALTER TABLE "campaign_template" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "campaign_template" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "campaign_template"
        USING ("account_id" = current_setting('app.current_account_id', true)::uuid)
    `);

    const joinPolicyTables = [
      'campaign_quote',
      'campaign_pool_member',
      'campaign_reallocation_event',
      'campaign_state_transition',
      'reallocation_bounds',
      'pool_shortfall_resolution',
    ];

    for (const table of joinPolicyTables) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`
        CREATE POLICY tenant_isolation ON "${table}"
          USING (
            "campaign_id" IN (
              SELECT "id" FROM "campaign"
              WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
            )
          )
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const joinPolicyTables = [
      'pool_shortfall_resolution',
      'reallocation_bounds',
      'campaign_state_transition',
      'campaign_reallocation_event',
      'campaign_pool_member',
      'campaign_quote',
    ];
    for (const table of joinPolicyTables) {
      await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
    }
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "campaign_template"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "campaign"`);

    await queryRunner.query(`DROP TRIGGER IF EXISTS pool_member_committed_budget_guard ON "campaign_pool_member"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_committed_budget_decrease()`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS reallocation_event_immutable ON "campaign_reallocation_event"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_reallocation_event_mutation()`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS campaign_state_transition_immutable ON "campaign_state_transition"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_campaign_state_transition_mutation()`);

    await queryRunner.query(`DROP TABLE IF EXISTS "pool_shortfall_resolution"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "reallocation_bounds"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "campaign_template"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "campaign_state_transition"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "campaign_reallocation_event"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "campaign_pool_member"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "campaign_quote"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "campaign"`);
  }
}
