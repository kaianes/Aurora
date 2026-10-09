import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { DataSource } from 'typeorm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private dataSource: DataSource) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const user = (req as any).user;
    const headerValue = req.headers['x-account-id'];
    const accountId =
      (Array.isArray(headerValue) ? headerValue[0] : headerValue) ||
      (user?.currentAccountId as string);

    // Creators are not members of any account, so there is no
    // app.current_account_id to set for them. Creator-portal reads/writes
    // cross many brand accounts by design (section 2.3 of the E3
    // architecture doc); a dedicated session flag lets the narrow set of
    // E3 tables that creators touch allow those rows through RLS, while the
    // actual visibility restriction (a creator sees only their own rows) is
    // enforced in application code via the creator_id column, never by
    // account-scoped RLS, since no tenant boundary applies to this actor type.
    if (user?.isCreator) {
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.query(`SET LOCAL app.creator_portal = 'true'`);
      (req as any).queryRunner = queryRunner;
      next();
      return;
    }

    if (accountId) {
      if (!UUID_RE.test(accountId)) {
        next();
        return;
      }

      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.query(
        `SET LOCAL app.current_account_id = $1`,
        [accountId],
      );
      (req as any).queryRunner = queryRunner;
    }

    next();
  }
}
