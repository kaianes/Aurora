import { MigrationInterface, QueryRunner } from 'typeorm';

// E8 -- Creator Recruitment and Growth. Introduces the seven tables this
// epic owns outright (creator_public_import, creator_invitation,
// creator_consent_record, creator_social_account, creator_rate_preference,
// creator_media_kit_export, creator_data_subject_request) plus an additive,
// nullable (or safely defaulted) extension of the existing creator table
// (section 2.2 of the E8 architecture doc). No existing creator column is
// removed, renamed, or retyped; no existing E3 query changes shape.
//
// None of this epic's new tables carry account_id, and none receive an RLS
// policy -- they extend or hang off creator, which E3 already established
// as shared, non-tenant-scoped reference data with no RLS policy at all
// (section 2.4 of the E8 architecture doc). Access control is enforced
// entirely in application code by principal type (CreatorAuthGuard /
// OperatorAuthGuard / invitation-token possession).
export class CreatorNetworkSchema1730000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- ADDITIVE CREATOR COLUMNS (section 2.2) ----

    await queryRunner.query(`
      ALTER TABLE "creator"
        ADD COLUMN "recruitment_origin" text NOT NULL DEFAULT 'self_registered'
          CHECK ("recruitment_origin" IN ('self_registered', 'recruited')),
        ADD COLUMN "unclaimed_expires_at" timestamptz,
        ADD COLUMN "claimed_at" timestamptz,
        ADD COLUMN "authenticity_status" text NOT NULL DEFAULT 'pending'
          CHECK ("authenticity_status" IN ('pending', 'scored', 'insufficient_data')),
        ADD COLUMN "authenticity_computed_at" timestamptz,
        ADD COLUMN "qualification_missing_criteria" jsonb,
        ADD COLUMN "qualification_decided_at" timestamptz,
        ADD COLUMN "qualification_expected_ready_at" timestamptz,
        ADD COLUMN "qualification_notified_at" timestamptz
    `);

    // ---- TABLES (section 2.2) ----
    //
    // creator_id FK cascade policy: every owned table except
    // creator_invitation cascades its delete with the creator row (claim-
    // decline, 90-day unclaimed expiry, and a fulfilled deletion
    // data-subject-request all hard-delete the creator and everything this
    // epic attached to it). creator_invitation is the one deliberate
    // exception (ADR-0055): a declined invitation's own row must survive
    // its creator's deletion as the durable record that an invitation was
    // sent and refused, so its creator_id is nullable with ON DELETE SET
    // NULL rather than CASCADE.

    await queryRunner.query(`
      CREATE TABLE "creator_public_import" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "creator_id" uuid NOT NULL REFERENCES "creator"("id") ON DELETE CASCADE,
        "source" text NOT NULL,
        "platform" text,
        "observed_handle" text,
        "observed_display_name" text,
        "observed_follower_count" int,
        "observed_niche" text,
        "raw_payload" jsonb,
        "imported_by_user_id" uuid NOT NULL REFERENCES "user"("id"),
        "imported_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_creator_public_import" UNIQUE ("creator_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "creator_invitation" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "creator_id" uuid REFERENCES "creator"("id") ON DELETE SET NULL,
        "token" text NOT NULL UNIQUE,
        "contact_email" text NOT NULL,
        "status" text NOT NULL DEFAULT 'pending'
          CHECK ("status" IN ('pending', 'accepted', 'declined', 'expired')),
        "expires_at" timestamptz NOT NULL,
        "responded_at" timestamptz,
        "created_by_user_id" uuid NOT NULL REFERENCES "user"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "creator_consent_record" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "creator_id" uuid NOT NULL REFERENCES "creator"("id") ON DELETE CASCADE,
        "consent_type" text NOT NULL
          CHECK ("consent_type" IN ('terms_acceptance', 'oauth_authorization', 'profile_claim')),
        "scope" jsonb,
        "terms_version" text,
        "granted_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "creator_social_account" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "creator_id" uuid NOT NULL REFERENCES "creator"("id") ON DELETE CASCADE,
        "platform" text NOT NULL CHECK ("platform" IN ('instagram', 'tiktok', 'youtube')),
        "platform_user_id" text NOT NULL,
        "platform_handle" text NOT NULL,
        "status" text NOT NULL DEFAULT 'connected' CHECK ("status" IN ('connected', 'disconnected')),
        "disconnect_reason" text
          CHECK ("disconnect_reason" IS NULL OR "disconnect_reason" IN ('revoked_by_platform', 'refresh_failed', 'manual')),
        "access_token_ciphertext" text NOT NULL,
        "access_token_nonce" text NOT NULL,
        "refresh_token_ciphertext" text,
        "refresh_token_nonce" text,
        "token_key_version" int NOT NULL,
        "granted_scope" jsonb NOT NULL,
        "token_expires_at" timestamptz NOT NULL,
        "last_refreshed_at" timestamptz,
        "connected_at" timestamptz NOT NULL,
        "disconnected_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_creator_social_account" UNIQUE ("creator_id", "platform")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "creator_rate_preference" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "creator_id" uuid NOT NULL REFERENCES "creator"("id") ON DELETE CASCADE,
        "deliverable_format" text NOT NULL,
        "rate_amount" numeric NOT NULL,
        "currency" text NOT NULL DEFAULT 'BRL',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_creator_rate_preference" UNIQUE ("creator_id", "deliverable_format")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "creator_media_kit_export" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "creator_id" uuid NOT NULL REFERENCES "creator"("id") ON DELETE CASCADE,
        "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'ready', 'failed')),
        "has_campaign_history" boolean,
        "pdf_document_url" text,
        "failure_reason" text,
        "requested_at" timestamptz NOT NULL DEFAULT now(),
        "resolved_at" timestamptz
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "creator_data_subject_request" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "creator_id" uuid NOT NULL REFERENCES "creator"("id") ON DELETE CASCADE,
        "request_type" text NOT NULL
          CHECK ("request_type" IN ('access', 'correction', 'deletion', 'portability')),
        "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'fulfilled')),
        "details" jsonb,
        "export_document_url" text,
        "requested_at" timestamptz NOT NULL DEFAULT now(),
        "due_at" timestamptz NOT NULL,
        "fulfilled_at" timestamptz,
        "fulfilled_by_user_id" uuid REFERENCES "user"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    // ---- CONSTRAINTS (section 2.5) ----

    // A creator carries unclaimed_expires_at only while actually unclaimed,
    // preventing a stale expiry timestamp from surviving a claim and later
    // being misread by a maintenance query.
    await queryRunner.query(`
      ALTER TABLE "creator" ADD CONSTRAINT "chk_unclaimed_expiry_consistency"
        CHECK (
          ("status" = 'unclaimed' AND "unclaimed_expires_at" IS NOT NULL)
          OR ("status" != 'unclaimed' AND "unclaimed_expires_at" IS NULL)
        )
    `);

    // Rate preferences are always strictly positive and bounded (ADR-0058).
    await queryRunner.query(`
      ALTER TABLE "creator_rate_preference" ADD CONSTRAINT "chk_rate_amount_bounds"
        CHECK ("rate_amount" > 0 AND "rate_amount" <= 50000)
    `);

    // An import's only lawful subsequent fate is correction (into creator's
    // own live columns) or deletion -- it is never updated in place.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_public_import_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'creator_public_import is immutable: UPDATE is prohibited, only DELETE on decline/expiry/claim-cleanup';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER public_import_immutable
        BEFORE UPDATE ON "creator_public_import"
        FOR EACH ROW EXECUTE FUNCTION prevent_public_import_mutation()
    `);

    // No RLS policy on any of the seven tables above (section 2.4): they
    // extend or hang off creator, shared reference data with no account_id
    // and no RLS policy at all. Access control is enforced entirely in
    // application code (CreatorAuthGuard / OperatorAuthGuard / invitation-
    // token possession).
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS public_import_immutable ON "creator_public_import"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_public_import_mutation()`);

    await queryRunner.query(
      `ALTER TABLE "creator_rate_preference" DROP CONSTRAINT IF EXISTS "chk_rate_amount_bounds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "creator" DROP CONSTRAINT IF EXISTS "chk_unclaimed_expiry_consistency"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "creator_data_subject_request"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "creator_media_kit_export"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "creator_rate_preference"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "creator_social_account"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "creator_consent_record"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "creator_invitation"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "creator_public_import"`);

    await queryRunner.query(`
      ALTER TABLE "creator"
        DROP COLUMN IF EXISTS "qualification_notified_at",
        DROP COLUMN IF EXISTS "qualification_expected_ready_at",
        DROP COLUMN IF EXISTS "qualification_decided_at",
        DROP COLUMN IF EXISTS "qualification_missing_criteria",
        DROP COLUMN IF EXISTS "authenticity_computed_at",
        DROP COLUMN IF EXISTS "authenticity_status",
        DROP COLUMN IF EXISTS "claimed_at",
        DROP COLUMN IF EXISTS "unclaimed_expires_at",
        DROP COLUMN IF EXISTS "recruitment_origin"
    `);
  }
}
