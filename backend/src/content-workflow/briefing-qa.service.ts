import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Briefing,
  BriefingStatus,
  BriefingQaThread,
  BriefingQaMessage,
  QaSenderType,
  Campaign,
  CampaignOpportunity,
  OpportunityStatus,
  Creator,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';

interface ActorContext {
  userId?: string;
  ipAddress: string;
  userAgent: string;
}

const BRIEFING_NOT_AVAILABLE_ERROR = {
  error: {
    code: 'BRIEFING_NOT_AVAILABLE',
    message: 'Nenhum briefing disponivel para voce nesta campanha.',
    details: {},
  },
};

// US-30 (briefing view gate) and US-31 (Q&A). ADR-0028/ADR-0029: view access
// is computed live against campaign_opportunity, never against the
// distribution snapshot; a thread is private between one creator and the
// buyer (unique on briefing_id, creator_id).
@Injectable()
export class BriefingQaService {
  constructor(
    @InjectRepository(Briefing)
    private briefingRepo: Repository<Briefing>,
    @InjectRepository(CampaignOpportunity)
    private opportunityRepo: Repository<CampaignOpportunity>,
    @InjectRepository(BriefingQaThread)
    private threadRepo: Repository<BriefingQaThread>,
    @InjectRepository(BriefingQaMessage)
    private messageRepo: Repository<BriefingQaMessage>,
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @InjectRepository(Creator)
    private creatorRepo: Repository<Creator>,
    private auditService: AuditService,
  ) {}

  // ---- Creator-portal side (US-30, US-31) ----

  // The live view-access gate (ADR-0029): a briefing is visible to a
  // creator only while they currently hold an accepted campaign_opportunity
  // for the campaign, independent of the distribution snapshot.
  private async resolveBriefingForCreatorOrFail(campaignId: string, creatorId: string): Promise<Briefing> {
    const briefing = await this.briefingRepo.findOne({ where: { campaignId } });
    if (!briefing || briefing.status !== BriefingStatus.ISSUED) {
      throw new NotFoundException(BRIEFING_NOT_AVAILABLE_ERROR);
    }

    const opportunity = await this.opportunityRepo.findOne({
      where: { campaignId, creatorId, status: OpportunityStatus.ACCEPTED },
    });
    if (!opportunity) {
      throw new NotFoundException(BRIEFING_NOT_AVAILABLE_ERROR);
    }

    return briefing;
  }

  async getBriefingForCreator(campaignId: string, creatorId: string) {
    const briefing = await this.resolveBriefingForCreatorOrFail(campaignId, creatorId);
    return {
      id: briefing.id,
      campaign_id: briefing.campaignId,
      status: briefing.status,
      dos: briefing.dos,
      donts: briefing.donts,
      reference_examples: briefing.referenceExamples,
      deliverable_spec: briefing.deliverableSpec,
      deadline: briefing.deadline ? briefing.deadline.toISOString() : null,
      issued_at: briefing.issuedAt ? briefing.issuedAt.toISOString() : null,
      created_at: briefing.createdAt.toISOString(),
      updated_at: briefing.updatedAt.toISOString(),
    };
  }

