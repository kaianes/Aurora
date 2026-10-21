import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Repository } from 'typeorm';
import { CreatorMediaKitExport, MediaKitExportStatus } from '../database/entities';

const NO_CAMPAIGN_HISTORY_MESSAGE =
  'Esta secao sera preenchida apos sua primeira entrega de campanha.';
const FAILURE_MESSAGE = 'Nao foi possivel gerar seu media kit. Tente novamente.';

// US-25 / ADR-0057 (section 6 of the E8 architecture doc). Request-response
// pattern mirroring E2's campaign_quote, E3's campaign_shortlist, and E7's
// campaign_performance_report: a 202 create, a poll read. The actual
// rendering is done by GenerateMediaKitProcessor, asynchronously.
@Injectable()
export class MediaKitService {
  constructor(
    @InjectRepository(CreatorMediaKitExport)
    private exportRepo: Repository<CreatorMediaKitExport>,
    @InjectQueue('creator-network') private creatorNetworkQueue: Queue,
  ) {}

  async requestExport(creatorId: string) {
    const exportRow = this.exportRepo.create({
      creatorId,
      status: MediaKitExportStatus.PENDING,
      requestedAt: new Date(),
    });
    await this.exportRepo.save(exportRow);

    await this.creatorNetworkQueue.add('generate-media-kit', { exportId: exportRow.id });

    return {
      export_id: exportRow.id,
      status: exportRow.status,
      poll_url: `/v1/creator-portal/media-kit/${exportRow.id}`,
    };
  }

  async getExport(creatorId: string, exportId: string) {
    const exportRow = await this.exportRepo.findOne({ where: { id: exportId, creatorId } });
    if (!exportRow) {
      throw new NotFoundException({
        error: { code: 'MEDIA_KIT_EXPORT_NOT_FOUND', message: 'Media kit nao encontrado.', details: {} },
      });
    }

    const base: Record<string, any> = { id: exportRow.id, status: exportRow.status };

    if (exportRow.status === MediaKitExportStatus.READY) {
      base.has_campaign_history = exportRow.hasCampaignHistory;
      base.pdf_document_url = exportRow.pdfDocumentUrl;
      // US-25 scenario 2: never a fabricated campaign-performance section.
      if (exportRow.hasCampaignHistory === false) {
        base.campaign_section_message = NO_CAMPAIGN_HISTORY_MESSAGE;
      }
    } else if (exportRow.status === MediaKitExportStatus.FAILED) {
      base.failure_reason = exportRow.failureReason;
      base.message = FAILURE_MESSAGE;
    }

    return base;
  }
}
