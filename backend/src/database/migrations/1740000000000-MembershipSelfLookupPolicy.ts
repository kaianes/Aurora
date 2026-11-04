import { MigrationInterface, QueryRunner } from 'typeorm';

// Fixes a gap the tenant-isolation remediation (ADR-0063/0064) exposed once
// RLS actually started being enforced: login and email-verification look up
// "which accounts does this user belong to" by querying membership before
// any account context exists to pin -- that's the whole point of the
// query. The existing tenant_isolation policy on membership only recognizes
// an already-known account_id, so under real RLS this self-lookup always
// returned zero rows. Adds a second, SELECT-only permissive policy keyed on
// the caller's own user id (set via app.current_user_id, mirroring the
// app.current_account_id / app.creator_portal escape-hatch pattern already
// used elsewhere) rather than widening or replacing the account-scoped
// tenant_isolation policy, which stays exactly as-is for INSERT/UPDATE/
// DELETE and for every other account-scoped read.
export class MembershipSelfLookupPolicy1740000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE POLICY membership_self_lookup ON "membership"
        FOR SELECT
        USING ("user_id" = current_setting('app.current_user_id', true)::uuid)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP POLICY IF EXISTS membership_self_lookup ON "membership"`);
  }
}
