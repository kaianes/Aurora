import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bull';
import {
  Campaign,
  CampaignState,
  CampaignPoolMember,
  PoolMemberStatus,
  ReallocationBounds,
  CampaignReallocationEvent,
  ReallocationTrigger,
  ReallocationOutcome,
} from '../database/entities';

const MINIMUM_NON_ZERO_FLOOR = 50; // BRL, ADR-0007 absolute floor

export interface PerformanceSample {
  poolMemberId: string;
  score: number; // normalized performance score, higher is better. Missing = no data.
}

@Processor('campaign')
export class ReallocationProcessor {
  private readonly logger = new Logger(ReallocationProcessor.name);

  constructor(
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @InjectRepository(CampaignPoolMember)
    private poolMemberRepo: Repository<CampaignPoolMember>,
    @InjectRepository(ReallocationBounds)
    private boundsRepo: Repository<ReallocationBounds>,
    @InjectRepository(CampaignReallocationEvent)
    private eventRepo: Repository<CampaignReallocationEvent>,
  ) {}

  @Process('reallocate-budget')
  async handleReallocateBudget(
    job: Job<{
      campaignId: string;
      metricsFeedAvailable: boolean;
      performance?: PerformanceSample[];
    }>,
  ) {
    const { campaignId, metricsFeedAvailable, performance = [] } = job.data;

    const campaign = await this.campaignRepo.findOne({ where: { id: campaignId } });
    if (!campaign || campaign.state !== CampaignState.ACTIVE) return;

    const bounds = await this.boundsRepo.findOne({ where: { campaignId } });
    if (!bounds || !bounds.enabled) return;

    if (!metricsFeedAvailable) {
      await this.eventRepo.save(
        this.eventRepo.create({
          campaignId,
          beforeAllocations: {},
          afterAllocations: {},
          trigger: ReallocationTrigger.SCHEDULED,
          outcome: ReallocationOutcome.SKIPPED_STALE_METRICS,
        }),
      );
      this.logger.warn(`Skipped reallocation for ${campaignId}: metrics feed unavailable`);
      return;
    }

    const members = await this.poolMemberRepo.find({ where: { campaignId } });
    const scoreByMember = new Map(performance.map((p) => [p.poolMemberId, p.score]));

    // Not-yet-published creators with no performance data are left untouched,
    // never penalized for lacking data (US-10 scenario 2).
    const eligible = members.filter(
      (m) => m.status !== PoolMemberStatus.EXCLUDED && scoreByMember.has(m.id),
    );

    if (eligible.length < 2) {
      await this.eventRepo.save(
        this.eventRepo.create({
          campaignId,
          beforeAllocations: {},
          afterAllocations: {},
          trigger: ReallocationTrigger.SCHEDULED,
          outcome: ReallocationOutcome.SKIPPED_NO_DATA,
        }),
      );
      return;
    }

    const before: Record<string, string> = {};
    eligible.forEach((m) => (before[m.id] = m.allocatedBudget));

    const maxShiftPct = Number(bounds.maxShiftPct) / 100;
    const minSharePct = Number(bounds.minGuaranteedSharePct) / 100;

    const avgScore =
      eligible.reduce((sum, m) => sum + (scoreByMember.get(m.id) || 0), 0) / eligible.length;

    const updates: { member: CampaignPoolMember; newAllocation: number }[] = [];

    for (const member of eligible) {
      const remaining = parseFloat(member.allocatedBudget) - parseFloat(member.committedBudget);
      if (remaining <= 0) continue;

      const score = scoreByMember.get(member.id) || 0;
      const relativePerformance = avgScore > 0 ? (score - avgScore) / avgScore : 0;
      // Clamp the per-cycle shift to the configured max.
      const shiftFraction = Math.max(-maxShiftPct, Math.min(maxShiftPct, relativePerformance));

      const floor = Math.max(
        parseFloat(member.originalBudget) * minSharePct,
        MINIMUM_NON_ZERO_FLOOR,
      );

      let newRemaining = remaining * (1 + shiftFraction);
      newRemaining = Math.max(newRemaining, floor - parseFloat(member.committedBudget));
      newRemaining = Math.max(newRemaining, MINIMUM_NON_ZERO_FLOOR);

      const newAllocation = parseFloat(member.committedBudget) + newRemaining;
      updates.push({ member, newAllocation });
    }

    const after: Record<string, string> = {};
    for (const { member, newAllocation } of updates) {
      member.allocatedBudget = newAllocation.toFixed(2);
      after[member.id] = member.allocatedBudget;
    }
    await this.poolMemberRepo.save(updates.map((u) => u.member));

    await this.eventRepo.save(
      this.eventRepo.create({
        campaignId,
        beforeAllocations: before,
        afterAllocations: after,
        trigger: ReallocationTrigger.SCHEDULED,
        outcome: ReallocationOutcome.APPLIED,
      }),
    );
  }
}
