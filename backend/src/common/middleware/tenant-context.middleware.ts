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
