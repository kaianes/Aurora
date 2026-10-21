import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from '../audit/audit.service';

export const AUDIT_RESOURCE_KEY = 'financialAuditResource';

// Marks a GET handler with the financial resource it reads, so
// FinancialAccessAuditInterceptor knows what to name the access-log entry
// (payout_obligation.accessed, invoice.accessed, tax_document.accessed).
export const AuditResource = (resource: string) => SetMetadata(AUDIT_RESOURCE_KEY, resource);

// NFR-23's read-logging requirement (section 4.1 of the E6 architecture
// doc): the first epic whose audit convention covers reads, not only
// writes. Applied to every controller in this epic, the same
// CorrelationIdInterceptor-style reusable-interceptor precedent, rather
// than a per-handler audit call duplicated at every GET. Only fires for GET
// requests on a handler carrying @AuditResource -- mutations already write
// their own explicit audit log entry for the action itself (NFR-17), so
// this never double-logs a write as an "access."
@Injectable()
export class FinancialAccessAuditInterceptor implements NestInterceptor {
  constructor(
    private reflector: Reflector,
    private auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const resource = this.reflector.getAllAndOverride<string>(AUDIT_RESOURCE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest();

    if (!resource || request.method !== 'GET') {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        const actorUserId = request.auroraOperatorUserId || request.user?.sub || null;
        const actorCreatorId = request.user?.creatorId || null;
        this.auditService
          .log({
            actorUserId,
            targetAccountId: request.currentAccountId || null,
            action: `${resource}.accessed`,
            metadata: {
              resource_id: request.params?.id || null,
              creator_id: actorCreatorId,
            },
            ipAddress: request.ip,
            userAgent: request.headers?.['user-agent'],
          })
          .catch(() => undefined);
      }),
    );
  }
}
