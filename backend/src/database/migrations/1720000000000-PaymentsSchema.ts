import { MigrationInterface, QueryRunner } from 'typeorm';

// E6: introduces payout_obligation, payout_execution_attempt, ledger_entry,
// invoice, invoice_line_item, and tax_document, plus additive extensions to
// creator (tax_id/tax_id_type, US-36b) and user (is_aurora_operator,
// ADR-0038). Section 3 of the E6 architecture document. No existing E1-E5
// row needs a backfill.
export class PaymentsSchema1720000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- additive columns ----

    await queryRunner.query(`ALTER TABLE "creator" ADD COLUMN "tax_id" text NULL`);
    await queryRunner.query(`ALTER TABLE "creator" ADD COLUMN "tax_id_type" text NULL`);
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN "is_aurora_operator" boolean NOT NULL DEFAULT false`,
    );

    // ---- TABLES ----

    await queryRunner.query(`
      CREATE TABLE "payout_obligation" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "content_submission_id" uuid NOT NULL REFERENCES "content_submission"("id"),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "creator_id" uuid NOT NULL REFERENCES "creator"("id"),
        "opportunity_id" uuid NOT NULL REFERENCES "campaign_opportunity"("id"),
        "payout_gross" numeric NOT NULL,
        "payout_commission" numeric NOT NULL,
        "payout_net" numeric NOT NULL,
        "committed_deadline_at" timestamptz NOT NULL,
        "status" text NOT NULL DEFAULT 'owed' CHECK ("status" IN ('owed', 'in_flight', 'settled')),
        "in_flight_since" timestamptz,
        "settled_at" timestamptz,
        "last_failure_reason" text,
        "first_failure_detected_at" timestamptz,
        "last_failure_detected_at" timestamptz,
        "failure_notification_sent_at" timestamptz,
        "escalated_for_manual_review" boolean NOT NULL DEFAULT false,
        "escalated_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_payout_obligation_submission" UNIQUE ("content_submission_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "payout_execution_attempt" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "payout_obligation_id" uuid NOT NULL REFERENCES "payout_obligation"("id"),
        "idempotency_key" text NOT NULL,
        "trigger" text NOT NULL CHECK ("trigger" IN ('scheduled', 'manual')),
        "triggered_by_user_id" uuid REFERENCES "user"("id"),
        "outcome" text NOT NULL CHECK ("outcome" IN ('instructed', 'failed')),
        "failure_reason" text,
        "provider_reference" text,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "ledger_entry" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "transaction_id" uuid NOT NULL,
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "reference_type" text NOT NULL CHECK ("reference_type" IN ('payout_obligation', 'invoice')),
        "reference_id" uuid NOT NULL,
        "direction" text NOT NULL CHECK ("direction" IN ('debit', 'credit')),
        "amount" numeric NOT NULL,
        "description" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "tax_document" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "payout_obligation_id" uuid NOT NULL REFERENCES "payout_obligation"("id"),
        "creator_id" uuid NOT NULL REFERENCES "creator"("id"),
        "status" text NOT NULL CHECK ("status" IN ('generated', 'blocked_missing_info')),
        "missing_fields" jsonb,
        "document_url" text,
        "tax_period" text NOT NULL,
        "generated_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_tax_document_obligation" UNIQUE ("payout_obligation_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "invoice" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "campaign_id" uuid NOT NULL REFERENCES "campaign"("id"),
        "total_amount" numeric NOT NULL,
        "status" text NOT NULL DEFAULT 'issued' CHECK ("status" IN ('issued')),
        "generated_by_user_id" uuid NOT NULL REFERENCES "user"("id"),
        "issued_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_invoice_campaign" UNIQUE ("campaign_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "invoice_line_item" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "invoice_id" uuid NOT NULL REFERENCES "invoice"("id"),
        "line_type" text NOT NULL CHECK ("line_type" IN ('base_price', 'shortfall_refund_adjustment')),
        "description" text NOT NULL,
        "amount" numeric NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    // ---- IMMUTABILITY / APPEND-ONLY TRIGGERS (section 3.6) ----

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_payout_obligation_figures_mutation()
      RETURNS trigger AS $$
      BEGIN
        IF OLD.payout_gross IS DISTINCT FROM NEW.payout_gross
           OR OLD.payout_commission IS DISTINCT FROM NEW.payout_commission
           OR OLD.payout_net IS DISTINCT FROM NEW.payout_net
           OR OLD.committed_deadline_at IS DISTINCT FROM NEW.committed_deadline_at THEN
          RAISE EXCEPTION 'payout_obligation figures and deadline are immutable once created';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER payout_obligation_figures_immutable
        BEFORE UPDATE ON "payout_obligation"
        FOR EACH ROW EXECUTE FUNCTION prevent_payout_obligation_figures_mutation()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_ledger_entry_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'ledger_entry is append-only: UPDATE and DELETE are prohibited';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER ledger_entry_immutable
        BEFORE UPDATE OR DELETE ON "ledger_entry"
        FOR EACH ROW EXECUTE FUNCTION prevent_ledger_entry_mutation()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_payout_execution_attempt_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'payout_execution_attempt is append-only: UPDATE and DELETE are prohibited';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER payout_execution_attempt_immutable
        BEFORE UPDATE OR DELETE ON "payout_execution_attempt"
        FOR EACH ROW EXECUTE FUNCTION prevent_payout_execution_attempt_mutation()
    `);

    // ---- ROW-LEVEL SECURITY (section 3.7 of the E6 architecture doc) ----

    await queryRunner.query(`ALTER TABLE "payout_obligation" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "payout_obligation" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "payout_obligation"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
          )
          OR current_setting('app.creator_portal', true) = 'true'
          OR current_setting('app.aurora_operator', true) = 'true'
        )
    `);

    await queryRunner.query(`ALTER TABLE "payout_execution_attempt" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "payout_execution_attempt" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "payout_execution_attempt"
        USING (
          "payout_obligation_id" IN (
            SELECT "id" FROM "payout_obligation"
            WHERE "campaign_id" IN (
              SELECT "id" FROM "campaign"
              WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
            )
          )
          OR current_setting('app.aurora_operator', true) = 'true'
        )
    `);

    await queryRunner.query(`ALTER TABLE "ledger_entry" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "ledger_entry" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "ledger_entry"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
          )
          OR current_setting('app.aurora_operator', true) = 'true'
        )
    `);

    // tax_document joins via payout_obligation_id, with the same
    // app.creator_portal branch content_review_decision already uses.
    await queryRunner.query(`ALTER TABLE "tax_document" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "tax_document" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "tax_document"
        USING (
          "payout_obligation_id" IN (
            SELECT "id" FROM "payout_obligation"
            WHERE "campaign_id" IN (
              SELECT "id" FROM "campaign"
              WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
            )
          )
          OR current_setting('app.creator_portal', true) = 'true'
          OR current_setting('app.aurora_operator', true) = 'true'
        )
    `);

    // invoice/invoice_line_item: standard account_id/join-via-campaign_id
    // pattern, no creator-portal or operator branch (section 3.7).
    await queryRunner.query(`ALTER TABLE "invoice" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "invoice" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "invoice"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
          )
        )
    `);

    await queryRunner.query(`ALTER TABLE "invoice_line_item" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "invoice_line_item" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "invoice_line_item"
        USING (
          "invoice_id" IN (
            SELECT "id" FROM "invoice"
            WHERE "campaign_id" IN (
              SELECT "id" FROM "campaign"
              WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
            )
          )
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "invoice_line_item"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "invoice"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "tax_document"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "ledger_entry"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "payout_execution_attempt"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "payout_obligation"`);

    await queryRunner.query(
      `DROP TRIGGER IF EXISTS payout_execution_attempt_immutable ON "payout_execution_attempt"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_payout_execution_attempt_mutation()`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS ledger_entry_immutable ON "ledger_entry"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_ledger_entry_mutation()`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS payout_obligation_figures_immutable ON "payout_obligation"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_payout_obligation_figures_mutation()`);

    await queryRunner.query(`DROP TABLE IF EXISTS "invoice_line_item"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invoice"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tax_document"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ledger_entry"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payout_execution_attempt"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payout_obligation"`);

    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "is_aurora_operator"`);
    await queryRunner.query(`ALTER TABLE "creator" DROP COLUMN IF EXISTS "tax_id_type"`);
    await queryRunner.query(`ALTER TABLE "creator" DROP COLUMN IF EXISTS "tax_id"`);
  }
}
