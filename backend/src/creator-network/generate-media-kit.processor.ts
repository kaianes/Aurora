import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bull';
import { CreatorMediaKitExport, MediaKitExportStatus } from '../database/entities';
import { CreatorPerformanceService } from '../analytics/creator-performance.service';
import { buildMediaKitDocumentUrl } from './media-kit-document-url';

// US-25 / ADR-0057 (section 6.1 of the E8 architecture doc). Reads
// creator's own audience-metrics columns directly (owned by this epic) and
// calls AnalyticsModule's exported getCreatorDeliveredPerformance for her
// real, delivered campaign history -- never recomputing or duplicating
// what E7 already owns.
@Processor('creator-network')
export class GenerateMediaKitProcessor {
  private readonly logger = new Logger(GenerateMediaKitProcessor.name);

  constructor(
    @InjectRepository(CreatorMediaKitExport)
    private exportRepo: Repository<CreatorMediaKitExport>,
    private creatorPerformanceService: CreatorPerformanceService,
  ) {}

  @Process('generate-media-kit')
  async handle(job: Job<{ exportId: string }>) {
    const exportRow = await this.exportRepo.findOne({ where: { id: job.data.exportId } });
    if (!exportRow) return;

    try {
      const performance = await this.creatorPerformanceService.getCreatorDeliveredPerformance(
        exportRow.creatorId,
      );

      exportRow.hasCampaignHistory = performance.length > 0;
      exportRow.status = MediaKitExportStatus.READY;
      exportRow.pdfDocumentUrl = buildMediaKitDocumentUrl(exportRow.id);
      exportRow.resolvedAt = new Date();
      await this.exportRepo.save(exportRow);
    } catch (error) {
      this.logger.warn(
        `generate-media-kit failed for export ${exportRow.id}: ${(error as Error).message}`,
      );
      exportRow.status = MediaKitExportStatus.FAILED;
      exportRow.failureReason = 'render_error';
      exportRow.resolvedAt = new Date();
      await this.exportRepo.save(exportRow);
    }
  }
}
