import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import {
  CampaignOpportunity,
  OpportunityStatus,
  Creator,
  CampaignPoolMember,
  CampaignShortlistEntry,
  PoolMemberStatus,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';

const STALENESS_WINDOW_MS = 24 * 60 * 60 * 1000; // NFR-35

@Injectable()
export class MatchingScheduledTasksService {
  private readonly logger = new Logger(MatchingScheduledTasksService.name);

  constructor(
    @InjectRepository(CampaignOpportunity)
    private opportunityRepo: Repository<CampaignOpportunity>,
    @InjectRepository(Creator)
    private creatorRepo: Repository<Creator>,
    @InjectRepository(CampaignShortlistEntry)
    private entryRepo: Repository<CampaignShortlistEntry>,
    @InjectRepository(CampaignPoolMember)
    private poolMemberRepo: Repository<CampaignPoolMember>,
    private auditService: AuditService,
  ) {}

  // US-28 scenario 3: expiry is automatic, never treated as a decline, and
  // never creates a payout obligation.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireOpportunities() {
    const expired = await this.opportunityRepo.find({
      where: { status: OpportunityStatus.PENDING, expiresAt: LessThan(new Date()) },
    });
    if (expired.length === 0) return;

    for (const opportunity of expired) {
      opportunity.status = OpportunityStatus.EXPIRED;
      await this.opportunityRepo.save(opportunity);

      // ADR-0012: an expired-unanswered opportunity also leaves the pool,
      // same as a decline, so pool-fill-check can detect the shortfall.
      const entry = await this.entryRepo.findOne({ where: { id: opportunity.shortlistEntryId } });
      if (entry) {
        await this.entryRepo.update({ id: entry.id }, { included: false });
        await this.poolMemberRepo.update(
          { campaignId: opportunity.campaignId, creatorId: opportunity.creatorId },
          { status: PoolMemberStatus.EXCLUDED },
        );
      }

      await this.auditService.log({
        actorUserId: null,
        targetAccountId: null,
        action: 'opportunity.expired',
        metadata: { opportunity_id: opportunity.id, campaign_id: opportunity.campaignId },
      });
    }
    this.logger.log(`Expired ${expired.length} pending opportunities`);
  }

  // Manages staleness flagging only; metric computation itself is E8's
  // scope (section 4 of the E3 architecture doc).
  @Cron(CronExpression.EVERY_HOUR)
  async refreshCreatorMetricsStaleness() {
    const cutoff = new Date(Date.now() - STALENESS_WINDOW_MS);
    const result = await this.creatorRepo.update(
      { metricsStale: false, metricsComputedAt: LessThan(cutoff) },
      { metricsStale: true },
    );
    if (result.affected && result.affected > 0) {
      this.logger.log(`Flagged ${result.affected} creators with stale metrics`);
    }
  }
}
