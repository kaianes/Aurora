import { Process, Processor } from '@nestjs/bull';
import { Inject, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue, Job } from 'bull';
import { Repository } from 'typeorm';
import { ContentSubmission, ExtractionStatus } from '../database/entities';
import {
  MEDIA_EXTRACTION_ADAPTER,
  MediaExtractionAdapter,
} from './adapters/media-extraction.adapter';

// Section 4 of the E4 architecture doc. Runs OCR/ASR behind
// MediaExtractionAdapter; on failure, degrades to fewer channels checked
// rather than blocking the check from running at all.
@Processor('brand-safety')
export class ExtractContentChannelsProcessor {
  private readonly logger = new Logger(ExtractContentChannelsProcessor.name);

  constructor(
    @InjectRepository(ContentSubmission)
    private submissionRepo: Repository<ContentSubmission>,
    @Inject(MEDIA_EXTRACTION_ADAPTER)
    private mediaExtractionAdapter: MediaExtractionAdapter,
    @InjectQueue('brand-safety')
    private brandSafetyQueue: Queue,
  ) {}

  @Process('extract-content-channels')
  async handleExtractContentChannels(
    job: Job<{ contentSubmissionId: string; safetyCheckId: string }>,
  ) {
    const { contentSubmissionId, safetyCheckId } = job.data;
    const submission = await this.submissionRepo.findOne({ where: { id: contentSubmissionId } });
    if (!submission) {
      this.logger.warn(`extract-content-channels: submission not found (${contentSubmissionId})`);
      return;
    }

    if (!submission.mediaAssetUrl) {
      submission.extractionStatus = ExtractionStatus.NOT_REQUIRED;
      await this.submissionRepo.save(submission);
    } else {
      try {
        const result = await this.mediaExtractionAdapter.extract({
          mediaAssetUrl: submission.mediaAssetUrl,
        });
        submission.onScreenText = submission.onScreenText || result.onScreenText;
        submission.audioTranscript = submission.audioTranscript || result.audioTranscript;
        submission.extractionStatus = ExtractionStatus.COMPLETE;
      } catch (error) {
        this.logger.warn(
          `extract-content-channels failed for ${contentSubmissionId}: ${(error as Error).message}`,
        );
        submission.extractionStatus = ExtractionStatus.FAILED;
      }
      await this.submissionRepo.save(submission);
    }

    await this.brandSafetyQueue.add('run-safety-check', { contentSubmissionId, safetyCheckId });
  }
}
