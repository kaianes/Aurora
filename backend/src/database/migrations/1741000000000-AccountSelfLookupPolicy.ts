import { MigrationInterface, QueryRunner } from 'typeorm';

// Companion to 1740000000000-MembershipSelfLookupPolicy. Fixing membership's
// self-lookup (by user id) was not enough on its own: login's query joins
// membership -> account -> workspace to return account_name per membership,
// and account's own tenant_isolation policy (id = current_setting
// ('app.current_account_id')) still filtered that joined account row to
// null, since no account context is pinned yet at login time either --
// RLS applies per-table regardless of which table drove the join. Adds the
// same style of second, SELECT-only permissive policy to account: visible
// if a membership row ties it to the caller's own user id (the policy this
// depends on is itself gated the same way, so this doesn't leak account
// existence beyond what membership_self_lookup already exposes).
export class AccountSelfLookupPolicy1741000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE POLICY account_self_lookup ON "account"
        FOR SELECT
        USING (
          EXISTS (
            SELECT 1 FROM "membership" m
            WHERE m."account_id" = "account"."id"
              AND m."user_id" = current_setting('app.current_user_id', true)::uuid
          )
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP POLICY IF EXISTS account_self_lookup ON "account"`);
  }
}
