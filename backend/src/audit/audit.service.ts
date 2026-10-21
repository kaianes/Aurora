import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditLog, User } from '../database/entities';

export interface AuditLogEntry {
  actorUserId: string | null;
  targetAccountId: string | null;
  action: string;
  metadata: Record<string, any>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async log(entry: AuditLogEntry): Promise<void> {
    const auditLog = this.auditLogRepository.create({
      actorUserId: entry.actorUserId,
      targetAccountId: entry.targetAccountId,
      action: entry.action,
      metadata: entry.metadata || {},
      ipAddress: entry.ipAddress || null,
      userAgent: entry.userAgent || null,
    });
    await this.auditLogRepository.save(auditLog);
  }

  // FR-60, section 5.4 of the E9 architecture doc. The tenant boundary is
  // enforced by two layers, not one: RolesGuard/AccountAccessService has
  // already refused this call entirely (403, logged) unless the caller has
  // a resolvable relationship -- direct or via operator_client_access -- to
  // accountId, and audit_log's own audit_log_read RLS policy (ADR-0062)
  // restricts the underlying SELECT to target_account_id = accountId
  // regardless. No new authorization code is written here on top of that.
  //
  // actor_name/actor_email are resolved with a second, narrow query against
  // user rather than a SQL join, since AuditLog carries no relation to User
  // (actor_user_id is intentionally nullable, e.g. the pre-X-Account-Id
  // user.registered event) -- a left join would need to be expressed as raw
  // SQL for no benefit over this simpler two-step read.
  async listForAccount(accountId: string, cursor?: string, limit: number = DEFAULT_LIMIT) {
    const take = Math.min(limit > 0 ? limit : DEFAULT_LIMIT, MAX_LIMIT);

    const qb = this.auditLogRepository
      .createQueryBuilder('a')
      .where('a.targetAccountId = :accountId', { accountId })
      .orderBy('a.createdAt', 'DESC')
      .addOrderBy('a.id', 'DESC')
      .limit(take + 1);

    if (cursor) {
      qb.andWhere('a.id < :cursor', { cursor });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > take;
    const page = rows.slice(0, take);

    const actorIds = [
      ...new Set(page.map((row) => row.actorUserId).filter((id): id is string => !!id)),
    ];
    const actors = actorIds.length
      ? await this.userRepository.find({ where: { id: In(actorIds) } })
      : [];
    const actorsById = new Map(actors.map((u) => [u.id, u]));

    const data = page.map((row) => {
      const actor = row.actorUserId ? actorsById.get(row.actorUserId) : undefined;
      return {
        id: String(row.id),
        actor_user_id: row.actorUserId,
        actor_name: actor?.name ?? null,
        actor_email: actor?.email ?? null,
        action: row.action,
        metadata: row.metadata,
        created_at: row.createdAt.toISOString(),
      };
    });

    return {
      data,
      pagination: {
        next_cursor: hasMore ? String(page[page.length - 1].id) : null,
        has_more: hasMore,
      },
    };
  }
}
