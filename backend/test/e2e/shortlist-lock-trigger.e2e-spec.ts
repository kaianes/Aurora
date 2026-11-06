import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { appDataSource, adminDataSource } from './support/test-db';

// Mirrors the manual verification run while building the
// 1743000000000-AllowCreatorLeavingLockedPool migration (2026-11-04):
// proves the trigger allows exactly the decline/auto-expiry mutation
// shape (included: true -> false, nothing else changes) and still blocks
// every other post-lock edit. This is the test that would have caught
// "a creator can never decline an opportunity" -- a database trigger bug,
// invisible to every mocked unit test that already existed.
describe('shortlist_entry_lock_guard trigger - e2e', () => {
  const admin = adminDataSource();

  let workspaceId: string;
  let accountId: string;
  let userId: string;
  let campaignId: string;
  let shortlistId: string;

  async function seedEntry(overrides: { included?: boolean; rank?: number } = {}) {
    const id = randomUUID();
    const creatorId = randomUUID();
    await admin.query(`INSERT INTO creator (id, display_name) VALUES ($1, 'E2E Trigger Creator')`, [creatorId]);
    await admin.query(
      `INSERT INTO campaign_shortlist_entry (id, shortlist_id, campaign_id, creator_id, origin, included, rank)
       VALUES ($1, $2, $3, $4, 'system_ranked', $5, $6)`,
      [id, shortlistId, campaignId, creatorId, overrides.included ?? true, overrides.rank ?? 1],
    );
    return { id, creatorId };
  }

  beforeAll(async () => {
    await admin.initialize();

    workspaceId = randomUUID();
    accountId = randomUUID();
    userId = randomUUID();
    campaignId = randomUUID();
    shortlistId = randomUUID();

    await admin.query(`INSERT INTO "user" (id, email, password_hash, name, email_verified) VALUES ($1, $2, 'x', 'E2E', true)`, [
      userId,
      `trigger-e2e-${randomUUID()}@example.com`,
    ]);
    await admin.query(
      `INSERT INTO workspace (id, name, type, max_client_accounts) VALUES ($1, 'E2E Trigger WS', 'brand', 1)`,
      [workspaceId],
    );
    await admin.query(`INSERT INTO account (id, workspace_id, name) VALUES ($1, $2, 'E2E Trigger Account')`, [
      accountId,
      workspaceId,
    ]);
    await admin.query(
      `INSERT INTO campaign (id, account_id, created_by_user_id, name, message) VALUES ($1, $2, $3, 'E2E Trigger Campaign', 'x')`,
      [campaignId, accountId, userId],
    );
    // locked: true, locked_reason: campaign_activated -- the real-world
    // state by the time any campaign_opportunity exists, per ADR-0012.
    await admin.query(
      `INSERT INTO campaign_shortlist (id, campaign_id, status, locked, locked_reason, locked_at)
       VALUES ($1, $2, 'ready', true, 'campaign_activated', now())`,
      [shortlistId, campaignId],
    );
  });

  afterAll(async () => {
    await admin.query(`DELETE FROM campaign_shortlist_entry WHERE shortlist_id = $1`, [shortlistId]);
    await admin.query(`DELETE FROM campaign_shortlist WHERE id = $1`, [shortlistId]);
    await admin.query(`DELETE FROM campaign WHERE id = $1`, [campaignId]);
    await admin.query(`DELETE FROM account WHERE id = $1`, [accountId]);
    await admin.query(`DELETE FROM workspace WHERE id = $1`, [workspaceId]);
    await admin.query(`DELETE FROM "user" WHERE id = $1`, [userId]);
    await admin.destroy();
  });

  it('allows the exact decline/auto-expiry shape: included true -> false, nothing else', async () => {
    const { id } = await seedEntry();
    await expect(
      admin.query(`UPDATE campaign_shortlist_entry SET included = false WHERE id = $1`, [id]),
    ).resolves.toBeTruthy();

    const row = await admin.query(`SELECT included FROM campaign_shortlist_entry WHERE id = $1`, [id]);
    expect(row[0].included).toBe(false);
  });

  it('blocks re-including a previously-excluded entry (false -> true)', async () => {
    const { id } = await seedEntry({ included: false });
    await expect(
      admin.query(`UPDATE campaign_shortlist_entry SET included = true WHERE id = $1`, [id]),
    ).rejects.toThrow(/locked/);
  });

  it('blocks an unrelated column edit on a still-included entry', async () => {
    const { id } = await seedEntry({ rank: 1 });
    await expect(
      admin.query(`UPDATE campaign_shortlist_entry SET rank = 99 WHERE id = $1`, [id]),
    ).rejects.toThrow(/locked/);
  });

  it('blocks the included flip when bundled with another column change', async () => {
    const { id } = await seedEntry({ rank: 1 });
    await expect(
      admin.query(`UPDATE campaign_shortlist_entry SET included = false, rank = 5 WHERE id = $1`, [id]),
    ).rejects.toThrow(/locked/);
  });
});
