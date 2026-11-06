import { MigrationInterface, QueryRunner } from 'typeorm';

// Found 2026-11-06 while building the first real-Postgres integration
// test (Tier 3 item, advisor feedback): `current_setting('app.x', true)`
// does NOT reliably return NULL for "never pinned" the way every RLS
// policy in this codebase assumes. The *first* time a session ever
// references a custom GUC name (even once, even inside a transaction that
// later commits normally), Postgres creates a placeholder for it that
// persists for the rest of that physical connection -- after that point,
// "not currently set" reads back as an empty string, not NULL, for every
// later query on that same connection. Reproduced directly against a
// pooled connection (pg.Pool, no TypeORM involved): set_config(...,
// is_local=true) + COMMIT + release, then a later unrelated query on the
// same reused connection sees current_setting(..., true) = '', not NULL.
// RESET does not undo this either.
//
// Effect in production: `::uuid` casts this empty string, not NULL,
// raising `invalid input syntax for type uuid: ""` -- the exact error
// shape chased as an "unexplained mystery" earlier in this same
// remediation (2026-11-02/04; see project_rls_bypassrls_confirmed memory)
// on any pooled connection that has handled even one prior pinned
// request. This fixes only the two policies this session's new e2e
// tenant-isolation test exercises (account, brand_profile) -- NULLIF
// coerces the empty-string case back to a real NULL before the cast,
// verified directly: returns NULL on a "touched then reverted" connection,
// and still returns the real value when actually pinned.
//
// The identical unsafe cast appears in every other migration in this
// repository (CampaignSchema, MatchingSchema, BrandSafetySchema,
// ContentWorkflowSchema, PaymentsSchema, AnalyticsSchema,
// AgencyMultiClientSchema, and the two self-lookup / system-job policies
// added 2026-11-02/04) -- all carry the same latent risk on a long-lived
// connection pool, and were deliberately NOT touched here. That's a much
// larger, cross-cutting change this migration doesn't make unilaterally.
export class NullSafeTenantContextCast1744000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "account"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "account"
        USING ("id" = NULLIF(current_setting('app.current_account_id', true), '')::uuid)
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "brand_profile"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "brand_profile"
        USING ("account_id" = NULLIF(current_setting('app.current_account_id', true), '')::uuid)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "brand_profile"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "brand_profile"
        USING ("account_id" = current_setting('app.current_account_id', true)::uuid)
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "account"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "account"
        USING ("id" = current_setting('app.current_account_id', true)::uuid)
    `);
  }
}
