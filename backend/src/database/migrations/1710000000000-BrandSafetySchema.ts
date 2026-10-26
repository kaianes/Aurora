import { MigrationInterface, QueryRunner } from 'typeorm';

export class BrandSafetySchema1710000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- TABLES ----

    await queryRunner.query(`
      CREATE TABLE "safety_ruleset" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "account_id" uuid NOT NULL REFERENCES "account"("id"),
        "scope" text NOT NULL CHECK ("scope" IN ('brand', 'campaign')),
        "campaign_id" uuid REFERENCES "campaign"("id"),
        "created_by_user_id" uuid NOT NULL REFERENCES "user"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_ruleset_scope" CHECK (
          ("scope" = 'brand' AND "campaign_id" IS NULL)
          OR ("scope" = 'campaign' AND "campaign_id" IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_brand_ruleset" ON "safety_ruleset" ("account_id") WHERE "scope" = 'brand'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_campaign_ruleset" ON "safety_ruleset" ("campaign_id") WHERE "scope" = 'campaign'
    `);

    await queryRunner.query(`
      CREATE TABLE "safety_rule" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "ruleset_id" uuid NOT NULL REFERENCES "safety_ruleset"("id"),
        "rule_type" text NOT NULL CHECK ("rule_type" IN ('prohibited_topic', 'restricted_language', 'competitor_mention')),
        "definition" jsonb,
        "action" text NOT NULL DEFAULT 'add' CHECK ("action" IN ('add', 'replace', 'suppress')),
        "supersedes_rule_id" uuid REFERENCES "safety_rule"("id"),
        "created_by_user_id" uuid NOT NULL REFERENCES "user"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_rule_action_reference" CHECK (
          ("action" = 'add' AND "supersedes_rule_id" IS NULL)
          OR ("action" IN ('replace', 'suppress') AND "supersedes_rule_id" IS NOT NULL)
        ),
        CONSTRAINT "chk_rule_definition_presence" CHECK (
          ("action" = 'suppress' AND "definition" IS NULL)
          OR ("action" != 'suppress' AND "definition" IS NOT NULL)
        )
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "content_submission" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "creator_id" uuid REFERENCES "creator"("id"),
        "opportunity_id" uuid REFERENCES "campaign_opportunity"("id"),
        "caption_text" text NOT NULL,
        "on_screen_text" text,
        "audio_transcript" text,
        "media_asset_url" text,
        "extraction_status" text NOT NULL DEFAULT 'not_required' CHECK ("extraction_status" IN ('not_required', 'pending', 'complete', 'failed')),
        "submitted_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "safety_check" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "content_submission_id" uuid NOT NULL REFERENCES "content_submission"("id"),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "ruleset_id" uuid REFERENCES "safety_ruleset"("id"),
        "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'passed', 'flagged', 'check_unavailable')),
        "tier_reached" text CHECK ("tier_reached" IS NULL OR "tier_reached" IN ('tier1', 'tier2')),
        "requested_at" timestamptz NOT NULL DEFAULT now(),
        "timeout_at" timestamptz NOT NULL,
        "resolved_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "safety_rule_trigger" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "safety_check_id" uuid NOT NULL REFERENCES "safety_check"("id"),
        "rule_id" uuid REFERENCES "safety_rule"("id"),
        "channel" text NOT NULL CHECK ("channel" IN ('caption', 'on_screen_text', 'audio', 'system')),
        "matched_excerpt" text,
        "tier" text NOT NULL CHECK ("tier" IN ('tier1', 'tier2')),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_trigger_system_has_no_rule" CHECK (
          ("channel" = 'system' AND "rule_id" IS NULL)
          OR ("channel" != 'system' AND "rule_id" IS NOT NULL)
        )
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "safety_review_queue_item" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "safety_check_id" uuid NOT NULL REFERENCES "safety_check"("id"),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "content_submission_id" uuid NOT NULL REFERENCES "content_submission"("id"),
        "reason_category" text NOT NULL CHECK ("reason_category" IN ('rule_violation', 'check_unavailable')),
        "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected', 'revision_requested')),
        "decision_reason" text,
        "decided_by_user_id" uuid REFERENCES "user"("id"),
        "decided_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_review_item_per_check" UNIQUE ("safety_check_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "published_content_snapshot" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "content_submission_id" uuid NOT NULL REFERENCES "content_submission"("id"),
        "published_url" text NOT NULL,
        "approved_caption_text" text NOT NULL,
        "approved_on_screen_text" text,
        "approved_audio_transcript" text,
        "monitoring_status" text NOT NULL DEFAULT 'active' CHECK ("monitoring_status" IN ('active', 'stopped')),
        "last_checked_at" timestamptz,
        "last_result" text CHECK ("last_result" IS NULL OR "last_result" IN ('matching', 'deviated', 'unreachable')),
        "deviation_details" jsonb,
        "consecutive_unreachable_count" int NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_snapshot_per_submission" UNIQUE ("content_submission_id")
      )
    `);

    // ---- ROW-LEVEL SECURITY (section 2.5 of the E4 architecture doc) ----

    await queryRunner.query(`ALTER TABLE "safety_ruleset" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "safety_ruleset" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "safety_ruleset"
        USING ("account_id" = current_setting('app.current_account_id', true)::uuid)
    `);

    await queryRunner.query(`ALTER TABLE "safety_rule" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "safety_rule" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "safety_rule"
        USING (
          "ruleset_id" IN (
            SELECT "id" FROM "safety_ruleset"
            WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
          )
        )
    `);

    // content_submission and safety_check additionally allow creator-portal
    // sessions through (app.creator_portal), mirroring E3's precedent for
    // campaign_shortlist_entry/campaign_opportunity (MatchingSchema
    // migration): the one creator-facing endpoint in this epic (section 3.3)
    // writes/reads these tables with no account context to satisfy the
    // standard join-based policy. Visibility is still restricted to a
    // creator's own rows, enforced in application code via creator_id /
    // content_submission.creator_id, never by this RLS policy alone.
    await queryRunner.query(`ALTER TABLE "content_submission" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "content_submission" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "content_submission"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
          )
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);

    await queryRunner.query(`ALTER TABLE "safety_check" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "safety_check" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "safety_check"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
          )
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);

    await queryRunner.query(`ALTER TABLE "safety_review_queue_item" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "safety_review_queue_item" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "safety_review_queue_item"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
          )
        )
    `);

    // safety_rule_trigger also allows creator-portal sessions through: the
    // submitting creator's check-status poll (GET /safety/submissions/:id/check)
    // returns triggered_rules for a flagged check, so a creator session must
    // be able to read this table for their own submission's check.
    await queryRunner.query(`ALTER TABLE "safety_rule_trigger" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "safety_rule_trigger" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "safety_rule_trigger"
        USING (
          "safety_check_id" IN (
            SELECT "id" FROM "safety_check"
            WHERE "campaign_id" IN (
              SELECT "id" FROM "campaign"
              WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
            )
          )
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);

    await queryRunner.query(`ALTER TABLE "published_content_snapshot" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "published_content_snapshot" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "published_content_snapshot"
        USING (
          "content_submission_id" IN (
            SELECT "id" FROM "content_submission"
            WHERE "campaign_id" IN (
              SELECT "id" FROM "campaign"
              WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
            )
          )
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "published_content_snapshot"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "safety_rule_trigger"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "safety_review_queue_item"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "safety_check"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "content_submission"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "safety_rule"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "safety_ruleset"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "published_content_snapshot"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "safety_review_queue_item"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "safety_rule_trigger"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "safety_check"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "content_submission"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "safety_rule"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "safety_ruleset"`);
  }
}
