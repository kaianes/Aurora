import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import {
  Campaign,
  CampaignOpportunity,
  CampaignPerformanceAggregate,
  CampaignPoolMember,
  ContentSubmission,
  ContentSubmissionMetricSnapshot,
  Creator,
} from '../database/entities';

// US-21b / FR-51, section 5.2 of the E7 architecture document.
@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @InjectRepository(CampaignPoolMember)
    private poolMemberRepo: Repository<CampaignPoolMember>,
    @InjectRepository(CampaignOpportunity)
    private opportunityRepo: Repository<CampaignOpportunity>,
    @InjectRepository(ContentSubmission)
    private submissionRepo: Repository<ContentSubmission>,
    @InjectRepository(ContentSubmissionMetricSnapshot)
    private snapshotRepo: Repository<ContentSubmissionMetricSnapshot>,
    @InjectRepository(CampaignPerformanceAggregate)
    private aggregateRepo: Repository<CampaignPerformanceAggregate>,
    @InjectRepository(Creator)
    private creatorRepo: Repository<Creator>,
  ) {}

  async getDashboard(campaignId: string, accountId: string) {
    const campaign = await this.campaignRepo.findOne({ where: { id: campaignId, accountId } });
    if (!campaign) {
      throw new NotFoundException({
        error: { code: 'CAMPAIGN_NOT_FOUND', message: 'Campanha nao encontrada.', details: {} },
      });
    }

    // pool_aggregate is a direct read of campaign_performance_aggregate, no
    // computation at request time (NFR-02).
    const aggregate = await this.aggregateRepo.findOne({ where: { campaignId } });

    const members = await this.poolMemberRepo.find({ where: { campaignId } });

    const creators = [];
    for (const member of members) {
      const creator = await this.creatorRepo.findOne({ where: { id: member.creatorId } });
      const opportunity = await this.opportunityRepo.findOne({
        where: { campaignId, creatorId: member.creatorId },
      });
      const submission = opportunity
        ? await this.submissionRepo.findOne({
            where: { opportunityId: opportunity.id, campaignId, publishedAt: Not(IsNull()) },
          })
        : null;

      if (!submission) {
        // A creator with status pending_delivery always carries null
        // figures, never 0 (US-21b scenario 2).
        creators.push({
          creator_id: member.creatorId,
          display_name: creator?.displayName ?? null,
          status: 'pending_delivery',
          reach: null,
          engagement: null,
          impressions: null,
          ingestion_status: null,
          last_successful_pull_at: null,
        });
        continue;
      }

      const snapshot = await this.snapshotRepo.findOne({
        where: { contentSubmissionId: submission.id },
      });

      creators.push({
        creator_id: member.creatorId,
        display_name: creator?.displayName ?? null,
        status: 'delivered',
        reach: snapshot?.reach ?? null,
        engagement: snapshot?.engagement ?? null,
        impressions: snapshot?.impressions ?? null,
        ingestion_status: snapshot?.ingestionStatus ?? null,
        last_successful_pull_at: snapshot?.lastSuccessfulPullAt?.toISOString() ?? null,
      });
    }

    return {
      campaign_id: campaign.id,
      campaign_state: campaign.state,
      pool_size: members.length,
      delivered_count: aggregate?.deliveredCreatorCount ?? 0,
      pending_delivery_count: aggregate?.pendingDeliveryCreatorCount ?? members.length,
      pool_aggregate: {
        total_delivered_reach: Number(aggregate?.totalDeliveredReach ?? 0),
        total_delivered_engagement: Number(aggregate?.totalDeliveredEngagement ?? 0),
        total_delivered_impressions: Number(aggregate?.totalDeliveredImpressions ?? 0),
        any_stale: aggregate?.anyStale ?? false,
        last_computed_at: aggregate?.lastComputedAt?.toISOString() ?? null,
      },
      creators,
    };
  }
}
