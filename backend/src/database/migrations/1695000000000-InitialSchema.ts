import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1695000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable uuid-ossp extension
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ---- TABLES ----

    await queryRunner.query(`
      CREATE TABLE "workspace" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "type" text NOT NULL CHECK ("type" IN ('brand', 'agency')),
        "name" text NOT NULL,
        "max_client_accounts" int NOT NULL DEFAULT 10,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "account" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "workspace_id" uuid NOT NULL REFERENCES "workspace"("id"),
        "name" text NOT NULL,
        "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'suspended')),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "user" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "email" text NOT NULL,
        "password_hash" text NOT NULL,
        "name" text NOT NULL,
        "email_verified" boolean NOT NULL DEFAULT false,
        "mfa_secret" text,
        "mfa_enabled" boolean NOT NULL DEFAULT false,
        "email_verified_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Email uniqueness (case-insensitive)
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_user_email" ON "user" (lower("email"))
    `);

    await queryRunner.query(`
      CREATE TABLE "membership" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL REFERENCES "user"("id"),
        "account_id" uuid NOT NULL REFERENCES "account"("id"),
        "role" text NOT NULL CHECK ("role" IN ('brand_owner', 'brand_manager', 'brand_analyst', 'agency_admin', 'agency_operator')),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_membership" UNIQUE ("user_id", "account_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "brand_profile" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "account_id" uuid NOT NULL REFERENCES "account"("id"),
        "name" text NOT NULL,
        "logo_url" text,
        "tone_of_voice" text,
        "content_guidelines" text,
        "prohibited_topics" jsonb,
        "status" text NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'complete')),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_brand_profile_account" UNIQUE ("account_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "invitation" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "account_id" uuid NOT NULL REFERENCES "account"("id"),
        "email" text NOT NULL,
        "role" text NOT NULL,
        "token" text NOT NULL UNIQUE,
        "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'accepted', 'expired', 'cancelled')),
        "expires_at" timestamptz NOT NULL,
        "accepted_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    // One pending invitation per email per account
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_pending_invitation"
        ON "invitation" ("account_id", lower("email"))
        WHERE "status" = 'pending'
    `);

    await queryRunner.query(`
      CREATE TABLE "verification_token" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL REFERENCES "user"("id"),
        "token" text NOT NULL UNIQUE,
        "purpose" text NOT NULL CHECK ("purpose" IN ('email_verification', 'password_reset')),
        "used" boolean NOT NULL DEFAULT false,
        "expires_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "audit_log" (
        "id" bigserial PRIMARY KEY,
        "actor_user_id" uuid,
        "target_account_id" uuid,
        "action" text NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "ip_address" inet,
        "user_agent" text,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "operator_client_access" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "membership_id" uuid NOT NULL REFERENCES "membership"("id"),
        "account_id" uuid NOT NULL REFERENCES "account"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_operator_client_access" UNIQUE ("membership_id", "account_id")
      )
    `);

    // ---- AUDIT LOG IMMUTABILITY TRIGGER ----

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_audit_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'audit_log is append-only: UPDATE and DELETE are prohibited';
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TRIGGER audit_log_immutable
        BEFORE UPDATE OR DELETE ON "audit_log"
        FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation()
    `);

    // ---- ROW-LEVEL SECURITY ----

    // account table
    await queryRunner.query(`ALTER TABLE "account" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "account" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "account"
        USING ("id" = current_setting('app.current_account_id', true)::uuid)
    `);

    // brand_profile table
    await queryRunner.query(`ALTER TABLE "brand_profile" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "brand_profile" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "brand_profile"
        USING ("account_id" = current_setting('app.current_account_id', true)::uuid)
    `);

    // invitation table
    await queryRunner.query(`ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "invitation" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "invitation"
        USING ("account_id" = current_setting('app.current_account_id', true)::uuid)
    `);

    // membership table
    await queryRunner.query(`ALTER TABLE "membership" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "membership" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "membership"
        USING ("account_id" = current_setting('app.current_account_id', true)::uuid)
    `);

    // operator_client_access table
    await queryRunner.query(`ALTER TABLE "operator_client_access" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "operator_client_access" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "operator_client_access"
        USING ("account_id" = current_setting('app.current_account_id', true)::uuid)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop RLS policies
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "operator_client_access"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "membership"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "invitation"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "brand_profile"`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "account"`);

    // Drop trigger and function
    await queryRunner.query(`DROP TRIGGER IF EXISTS audit_log_immutable ON "audit_log"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_audit_mutation()`);

    // Drop tables in reverse order
    await queryRunner.query(`DROP TABLE IF EXISTS "operator_client_access"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_log"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "verification_token"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invitation"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "brand_profile"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "membership"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "account"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workspace"`);
  }
}
