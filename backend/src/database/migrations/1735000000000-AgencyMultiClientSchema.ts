import { MigrationInterface, QueryRunner } from 'typeorm';

// E9 -- Agency Multi-Client Operations. Section 2 of the E9 architecture
// document. Extends three existing tables additively (campaign_template,
// agency_branding_profile, audit_log) and introduces the one genuinely new
// table this epic adds (client_report_share_link). No existing column is
// removed, renamed, or retyped; no existing E1/E2/E7 policy is narrowed.
export class AgencyMultiClientSchema1735000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- 2.2: campaign_template provenance column (US-41) ----

    await queryRunner.query(`
      ALTER TABLE "campaign_template"
        ADD COLUMN "copied_from_template_id" uuid NULL
          REFERENCES "campaign_template"("id") ON DELETE SET NULL
    `);

    // The fourth escape-hatch flag (app.creator_portal, app.aurora_operator,
    // app.agency_cross_client_read already established), scoped to "any
    // account in the caller's own workspace" -- never platform-wide
    // (section 2.6, ADR-0060).
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "campaign_template"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "campaign_template"
        USING (
          "account_id" = current_setting('app.current_account_id', true)::uuid
          OR (
            current_setting('app.agency_template_copy', true) = 'true'
            AND "account_id" IN (
              SELECT "id" FROM "account"
              WHERE "workspace_id" = current_setting('app.current_workspace_id', true)::uuid
            )
          )
        )
    `);

    // ---- 2.3: agency_branding_profile domain fields (US-44, ADR-0061) ----

    await queryRunner.query(`
      ALTER TABLE "agency_branding_profile"
        ADD COLUMN "custom_domain" text NULL,
        ADD COLUMN "domain_status" text NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "agency_branding_profile"
        ADD CONSTRAINT "chk_domain_status_values"
        CHECK ("domain_status" IS NULL OR "domain_status" IN ('pending_activation'))
    `);

    // ---- 2.4: client_report_share_link (US-44, new table) ----

    await queryRunner.query(`
      CREATE TABLE "client_report_share_link" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "client_performance_report_id" uuid NOT NULL REFERENCES "client_performance_report"("id"),
        "account_id" uuid NOT NULL REFERENCES "account"("id"),
        "token" text NOT NULL,
        "created_by_user_id" uuid NOT NULL REFERENCES "user"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "expires_at" timestamptz NOT NULL,
        "revoked_at" timestamptz NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_share_link_token" ON "client_report_share_link" ("token")
    `);

    await queryRunner.query(`ALTER TABLE "client_report_share_link" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "client_report_share_link" FORCE ROW LEVEL SECURITY`);

    // Authenticated operations (mint/list/revoke) use the standard
    // single-tenant branch; the public, token-gated view
    // (GET /public/client-reports/:token) has no tenant context at all and
    // relies on the fifth escape-hatch flag, app.public_share_link_read,
    // narrower in blast radius than every prior one because the service
    // layer always supplies an exact WHERE token = $1 filter before the
    // flag is ever relevant (section 2.8).
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "client_report_share_link"
        USING (
          "account_id" = current_setting('app.current_account_id', true)::uuid
          OR current_setting('app.public_share_link_read', true) = 'true'
        )
    `);

    // ---- 2.7: audit_log read/write RLS retrofit (FR-60, ADR-0062) ----

    await queryRunner.query(`ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY`);

    // Writes stay unrestricted: audit logging is invoked from request
    // contexts that legitimately target an account other than the caller's
    // own current session (client_account.created, operator_access.granted/
    // revoked), or no account at all (user.registered, pre-X-Account-Id).
    // Checked against every existing call site before writing this policy
    // (ADR-0062) -- a symmetric policy would have broken all three.
    await queryRunner.query(`
      CREATE POLICY audit_log_write ON "audit_log"
        FOR INSERT WITH CHECK (true)
    `);

    // Reads are the actual tenant boundary this epic's new endpoint needs.
    // A row with target_account_id = NULL is never returned to any
    // single-tenant read, consistent with FR-60's per-client framing.
    await queryRunner.query(`
      CREATE POLICY audit_log_read ON "audit_log"
        FOR SELECT USING ("target_account_id" = current_setting('app.current_account_id', true)::uuid)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP POLICY IF EXISTS audit_log_read ON "audit_log"`);
    await queryRunner.query(`DROP POLICY IF EXISTS audit_log_write ON "audit_log"`);
    await queryRunner.query(`ALTER TABLE "audit_log" DISABLE ROW LEVEL SECURITY`);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "client_report_share_link"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "client_report_share_link"`);

    await queryRunner.query(`
      ALTER TABLE "agency_branding_profile" DROP CONSTRAINT IF EXISTS "chk_domain_status_values"
    `);
    await queryRunner.query(`
      ALTER TABLE "agency_branding_profile"
        DROP COLUMN IF EXISTS "custom_domain",
        DROP COLUMN IF EXISTS "domain_status"
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "campaign_template"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "campaign_template"
        USING ("account_id" = current_setting('app.current_account_id', true)::uuid)
    `);
    await queryRunner.query(`
      ALTER TABLE "campaign_template" DROP COLUMN IF EXISTS "copied_from_template_id"
    `);
  }
}
