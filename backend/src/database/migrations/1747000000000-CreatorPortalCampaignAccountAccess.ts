import { MigrationInterface, QueryRunner } from 'typeorm';

// The creator portal interceptor sets `app.creator_portal = 'true'` for every
// creator-authenticated request (TenantContextRunner.runAsCreatorPortal).
// Tables like campaign_opportunity and content_submission already include an
// `OR current_setting('app.creator_portal', true) = 'true'` escape hatch so
// the creator portal can read the creator's own data. But `campaign` and
// `account` were left tenant-only, causing services that need to look up
// campaign state or brand name on behalf of a creator to get zero rows.
//
// This migration adds the same escape hatch to `campaign` (tenant_isolation)
// and `account` (tenant_isolation) policies. The service-level code still
// filters by creator_id, so a creator can only reach data related to their
// own opportunities — the RLS relaxation just prevents the database from
// blanket-blocking the SELECT before the service filter can run.
export class CreatorPortalCampaignAccountAccess1747000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const AID = `NULLIF(current_setting('app.current_account_id', true), '')::uuid`;

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "campaign"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "campaign"
        USING (
          "account_id" = ${AID}
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "account"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "account"
        USING (
          "id" = ${AID}
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const AID = `NULLIF(current_setting('app.current_account_id', true), '')::uuid`;

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "campaign"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "campaign"
        USING ("account_id" = ${AID})
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "account"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "account"
        USING ("id" = ${AID})
    `);
  }
}
