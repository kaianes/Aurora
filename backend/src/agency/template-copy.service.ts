import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CampaignTemplate } from '../database/entities';

// US-41 / FR-22, ADR-0060. The one place this epic crosses
// campaign_template's RLS tenant boundary deliberately: both the
// onboarding-time bulk copy (AgencyService.createClient, section 4.1 of the
// E9 architecture doc) and the ongoing, single-template copy
// (TemplateService's POST /campaign-templates/:id/copy, section 4.2) go
// through this one class so the escape-hatch mechanics (the SET LOCAL
// pair, the dedicated transaction, the brand_profile_snapshot = null rule)
// are written once rather than duplicated per call site.
//
// All authorization -- that the source and target accounts both belong to
// the caller's own workspace, and, for an agency_operator, that they hold
// operator_client_access for the target -- happens in the caller, before
// either method here is ever invoked. This class performs only the
// already-authorized write, exactly the discipline ADR-0060 requires: "the
// service layer validates... after the service layer has already
// independently validated the operation."
@Injectable()
export class TemplateCopyService {
  constructor(private dataSource: DataSource) {}

  // Section 4.1: reads every campaign_template row under sourceAccountId
  // and inserts a structure-only copy of each under targetAccountId.
  // Returns the count copied (POST /agency/clients's templates_copied
  // field, previously always 0).
  async copyAllTemplates(
    sourceAccountId: string,
    targetAccountId: string,
    workspaceId: string,
  ): Promise<number> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await queryRunner.query(`SET LOCAL app.agency_template_copy = 'true'`);
      await queryRunner.query(`SET LOCAL app.current_workspace_id = $1`, [workspaceId]);

      const sourceTemplates = await queryRunner.manager.find(CampaignTemplate, {
        where: { accountId: sourceAccountId },
      });

      for (const source of sourceTemplates) {
        await queryRunner.manager.save(
          queryRunner.manager.create(
            CampaignTemplate,
            this.copyFields(source, targetAccountId),
          ),
        );
      }

      await queryRunner.commitTransaction();
      return sourceTemplates.length;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // Section 4.2: copies exactly one, already-loaded source template under
  // targetAccountId. The caller has already loaded sourceTemplate under its
  // own (source) account context and independently validated the target.
  async copyOne(
    sourceTemplate: CampaignTemplate,
    targetAccountId: string,
    workspaceId: string,
  ): Promise<CampaignTemplate> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await queryRunner.query(`SET LOCAL app.agency_template_copy = 'true'`);
      await queryRunner.query(`SET LOCAL app.current_workspace_id = $1`, [workspaceId]);

      const saved = await queryRunner.manager.save(
        queryRunner.manager.create(
          CampaignTemplate,
          this.copyFields(sourceTemplate, targetAccountId),
        ),
      );

      await queryRunner.commitTransaction();
      return saved;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // The structure-only copy (section 2.2/4 of the architecture doc).
  // brand_profile_snapshot is always null on a cross-client copy (ADR-0060),
  // regardless of what the source template carried -- the source client's
  // snapshot describes the source client's brand profile, never the
  // target's.
  private copyFields(source: CampaignTemplate, targetAccountId: string) {
    return {
      accountId: targetAccountId,
      sourceCampaignId: null,
      copiedFromTemplateId: source.id,
      name: source.name,
      audienceTargeting: source.audienceTargeting,
      message: source.message,
      deliverableFormats: source.deliverableFormats,
      timelineShape: source.timelineShape,
      brandProfileSnapshot: null,
    };
  }
}
