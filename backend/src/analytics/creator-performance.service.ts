import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Campaign, ContentSubmission, ContentSubmissionMetricSnapshot } from '../database/entities';

// US-37 / FR-54, section 5.4 of the E7 architecture document. Scoped to
// creator_id from the creator's JWT, never from a path/query parameter. A
// declined or still-pending opportunity has no content_submission row with
// published_at set, so it is simply absent from the result -- never a
// fabricated zero-figure entry (US-37 scenario 3).
@Injectable()
export class CreatorPerformanceService {
  constructor(
    @InjectRepository(ContentSubmission)
    private submissionRepo: Repository<ContentSubmission>,
    @InjectRepository(ContentSubmissionMetricSnapshot)
    private snapshotRepo: Repository<ContentSubmissionMetricSnapshot>,
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
  ) {}

  async getOwnPerformance(creatorId: string) {
    const submissions = await this.submissionRepo.find({
      where: { creatorId, publishedAt: Not(IsNull()) },
    });

    const data = [];
    for (const submission of submissions) {
      const campaign = await this.campaignRepo.findOne({ where: { id: submission.campaignId } });
      const snapshot = await this.snapshotRepo.findOne({
        where: { contentSubmissionId: submission.id },
      });

      data.push({
        content_submission_id: submission.id,
        campaign_id: submission.campaignId,
        campaign_name: campaign?.name ?? null,
        published_url: submission.publishedUrl,
        published_at: submission.publishedAt?.toISOString() ?? null,
        reach: snapshot?.reach ?? null,
        engagement: snapshot?.engagement ?? null,
        impressions: snapshot?.impressions ?? null,
        ingestion_status: snapshot?.ingestionStatus ?? null,
        last_successful_pull_at: snapshot?.lastSuccessfulPullAt?.toISOString() ?? null,
      });
    }

    return { data };
  }

  // ADR-0057 (E8, US-25): the only new cross-module read creator-network
  // introduces outside its own tables. Returns exactly the same rows and
  // the same join path getOwnPerformance already computes -- extracted into
  // a reusable, in-process method rather than reimplemented a second time,
  // so the media kit's campaign-history section can never drift from what
  // GET /creator-portal/performance itself shows a creator.
  async getCreatorDeliveredPerformance(creatorId: string): Promise<
    Array<{
      campaignId: string;
      campaignName: string;
      publishedUrl: string | null;
      publishedAt: Date;
      reach: number | null;
      engagement: number | null;
      impressions: number | null;
      ingestionStatus: string | null;
    }>
  > {
    const submissions = await this.submissionRepo.find({
      where: { creatorId, publishedAt: Not(IsNull()) },
    });

    const data = [];
    for (const submission of submissions) {
      const campaign = await this.campaignRepo.findOne({ where: { id: submission.campaignId } });
      const snapshot = await this.snapshotRepo.findOne({
        where: { contentSubmissionId: submission.id },
      });

      data.push({
        campaignId: submission.campaignId,
        campaignName: campaign?.name ?? '',
        publishedUrl: submission.publishedUrl,
        publishedAt: submission.publishedAt as Date,
        reach: snapshot?.reach ?? null,
        engagement: snapshot?.engagement ?? null,
        impressions: snapshot?.impressions ?? null,
        ingestionStatus: snapshot?.ingestionStatus ?? null,
      });
    }

    return data;
  }
}