  async askQuestion(campaignId: string, creatorId: string, question: string, actor: ActorContext) {
    const briefing = await this.resolveBriefingForCreatorOrFail(campaignId, creatorId);

    let thread = await this.threadRepo.findOne({ where: { briefingId: briefing.id, creatorId } });
    if (!thread) {
      thread = await this.threadRepo.save(
        this.threadRepo.create({ briefingId: briefing.id, campaignId, creatorId }),
      );
    }

    const message = await this.messageRepo.save(
      this.messageRepo.create({
        threadId: thread.id,
        campaignId,
        senderType: QaSenderType.CREATOR,
        senderCreatorId: creatorId,
        body: question,
      }),
    );

    await this.auditService.log({
      actorUserId: null,
      targetAccountId: null,
      action: 'briefing_qa.question_asked',
      metadata: { thread_id: thread.id, briefing_id: briefing.id, campaign_id: campaignId, creator_id: creatorId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      thread_id: thread.id,
      sender_type: message.senderType,
      body: message.body,
      created_at: message.createdAt.toISOString(),
    };
  }

  async getOwnThread(campaignId: string, creatorId: string) {
    const briefing = await this.resolveBriefingForCreatorOrFail(campaignId, creatorId);

    const thread = await this.threadRepo.findOne({ where: { briefingId: briefing.id, creatorId } });
    if (!thread) {
      return { thread_id: null, messages: [], answered: null };
    }

    const messages = await this.messageRepo.find({ where: { threadId: thread.id }, order: { createdAt: 'ASC' } });

    return {
      thread_id: thread.id,
      messages: messages.map((m) => this.formatMessage(m)),
      answered: this.computeAnswered(messages),
    };
  }

  // ---- Brand side (US-31) ----

  async findCampaignOrFail(id: string, accountId: string): Promise<Campaign> {
    const campaign = await this.campaignRepo.findOne({ where: { id, accountId } });
    if (!campaign) {
      throw new NotFoundException({
        error: { code: 'CAMPAIGN_NOT_FOUND', message: 'Campanha nao encontrada.', details: {} },
      });
    }
    return campaign;
  }

  async listThreads(campaignId: string, accountId: string) {
    await this.findCampaignOrFail(campaignId, accountId);

    const briefing = await this.briefingRepo.findOne({ where: { campaignId } });
    if (!briefing) {
      return { data: [] };
    }

    const threads = await this.threadRepo.find({ where: { briefingId: briefing.id }, order: { createdAt: 'DESC' } });

    const data = await Promise.all(
      threads.map(async (thread) => {
        const messages = await this.messageRepo.find({ where: { threadId: thread.id }, order: { createdAt: 'ASC' } });
        const creator = await this.creatorRepo.findOne({ where: { id: thread.creatorId } });
        const lastMessage = messages[messages.length - 1];
        return {
          thread_id: thread.id,
          creator_id: thread.creatorId,
          creator_display_name: creator?.displayName || null,
          message_count: messages.length,
          answered: this.computeAnswered(messages),
          last_message_at: lastMessage ? lastMessage.createdAt.toISOString() : thread.createdAt.toISOString(),
        };
      }),
    );

    return { data };
  }

  async getThreadDetail(campaignId: string, threadId: string, accountId: string) {
    await this.findCampaignOrFail(campaignId, accountId);
    const thread = await this.findThreadOrFail(campaignId, threadId);

    const messages = await this.messageRepo.find({ where: { threadId: thread.id }, order: { createdAt: 'ASC' } });
    const creator = await this.creatorRepo.findOne({ where: { id: thread.creatorId } });

    return {
      thread_id: thread.id,
      creator_id: thread.creatorId,
      creator_display_name: creator?.displayName || null,
      messages: messages.map((m) => this.formatMessage(m)),
      answered: this.computeAnswered(messages),
    };
  }

  async answerQuestion(campaignId: string, threadId: string, accountId: string, body: string, actor: ActorContext) {
    await this.findCampaignOrFail(campaignId, accountId);
    const thread = await this.findThreadOrFail(campaignId, threadId);

    if (!actor.userId) {
      throw new ForbiddenException({
        error: { code: 'INSUFFICIENT_PRIVILEGES', message: 'Acesso nao autorizado.', details: {} },
      });
    }

    const message = await this.messageRepo.save(
      this.messageRepo.create({
        threadId: thread.id,
        campaignId,
        senderType: QaSenderType.BRAND,
        senderUserId: actor.userId,
        body,
      }),
    );

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'briefing_qa.answered',
      metadata: { thread_id: thread.id, campaign_id: campaignId, creator_id: thread.creatorId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      thread_id: thread.id,
      sender_type: message.senderType,
      body: message.body,
      created_at: message.createdAt.toISOString(),
    };
  }

  private async findThreadOrFail(campaignId: string, threadId: string): Promise<BriefingQaThread> {
    const thread = await this.threadRepo.findOne({ where: { id: threadId, campaignId } });
    if (!thread) {
      throw new NotFoundException({
        error: { code: 'THREAD_NOT_FOUND', message: 'Thread de perguntas nao encontrada.', details: {} },
      });
    }
    return thread;
  }

  // No "answered" flag is stored (ADR-0028): computed from whether the
  // thread's last message has sender_type = creator.
  private computeAnswered(messages: BriefingQaMessage[]): boolean {
    if (messages.length === 0) return false;
    return messages[messages.length - 1].senderType === QaSenderType.BRAND;
  }

  private formatMessage(message: BriefingQaMessage) {
    return {
      sender_type: message.senderType,
      body: message.body,
      created_at: message.createdAt.toISOString(),
    };
  }
}
