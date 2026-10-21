import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Creator,
  CreatorDataSubjectRequest,
  DataSubjectRequestStatus,
  DataSubjectRequestType,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { CreateDataSubjectRequestDto, FulfillDataSubjectRequestDto } from './dto';
import { DATA_SUBJECT_REQUEST_DUE_DAYS, addDays } from './creator-network.config';

interface ActorContext {
  ipAddress: string;
  userAgent: string;
}

// NFR-21 (beyond FR-13's claim-time scope) / ADR-0056 (section 8 of the E8
// architecture doc). A minimal, ops-mediated request queue -- an operator
// creates a row on the creator's behalf once a request is received
// out-of-band, then fulfills it manually.
@Injectable()
export class DataSubjectRequestService {
  constructor(
    @InjectRepository(Creator)
    private creatorRepo: Repository<Creator>,
    @InjectRepository(CreatorDataSubjectRequest)
    private requestRepo: Repository<CreatorDataSubjectRequest>,
    private auditService: AuditService,
  ) {}

  async create(
    creatorId: string,
    dto: CreateDataSubjectRequestDto,
    operatorUserId: string,
    actor: ActorContext,
  ) {
    const creator = await this.creatorRepo.findOne({ where: { id: creatorId } });
    if (!creator) {
      throw new NotFoundException({
        error: { code: 'CREATOR_NOT_FOUND', message: 'Criador nao encontrado.', details: {} },
      });
    }

    const now = new Date();
    const dueAt = addDays(now, DATA_SUBJECT_REQUEST_DUE_DAYS);

    const request = this.requestRepo.create({
      creatorId,
      requestType: dto.request_type as DataSubjectRequestType,
      status: DataSubjectRequestStatus.PENDING,
      requestedAt: now,
      dueAt,
    });
    await this.requestRepo.save(request);

    await this.auditService.log({
      actorUserId: operatorUserId,
      targetAccountId: null,
      action: 'creator_data_subject_request.created',
      metadata: { request_id: request.id, creator_id: creatorId, request_type: dto.request_type },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      request_id: request.id,
      status: request.status,
      due_at: dueAt.toISOString(),
    };
  }

  async fulfill(
    creatorId: string,
    requestId: string,
    dto: FulfillDataSubjectRequestDto,
    operatorUserId: string,
    actor: ActorContext,
  ) {
    const request = await this.requestRepo.findOne({ where: { id: requestId, creatorId } });
    if (!request) {
      throw new NotFoundException({
        error: {
          code: 'DATA_SUBJECT_REQUEST_NOT_FOUND',
          message: 'Solicitacao nao encontrada.',
          details: {},
        },
      });
    }

    request.status = DataSubjectRequestStatus.FULFILLED;
    request.exportDocumentUrl = dto.export_document_url ?? null;
    request.fulfilledAt = new Date();
    request.fulfilledByUserId = operatorUserId;
    await this.requestRepo.save(request);

    await this.auditService.log({
      actorUserId: operatorUserId,
      targetAccountId: null,
      action: 'creator_data_subject_request.fulfilled',
      metadata: { request_id: request.id, creator_id: creatorId, request_type: request.requestType },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      request_id: request.id,
      status: request.status,
      export_document_url: request.exportDocumentUrl,
      fulfilled_at: request.fulfilledAt.toISOString(),
    };
  }
}
