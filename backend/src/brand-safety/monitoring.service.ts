import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Campaign,
  ContentSubmission,
  PublishedContentSnapshot,
  MonitoringResult,
} from '../database/entities';

@Injectable()
export class MonitoringService {
  constructor(
    @InjectRepository(PublishedContentSnapshot)
    private snapshotRepo: Repository<PublishedContentSnapshot>,
    @InjectRepository(ContentSubmission)
    private submissionRepo: Repository<ContentSubmission>,
  ) {}

  async list(
    accountId: string,
    campaignId?: string,
    result?: string,
    cursor?: string,
    limit = 20,
  ) {
    const qb = this.snapshotRepo
      .createQueryBuilder('s')
      .innerJoin(ContentSubmission, 'cs', 'cs.id = s.contentSubmissionId')
      .innerJoin(Campaign, 'c', 'c.id = cs.campaignId')
      .where('c.accountId = :accountId', { accountId })
      .orderBy('s.createdAt', 'DESC')
      .limit(Math.min(limit, 100) + 1);

    if (campaignId) {
      qb.andWhere('cs.campaignId = :campaignId', { campaignId });
    }
    if (result) {
      qb.andWhere('s.lastResult = :result', { result });
    }
    if (cursor) {
      qb.andWhere(
        's.createdAt < (SELECT created_at FROM published_content_snapshot WHERE id = :cursor)',
        { cursor },
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const data = await Promise.all(page.map((s) => this.formatSnapshot(s)));

    return {
      data,
      pagination: {
        next_cursor: hasMore ? page[page.length - 1].id : null,
        has_more: hasMore,
      },
    };
  }

  async getDetail(id: string, accountId: string) {
    const snapshot = await this.findSnapshotOrFail(id, accountId);
    const base = await this.formatSnapshot(snapshot);
    return {
      ...base,
      approved_caption_text: snapshot.approvedCaptionText,
      approved_on_screen_text: snapshot.approvedOnScreenText,
      approved_audio_transcript: snapshot.approvedAudioTranscript,
    };
  }

  private async findSnapshotOrFail(id: string, accountId: string): Promise<PublishedContentSnapshot> {
    const snapshot = await this.snapshotRepo
      .createQueryBuilder('s')
      .innerJoin(ContentSubmission, 'cs', 'cs.id = s.contentSubmissionId')
      .innerJoin(Campaign, 'c', 'c.id = cs.campaignId')
      .where('s.id = :id', { id })
      .andWhere('c.accountId = :accountId', { accountId })
      .getOne();
    if (!snapshot) {
      throw new NotFoundException({
        error: { code: 'SNAPSHOT_NOT_FOUND', message: 'Snapshot de monitoramento nao encontrado.', details: {} },
      });
    }
    return snapshot;
  }

  // unreachable and deviated are always distinguishable in the response
  // (US-16b scenario 3) -- a removed post is never reported as matching.
  private async formatSnapshot(s: PublishedContentSnapshot) {
    const submission = await this.submissionRepo.findOne({ where: { id: s.contentSubmissionId } });
    const base: Record<string, any> = {
      id: s.id,
      content_submission_id: s.contentSubmissionId,
      campaign_id: submission?.campaignId || null,
      published_url: s.publishedUrl,
      last_result: s.lastResult,
      last_checked_at: s.lastCheckedAt?.toISOString() || null,
      deviation_details: s.deviationDetails,
    };
    if (s.lastResult === MonitoringResult.UNREACHABLE) {
      base.consecutive_unreachable_count = s.consecutiveUnreachableCount;
    }
    return base;
  }
}
