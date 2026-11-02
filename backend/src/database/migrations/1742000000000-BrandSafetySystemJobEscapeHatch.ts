import { MigrationInterface, QueryRunner } from 'typeorm';

// BrandSafetyScheduledTasksService's two @Cron jobs (expirePendingChecks,
// monitorPublishedContent) are unattended platform-wide maintenance: they
// scan every account's stale/active rows, not one tenant's, and run with no
// HTTP request, no user, and so no account context to pin -- the same
// structural gap register/login had (membership_self_lookup,
// account_self_lookup, both 2026-11-02), surfaced the same way: real RLS
// enforcement (BYPASSRLS fix, same date) turned a previously-invisible
// no-op policy check into a hard failure the instant any row existed to
// evaluate the policy against. safety_check and safety_rule_trigger already
// had a creator_portal escape hatch for an unrelated reason (the creator's
// own status poll); safety_review_queue_item and published_content_snapshot
// had none. Rather than reuse app.aurora_operator (a human, MFA-verified
// principal per ADR-0038 -- semantically wrong for "no one is acting, this
// is an unattended job") or app.creator_portal (same wrong fit), adds one
// new escape hatch purpose-named for this case, following the same
// AS-established pattern (app.creator_portal, app.aurora_operator,
// app.agency_cross_client_read, app.agency_template_copy,
// app.public_share_link_read) rather than inventing a new mechanism.
export class BrandSafetySystemJobEscapeHatch1742000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "safety_check"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "safety_check"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
          )
          OR current_setting('app.creator_portal', true) = 'true'
          OR current_setting('app.aurora_system_job', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "safety_rule_trigger"`);
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
          OR current_setting('app.aurora_system_job', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "safety_review_queue_item"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "safety_review_queue_item"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
          )
          OR current_setting('app.aurora_system_job', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "published_content_snapshot"`);
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
          OR current_setting('app.aurora_system_job', true) = 'true'
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "published_content_snapshot"`);
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

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "safety_review_queue_item"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "safety_review_queue_item"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = current_setting('app.current_account_id', true)::uuid
          )
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "safety_rule_trigger"`);
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

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "safety_check"`);
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
  }
}
