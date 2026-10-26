import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import {
  CampaignOpportunity,
  CampaignPoolMember,
  ContentSubmission,
  ContentSubmissionMetricSnapshot,
  IngestionStatus,
} from '../database/entities';

export interface ReallocationPerformanceSample {
  poolMemberId: string;
  score: number;
}

export interface ReallocationInputs {
  metricsFeedAvailable: boolean;
  performance: ReallocationPerformanceSample[];
}

// ADR-0047: the exported service that replaces
// CampaignScheduledTasksService.scheduleReallocation's hardcoded
// metricsFeedAvailable: false, performance: [] literals. The only caller in
// the codebase is scheduleReallocation, immediately before it enqueues each
// reallocate-budget job. reallocation.processor.ts is not modified at all --
// the shape it already expects is exactly what this method produces.
@Injectable()
export class PerformanceScoringService {
  constructor(
    @InjectRepository(CampaignPoolMember)
    private poolMemberRepo: Repository<CampaignPoolMember>,
    @InjectRepository(CampaignOpportunity)
    private opportunityRepo: Repository<CampaignOpportunity>,
    @InjectRepository(ContentSubmission)
    private submissionRepo: Repository<ContentSubmission>,
    @InjectRepository(ContentSubmissionMetricSnapshot)
    private snapshotRepo: Repository<ContentSubmissionMetricSnapshot>,
  ) {}

  async getReallocationInputs(campaignId: string): Promise<ReallocationInputs> {
    const members = await this.poolMemberRepo.find({ where: { campaignId } });
    const performance: ReallocationPerformanceSample[] = [];

    for (const member of members) {
      const opportunity = await this.opportunityRepo.findOne({
        where: { campaignId, creatorId: member.creatorId },
      });
      if (!opportunity) continue; // not yet published, left out entirely (US-10 scenario 2).

      const submissions = await this.submissionRepo.find({
        where: { opportunityId: opportunity.id, campaignId, publishedAt: Not(IsNull()) },
      });
      if (submissions.length === 0) continue;

      let score = 0;
      let anyFresh = false;

      // score = each member's creator's current engagement figure, summed
      // across pieces if a creator has more than one published deliverable
      // in the campaign. Relative, pool-internal figure -- never the same
      // calculation as ADR-0046's buyer-facing cost_per_engagement.
      for (const submission of submissions) {
        const snapshot = await this.snapshotRepo.findOne({
          where: { contentSubmissionId: submission.id },
        });
        if (snapshot?.ingestionStatus === IngestionStatus.FRESH) {
          anyFresh = true;
          score += snapshot.engagement ?? 0;
        }
      }

      // Every other member (not yet published, delivered but not yet
      // pulled, or currently stale) is simply absent from the array --
      // reallocation.processor.ts's existing code already treats that as
      // "no data, leave untouched."
      if (anyFresh) {
        performance.push({ poolMemberId: member.id, score });
      }
    }

    // false only when zero pool members have any current, non-stale data
    // at all -- not when some members are stale and others are fresh
    // (ADR-0047).
    return {
      metricsFeedAvailable: performance.length > 0,
      performance,
    };
  }
}
