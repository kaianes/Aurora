import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { appDataSource, adminDataSource } from './support/test-db';

// This is the one test that directly proves the 2026-11-02 fix
// (BYPASSRLS -> aurora_app) actually works -- not against a mock, against
// real Postgres, through the exact mechanism TenantContextRunner uses in
// production (set_config('app.current_account_id', $1, true) inside a
// transaction). Mirrors the manual verification done that day against the
// live Railway deployment: two independent accounts, each with their own
// brand_profile, each unable to read or write the other's by id.
describe('Tenant isolation (RLS) - e2e', () => {
  const admin = adminDataSource();
  const app = appDataSource();

  let workspaceAId: string;
  let workspaceBId: string;
  let accountAId: string;
  let accountBId: string;
  let profileAId: string;
  let profileBId: string;

  // Runs `work` inside a single transaction with app.current_account_id
  // pinned, exactly like TenantContextRunner.runAsAccount does for every
  // real authenticated, account-scoped request.
  async function asAccount<T>(accountId: string, work: (qr: ReturnType<typeof app.createQueryRunner>) => Promise<T>) {
    const qr = app.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await qr.query(`SELECT set_config('app.current_account_id', $1, true)`, [accountId]);
      const result = await work(qr);
      await qr.commitTransaction();
      return result;
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  beforeAll(async () => {
    await admin.initialize();
    await app.initialize();

    workspaceAId = randomUUID();
    workspaceBId = randomUUID();
    accountAId = randomUUID();
    accountBId = randomUUID();
    profileAId = randomUUID();
    profileBId = randomUUID();

    await admin.query(
      `INSERT INTO workspace (id, name, type, max_client_accounts) VALUES ($1, 'E2E Tenant A WS', 'brand', 1)`,
      [workspaceAId],
    );
    await admin.query(
      `INSERT INTO workspace (id, name, type, max_client_accounts) VALUES ($1, 'E2E Tenant B WS', 'brand', 1)`,
      [workspaceBId],
    );
    await admin.query(`INSERT INTO account (id, workspace_id, name) VALUES ($1, $2, 'E2E Tenant A')`, [
      accountAId,
      workspaceAId,
    ]);
    await admin.query(`INSERT INTO account (id, workspace_id, name) VALUES ($1, $2, 'E2E Tenant B')`, [
      accountBId,
      workspaceBId,
    ]);

    // Inserted via the app role, inside a transaction pinned to the row's
    // own account -- exactly what AuthService.register() does, and exactly
    // what satisfies account.tenant_isolation's
    // id = current_setting('app.current_account_id').
    await asAccount(accountAId, (qr) =>
      qr.query(`INSERT INTO brand_profile (id, account_id, name) VALUES ($1, $2, 'A Confidential Brand')`, [
        profileAId,
        accountAId,
      ]),
    );
    await asAccount(accountBId, (qr) =>
      qr.query(`INSERT INTO brand_profile (id, account_id, name) VALUES ($1, $2, 'B Confidential Brand')`, [
        profileBId,
        accountBId,
      ]),
    );
  });

  afterAll(async () => {
    await admin.query(`DELETE FROM brand_profile WHERE id = ANY($1)`, [[profileAId, profileBId]]);
    await admin.query(`DELETE FROM account WHERE id = ANY($1)`, [[accountAId, accountBId]]);
    await admin.query(`DELETE FROM workspace WHERE id = ANY($1)`, [[workspaceAId, workspaceBId]]);
    await admin.destroy();
    await app.destroy();
  });

  it("blocks tenant B from reading tenant A's brand profile by its real id", async () => {
    const rows = await asAccount(accountBId, (qr) =>
      qr.query(`SELECT * FROM brand_profile WHERE id = $1`, [profileAId]),
    );
    expect(rows).toHaveLength(0);
  });

  it("blocks tenant B from updating tenant A's brand profile by its real id", async () => {
    await asAccount(accountBId, (qr) =>
      qr.query(`UPDATE brand_profile SET name = 'PWNED' WHERE id = $1`, [profileAId]),
    );

    const stillA = await admin.query(`SELECT name FROM brand_profile WHERE id = $1`, [profileAId]);
    expect(stillA[0].name).toBe('A Confidential Brand');
  });

  it("blocks tenant A from reading or updating tenant B's brand profile (symmetric)", async () => {
    const rows = await asAccount(accountAId, (qr) =>
      qr.query(`SELECT * FROM brand_profile WHERE id = $1`, [profileBId]),
    );
    expect(rows).toHaveLength(0);

    await asAccount(accountAId, (qr) =>
      qr.query(`UPDATE brand_profile SET name = 'PWNED' WHERE id = $1`, [profileBId]),
    );
    const stillB = await admin.query(`SELECT name FROM brand_profile WHERE id = $1`, [profileBId]);
    expect(stillB[0].name).toBe('B Confidential Brand');
  });

  it('still lets each tenant read and update its own brand profile normally', async () => {
    const rows = await asAccount(accountAId, (qr) =>
      qr.query(`SELECT * FROM brand_profile WHERE id = $1`, [profileAId]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('A Confidential Brand');

    await asAccount(accountAId, (qr) =>
      qr.query(`UPDATE brand_profile SET tone_of_voice = 'confirmed by e2e' WHERE id = $1`, [profileAId]),
    );
    const updated = await admin.query(`SELECT tone_of_voice FROM brand_profile WHERE id = $1`, [profileAId]);
    expect(updated[0].tone_of_voice).toBe('confirmed by e2e');
  });

  it('a connection with no pinned account context sees neither profile (fail-closed)', async () => {
    const rows = await app.query(`SELECT * FROM brand_profile WHERE id = ANY($1)`, [
      [profileAId, profileBId],
    ]);
    expect(rows).toHaveLength(0);
  });
});
