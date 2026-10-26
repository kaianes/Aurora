import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { CreatorMetricsPipelineService } from './creator-metrics-pipeline.service';

// US-24.2, US-24.3, US-24.4 (section 9 of the E8 architecture doc). Enqueued
// on every successful OAuth callback. Throwing on a transient adapter
// failure lets Bull's own attempts/backoff configuration (set at enqueue
// time) retry the job -- no custom retry loop is implemented here.
@Processor('creator-network')
export class ComputeCreatorMetricsProcessor {
  private readonly logger = new Logger(ComputeCreatorMetricsProcessor.name);

  constructor(private creatorMetricsPipelineService: CreatorMetricsPipelineService) {}

  @Process('compute-creator-metrics')
  async handle(job: Job<{ creatorId: string; socialAccountId: string }>) {
    try {
      await this.creatorMetricsPipelineService.computeAndQualify(
        job.data.creatorId,
        job.data.socialAccountId,
      );
    } catch (error) {
      this.logger.warn(
        `compute-creator-metrics: ${(error as Error).message} (creator ${job.data.creatorId}, attempt ${job.attemptsMade + 1})`,
      );
      throw error;
    }
  }
}
