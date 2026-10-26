import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MetricsIngestionService } from './metrics-ingestion.service';
import { DISCOVER_AND_INGEST_METRICS_CRON } from './analytics.config';

// Section 5 of the E7 architecture document: the one cron-triggered job
// this epic defines for ingestion. generate-campaign-report and
// generate-client-report are queue-triggered on request, living in their
// own processor classes.
@Injectable()
export class AnalyticsScheduledTasksService {
  constructor(private metricsIngestionService: MetricsIngestionService) {}

  @Cron(DISCOVER_AND_INGEST_METRICS_CRON)
  async discoverAndIngestMetrics() {
    await this.metricsIngestionService.runDiscoveryAndIngestion();
  }
}
