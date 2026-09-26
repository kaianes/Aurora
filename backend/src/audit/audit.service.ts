import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../database/entities';

export interface AuditLogEntry {
  actorUserId: string | null;
  targetAccountId: string | null;
  action: string;
  metadata: Record<string, any>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
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
}
