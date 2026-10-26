import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { runInTransaction } from 'typeorm-transactional';

// Small Aurora-named wrapper around typeorm-transactional's API (ADR-0063),
// so the rest of the codebase depends on this abstraction rather than the
// third-party package directly -- the same "wrap the variable thing behind
// our own interface" convention already used for this codebase's other
// pluggable adapters (ADR-0021's content-safety adapter, ADR-0051's
// OAuth/audience-insights adapters).
//
// Mechanically, a per-request pin is a per-request transaction:
// runInTransaction opens a queryRunner, starts a transaction, and sets the
// AsyncLocalStorage context so every patched Repository/EntityManager/
// QueryBuilder call issued inside `work` resolves to this queryRunner's
// connection instead of checking one out of the pool. The SET LOCAL
// statement is issued through this.dataSource.query(...), which
// typeorm-transactional also patches to route to the active transaction's
// connection when one is open for the current async context -- so it reaches
// the same connection `work()` will use, not a fresh one from the pool.
@Injectable()
export class TenantContextRunner {
  constructor(private dataSource: DataSource) {}

  runAsAccount<T>(accountId: string, work: () => Promise<T>): Promise<T> {
    return runInTransaction(async () => {
      // accountId is already UUID-validated by RolesGuard/AccountAccessService
      // before this is ever called -- never string-interpolated here, bound
      // as a parameter instead, same as the middleware this replaces.
      await this.dataSource.query('SET LOCAL app.current_account_id = $1', [accountId]);
      return work();
    });
  }

  runAsCreatorPortal<T>(work: () => Promise<T>): Promise<T> {
    return runInTransaction(async () => {
      // Preserves the existing escape-hatch semantics exactly as written in
      // every migration's `OR current_setting('app.creator_portal', true) =
      // 'true'` branch -- no migration SQL changes as part of this ADR.
      await this.dataSource.query(`SET LOCAL app.creator_portal = 'true'`);
      return work();
    });
  }
}
