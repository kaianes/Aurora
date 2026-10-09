import { MigrationInterface, QueryRunner } from 'typeorm';

export class MatchingSchema1705000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- TABLES ----

    // Minimal creator entity (ADR-0013). Shared reference data across
    // tenants: no account_id, no RLS (section 2.4 of the E3 architecture doc).
    await queryRunner.query(`
      CREATE TABLE "creator" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" uuid,
        "display_name" text NOT NULL,
        "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('unclaimed', 'active', 'suspended')),
        "onboarding_status" text NOT NULL DEFAULT 'qualified' CHECK ("onboarding_status" IN ('qualified', 'not_qualified', 'pending')),
        "content_niche" text,
        "demographic_composition" jsonb,
        "audience_size" int,
        "engagement_rate" numeric,
        "authenticity_score" numeric,
        "metrics_computed_at" timestamptz,
        "metrics_stale" boolean NOT NULL DEFAULT false,
        "historical_reliability" numeric,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "creator_exclusion" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "account_id" uuid NOT NULL REFERENCES "account"("id"),
        "campaign_id" uuid REFERENCES "campaign"("id"),
        "exclusion_type" text NOT NULL CHECK ("exclusion_type" IN ('creator', 'competitor_brand')),
        "creator_id" uuid REFERENCES "creator"("id"),
        "competitor_name" text,
        "created_by_user_id" uuid NOT NULL REFERENCES "user"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_exclusion_identifier" CHECK (
          ("exclusion_type" = 'creator' AND "creator_id" IS NOT NULL)
          OR ("exclusion_type" = 'competitor_brand' AND "competitor_name" IS NOT NULL)
        )
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "campaign_shortlist" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'ready', 'failed', 'no_viable_pool')),
        "failure_reason" text,
        "below_guaranteed_minimum" boolean NOT NULL DEFAULT false,
        "locked" boolean NOT NULL DEFAULT false,
        "locked_reason" text CHECK ("locked_reason" IS NULL OR "locked_reason" IN ('agency_override', 'campaign_activated')),
        "locked_at" timestamptz,
        "requested_at" timestamptz NOT NULL DEFAULT now(),
        "resolved_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_campaign_shortlist" UNIQUE ("campaign_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "campaign_shortlist_entry" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "shortlist_id" uuid NOT NULL REFERENCES "campaign_shortlist"("id"),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "creator_id" uuid NOT NULL REFERENCES "creator"("id"),
        "rank" int,
        "fit_score" numeric,
        "matched_attributes" jsonb,
        "origin" text NOT NULL CHECK ("origin" IN ('system_ranked', 'agency_added')),
        "decision" text NOT NULL DEFAULT 'pending' CHECK ("decision" IN ('pending', 'approved', 'rejected')),
        "decision_by_user_id" uuid,
        "decision_at" timestamptz,
        "included" boolean NOT NULL DEFAULT true,
        "added_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_shortlist_entry" UNIQUE ("shortlist_id", "creator_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "campaign_opportunity" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "creator_id" uuid NOT NULL REFERENCES "creator"("id"),
        "shortlist_entry_id" uuid NOT NULL REFERENCES "campaign_shortlist_entry"("id"),
        "deliverable" jsonb NOT NULL,
        "payout_gross" numeric NOT NULL,
        "payout_commission" numeric NOT NULL,
        "payout_net" numeric NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'accepted', 'declined', 'expired')),
        "responded_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_opportunity" UNIQUE ("campaign_id", "creator_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "additional_candidates_request" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "shortlist_id" uuid NOT NULL REFERENCES "campaign_shortlist"("id"),
        "requested_count" int NOT NULL,
        "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'fulfilled', 'no_additional_candidates')),
        "requested_by_user_id" uuid NOT NULL REFERENCES "user"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "resolved_at" timestamptz
      )
    `);

    // ---- LOCKED-SHORTLIST GUARD TRIGGERS (section 2.5 of the E3 architecture doc) ----

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_locked_shortlist_mutation()
      RETURNS trigger AS $$
      BEGIN
        IF OLD.locked = true THEN
          RAISE EXCEPTION 'campaign_shortlist % is locked: no further changes permitted', OLD.id;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER shortlist_lock_guard
        BEFORE UPDATE ON "campaign_shortlist"
        FOR EACH ROW
        WHEN (OLD.locked = true AND NEW.locked = true)
        EXECUTE FUNCTION prevent_locked_shortlist_mutation()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_locked_shortlist_entry_mutation()
      RETURNS trigger AS $$
      DECLARE
        is_locked boolean;
      BEGIN
        SELECT locked INTO is_locked FROM campaign_shortlist WHERE id = OLD.shortlist_id;
        IF is_locked THEN
          RAISE EXCEPTION 'shortlist entry % belongs to a locked shortlist: no further changes permitted', OLD.id;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER shortlist_entry_lock_guard
        BEFORE UPDATE ON "campaign_shortlist_entry"
        FOR EACH ROW EXECUTE FUNCTION prevent_locked_shortlist_entry_mutation()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_opportunity_payout_mutation()
      RETURNS trigger AS $$
      BEGIN
        IF OLD.payout_gross IS DISTINCT FROM NEW.payout_gross
           OR OLD.payout_commission IS DISTINCT FROM NEW.payout_commission
           OR OLD.payout_net IS DISTINCT FROM NEW.payout_net THEN
          RAISE EXCEPTION 'opportunity payout figures are immutable once created';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER opportunity_payout_immutable
        BEFORE UPDATE ON "campaign_opportunity"
        FOR EACH ROW EXECUTE FUNCTION prevent_opportunity_payout_mutation()
    `);

    // ---- ROW-LEVEL SECURITY ----

    // creator carries no account_id and no RLS: shared reference data across
    // tenants (section 2.4 of the E3 architecture doc), same category as
    // pricing data.

    await queryRunner.query(`ALTER TABLE "creator_exclusion" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "creator_exclusion" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "creator_exclusion"
        USING ("account_id" = current_setting('app.current_account_id', true)::uuid)
    `);

    await queryRunner.query(`ALTER TABLE "campaign_shortlist" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "campaign_shortlist" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "campaign_shortlist"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
          )
        )
    `);

    // campaign_shortlist_entry, campaign_opportunity, and
    // additional_candidates_request additionally allow creator-portal
    // sessions through (app.creator_portal), since creators are not
    // members of any account and therefore have no app.current_account_id
    // to satisfy the standard join-based policy (section 2.3 of the E3
    // architecture doc). Visibility is still restricted to a creator's own
    // rows, enforced in application code via the creator_id column.
    const creatorPortalJoinTables = ['campaign_shortlist_entry', 'additional_candidates_request'];
    for (const table of creatorPortalJoinTables) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`
        CREATE POLICY tenant_isolation ON "${table}"
          USING (
            "campaign_id" IN (
              SELECT "id" FROM "campaign"
              WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
            )
            OR current_setting('app.creator_portal', true) = 'true'
          )
      `);
    }

    await queryRunner.query(`ALTER TABLE "campaign_opportunity" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "campaign_opportunity" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "campaign_opportunity"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
          )
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "campaign_opportunity"`);
    const creatorPortalJoinTables = ['additional_candidates_request', 'campaign_shortlist_entry'];
    for (const table of creatorPortalJoinTables) {
      await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
    }
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "campaign_shortlist"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "creator_exclusion"`);

    await queryRunner.query(`DROP TRIGGER IF EXISTS opportunity_payout_immutable ON "campaign_opportunity"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_opportunity_payout_mutation()`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS shortlist_entry_lock_guard ON "campaign_shortlist_entry"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_locked_shortlist_entry_mutation()`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS shortlist_lock_guard ON "campaign_shortlist"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_locked_shortlist_mutation()`);

    await queryRunner.query(`DROP TABLE IF EXISTS "additional_candidates_request"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "campaign_opportunity"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "campaign_shortlist_entry"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "campaign_shortlist"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "creator_exclusion"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "creator"`);
  }
}
