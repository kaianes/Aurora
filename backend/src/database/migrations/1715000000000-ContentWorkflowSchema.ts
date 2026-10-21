import { MigrationInterface, QueryRunner } from 'typeorm';

// E5: introduces the briefing / briefing Q&A / content-review-decision
// tables and additively extends content_submission (ADR-0025, ADR-0026,
// ADR-0027, ADR-0028, ADR-0029, ADR-0030, section 3 of the E5 architecture
// doc). No existing E1-E4 row needs a backfill.
export class ContentWorkflowSchema1715000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- TABLES ----

    await queryRunner.query(`
      CREATE TABLE "briefing" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "dos" jsonb,
        "donts" jsonb,
        "reference_examples" jsonb,
        "deliverable_spec" jsonb,
        "deadline" timestamptz,
        "status" text NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'issued')),
        "issued_at" timestamptz,
        "issued_by_user_id" uuid REFERENCES "user"("id"),
        "created_by_user_id" uuid NOT NULL REFERENCES "user"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_briefing_per_campaign" ON "briefing" ("campaign_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "briefing_distribution_recipient" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "briefing_id" uuid NOT NULL REFERENCES "briefing"("id"),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "creator_id" uuid NOT NULL REFERENCES "creator"("id"),
        "opportunity_id" uuid NOT NULL REFERENCES "campaign_opportunity"("id"),
        "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'delivered', 'failed')),
        "failure_reason" text,
        "delivered_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_distribution_recipient" UNIQUE ("briefing_id", "creator_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "briefing_qa_thread" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "briefing_id" uuid NOT NULL REFERENCES "briefing"("id"),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "creator_id" uuid NOT NULL REFERENCES "creator"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_qa_thread" UNIQUE ("briefing_id", "creator_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "briefing_qa_message" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "thread_id" uuid NOT NULL REFERENCES "briefing_qa_thread"("id"),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "sender_type" text NOT NULL CHECK ("sender_type" IN ('creator', 'brand')),
        "sender_user_id" uuid REFERENCES "user"("id"),
        "sender_creator_id" uuid REFERENCES "creator"("id"),
        "body" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_message_sender" CHECK (
          ("sender_type" = 'creator' AND "sender_creator_id" IS NOT NULL AND "sender_user_id" IS NULL)
          OR ("sender_type" = 'brand' AND "sender_user_id" IS NOT NULL AND "sender_creator_id" IS NULL)
        )
      )
    `);

    // ---- content_submission: additive columns (ADR-0025, ADR-0030, ADR-0027) ----

    await queryRunner.query(`ALTER TABLE "content_submission" ADD COLUMN "supersedes_submission_id" uuid NULL REFERENCES "content_submission"("id")`);
    await queryRunner.query(`ALTER TABLE "content_submission" ADD COLUMN "root_submission_id" uuid NULL`);
    await queryRunner.query(`ALTER TABLE "content_submission" ADD COLUMN "version_number" integer NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE "content_submission" ADD COLUMN "review_deadline_at" timestamptz NULL`);
    await queryRunner.query(`ALTER TABLE "content_submission" ADD COLUMN "review_escalated" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "content_submission" ADD COLUMN "review_escalated_at" timestamptz NULL`);
    await queryRunner.query(`ALTER TABLE "content_submission" ADD COLUMN "published_url" text NULL`);
    await queryRunner.query(`ALTER TABLE "content_submission" ADD COLUMN "published_at" timestamptz NULL`);

    await queryRunner.query(`
      CREATE TABLE "content_review_decision" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "content_submission_id" uuid NOT NULL REFERENCES "content_submission"("id"),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "decision" text NOT NULL CHECK ("decision" IN ('approved', 'rejected', 'revision_requested')),
        "decision_reason" text,
        "decided_by_user_id" uuid NOT NULL REFERENCES "user"("id"),
        "decided_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_decision_per_submission" UNIQUE ("content_submission_id")
      )
    `);

    // ---- ROW-LEVEL SECURITY (section 3.5 of the E5 architecture doc) ----

    await queryRunner.query(`ALTER TABLE "briefing" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "briefing" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "briefing"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
          )
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);

    // No creator_portal branch: creators never read this table directly
    // (section 3.2 of the E5 architecture doc -- Marina's side of US-18b only).
    await queryRunner.query(`ALTER TABLE "briefing_distribution_recipient" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "briefing_distribution_recipient" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "briefing_distribution_recipient"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
          )
        )
    `);

    await queryRunner.query(`ALTER TABLE "briefing_qa_thread" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "briefing_qa_thread" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "briefing_qa_thread"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
          )
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);

    await queryRunner.query(`ALTER TABLE "briefing_qa_message" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "briefing_qa_message" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "briefing_qa_message"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
          )
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);

    // content_submission's existing policy (E4's BrandSafetySchema migration)
    // is unchanged by this epic's new columns (section 3.5 of the E5
    // architecture doc) -- adding nullable/defaulted columns never requires
    // a policy change.

    await queryRunner.query(`ALTER TABLE "content_review_decision" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "content_review_decision" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "content_review_decision"
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
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "content_review_decision"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "briefing_qa_message"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "briefing_qa_thread"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "briefing_distribution_recipient"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "briefing"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "content_review_decision"`);

    await queryRunner.query(`ALTER TABLE "content_submission" DROP COLUMN IF EXISTS "published_at"`);
    await queryRunner.query(`ALTER TABLE "content_submission" DROP COLUMN IF EXISTS "published_url"`);
    await queryRunner.query(`ALTER TABLE "content_submission" DROP COLUMN IF EXISTS "review_escalated_at"`);
    await queryRunner.query(`ALTER TABLE "content_submission" DROP COLUMN IF EXISTS "review_escalated"`);
    await queryRunner.query(`ALTER TABLE "content_submission" DROP COLUMN IF EXISTS "review_deadline_at"`);
    await queryRunner.query(`ALTER TABLE "content_submission" DROP COLUMN IF EXISTS "version_number"`);
    await queryRunner.query(`ALTER TABLE "content_submission" DROP COLUMN IF EXISTS "root_submission_id"`);
    await queryRunner.query(`ALTER TABLE "content_submission" DROP COLUMN IF EXISTS "supersedes_submission_id"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "briefing_qa_message"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "briefing_qa_thread"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "briefing_distribution_recipient"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "briefing"`);
  }
}
