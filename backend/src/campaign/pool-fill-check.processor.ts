import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Job } from 'bull';
import { Campaign, CampaignPoolMember, PoolMemberStatus } from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { CampaignService } from './campaign.service';

@Processor('campaign')
export class PoolFillCheckProcessor {
  private readonly logger = new Logger(PoolFillCheckProcessor.name);

  constructor(
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @InjectRepository(CampaignPoolMember)
    private poolMemberRepo: Repository<CampaignPoolMember>,
    private campaignService: CampaignService,
    private auditService: AuditService,
  ) {}

  // Compares the actual matched pool size against guaranteed_min_pool_size
  // shortly before timeline_start (US-07 scenario 3, ADR-0008).
  @Process('pool-fill-check')
  async handlePoolFillCheck(job: Job<{ campaignId: string }>) {
    const { campaignId } = job.data;
    const campaign = await this.campaignRepo.findOne({ where: { id: campaignId } });
    if (!campaign || !campaign.guaranteedMinPoolSize || !campaign.lockedPrice) {
      return;
    }

    const actualPoolSize = await this.poolMemberRepo.count({
      where: { campaignId, status: Not(PoolMemberStatus.EXCLUDED) },
    });

    if (actualPoolSize >= campaign.guaranteedMinPoolSize) {
      return; // Guarantee met, no-op.
    }

    const resolution = await this.campaignService.recordShortfall(
      campaignId,
      campaign.guaranteedMinPoolSize,
      actualPoolSize,
      campaign.lockedPrice,
    );

    if (resolution) {
      await this.auditService.log({
        actorUserId: null,
        targetAccountId: campaign.accountId,
        action: 'campaign.shortfall_detected',
        metadata: {
          campaign_id: campaignId,
          guaranteed_min_pool_size: campaign.guaranteedMinPoolSize,
          actual_pool_size: actualPoolSize,
        },
      });
      this.logger.log(`Shortfall recorded for campaign ${campaignId}`);
    }
  }
}
