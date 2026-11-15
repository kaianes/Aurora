import { MigrationInterface, QueryRunner } from 'typeorm';

// Extends the NULLIF fix from 1744000000000-NullSafeTenantContextCast (which
// only covered account + brand_profile) to every remaining RLS policy in the
// database that casts current_setting(..., true)::uuid. The root cause: after
// a pooled connection has ever referenced a custom GUC, "not set" returns ''
// instead of NULL, and ''::uuid crashes with "invalid input syntax for type
// uuid". NULLIF(..., '') normalises both NULL and '' to NULL before the cast.
//
// String-compared flags (app.creator_portal = 'true', etc.) are unaffected
// because '' != 'true' — only the ::uuid casts need wrapping.
export class NullSafeAllRlsPolicies1745000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Helper shorthand used in every policy below.
    const AID = `NULLIF(current_setting('app.current_account_id', true), '')::uuid`;
    const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
    const WID = `NULLIF(current_setting('app.current_workspace_id', true), '')::uuid`;

    // ================================================================
    // InitialSchema tables (1695) — skip account + brand_profile (fixed in 1744)
    // ================================================================

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "invitation"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "invitation"
        USING ("account_id" = ${AID})
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "membership"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "membership"
        USING ("account_id" = ${AID})
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "operator_client_access"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "operator_client_access"
        USING ("account_id" = ${AID})
    `);

    // ================================================================
    // Self-lookup policies (1740, 1741)
    // ================================================================

    await queryRunner.query(`DROP POLICY IF EXISTS membership_self_lookup ON "membership"`);
    await queryRunner.query(`
      CREATE POLICY membership_self_lookup ON "membership"
        FOR SELECT
        USING ("user_id" = ${UID})
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS account_self_lookup ON "account"`);
    await queryRunner.query(`
      CREATE POLICY account_self_lookup ON "account"
        FOR SELECT
        USING (
          EXISTS (
            SELECT 1 FROM "membership" m
            WHERE m."account_id" = "account"."id"
              AND m."user_id" = ${UID}
          )
        )
    `);

    // ================================================================
    // CampaignSchema (1700)
    // ================================================================

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "campaign"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "campaign"
        USING ("account_id" = ${AID})
    `);

    const campaignJoinTables = [
      'campaign_quote',
      'campaign_pool_member',
      'campaign_reallocation_event',
      'campaign_state_transition',
      'reallocation_bounds',
      'pool_shortfall_resolution',
    ];
    for (const table of campaignJoinTables) {
      await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
      await queryRunner.query(`
        CREATE POLICY tenant_isolation ON "${table}"
          USING (
            "campaign_id" IN (
              SELECT "id" FROM "campaign"
              WHERE "account_id" = ${AID}
            )
          )
      `);
    }

    // ================================================================
    // MatchingSchema (1705)
    // ================================================================

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "creator_exclusion"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "creator_exclusion"
        USING ("account_id" = ${AID})
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "campaign_shortlist"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "campaign_shortlist"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID}
          )
        )
    `);

    const matchingCreatorPortalTables = ['campaign_shortlist_entry', 'additional_candidates_request'];
    for (const table of matchingCreatorPortalTables) {
      await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
      await queryRunner.query(`
        CREATE POLICY tenant_isolation ON "${table}"
          USING (
            "campaign_id" IN (
              SELECT "id" FROM "campaign"
              WHERE "account_id" = ${AID}
            )
            OR current_setting('app.creator_portal', true) = 'true'
          )
      `);
    }

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "campaign_opportunity"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "campaign_opportunity"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID}
          )
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);

    // ================================================================
    // BrandSafetySchema (1710) — policies NOT overridden by 1742
    // ================================================================

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "safety_ruleset"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "safety_ruleset"
        USING ("account_id" = ${AID})
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "safety_rule"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "safety_rule"
        USING (
          "ruleset_id" IN (
            SELECT "id" FROM "safety_ruleset"
            WHERE "account_id" = ${AID}
          )
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "content_submission"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "content_submission"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID}
          )
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);

    // ================================================================
    // BrandSafetySystemJobEscapeHatch (1742) — overrides from 1710
    // ================================================================

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "safety_check"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "safety_check"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID}
          )
          OR current_setting('app.creator_portal', true) = 'true'
          OR current_setting('app.aurora_system_job', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "safety_rule_trigger"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "safety_rule_trigger"
        USING (
          "safety_check_id" IN (
            SELECT "id" FROM "safety_check"
            WHERE "campaign_id" IN (
              SELECT "id" FROM "campaign"
              WHERE "account_id" = ${AID}
            )
          )
          OR current_setting('app.creator_portal', true) = 'true'
          OR current_setting('app.aurora_system_job', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "safety_review_queue_item"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "safety_review_queue_item"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID}
          )
          OR current_setting('app.aurora_system_job', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "published_content_snapshot"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "published_content_snapshot"
        USING (
          "content_submission_id" IN (
            SELECT "id" FROM "content_submission"
            WHERE "campaign_id" IN (
              SELECT "id" FROM "campaign"
              WHERE "account_id" = ${AID}
            )
          )
          OR current_setting('app.aurora_system_job', true) = 'true'
        )
    `);

    // ================================================================
    // ContentWorkflowSchema (1715)
    // ================================================================

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "briefing"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "briefing"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID}
          )
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "briefing_distribution_recipient"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "briefing_distribution_recipient"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID}
          )
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "briefing_qa_thread"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "briefing_qa_thread"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID}
          )
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "briefing_qa_message"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "briefing_qa_message"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID}
          )
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "content_review_decision"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "content_review_decision"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID}
          )
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);

    // ================================================================
    // PaymentsSchema (1720)
    // ================================================================

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "payout_obligation"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "payout_obligation"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID}
          )
          OR current_setting('app.creator_portal', true) = 'true'
          OR current_setting('app.aurora_operator', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "payout_execution_attempt"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "payout_execution_attempt"
        USING (
          "payout_obligation_id" IN (
            SELECT "id" FROM "payout_obligation"
            WHERE "campaign_id" IN (
              SELECT "id" FROM "campaign"
              WHERE "account_id" = ${AID}
            )
          )
          OR current_setting('app.aurora_operator', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "ledger_entry"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "ledger_entry"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID}
          )
          OR current_setting('app.aurora_operator', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "tax_document"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "tax_document"
        USING (
          "payout_obligation_id" IN (
            SELECT "id" FROM "payout_obligation"
            WHERE "campaign_id" IN (
              SELECT "id" FROM "campaign"
              WHERE "account_id" = ${AID}
            )
          )
          OR current_setting('app.creator_portal', true) = 'true'
          OR current_setting('app.aurora_operator', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "invoice"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "invoice"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID}
          )
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "invoice_line_item"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "invoice_line_item"
        USING (
          "invoice_id" IN (
            SELECT "id" FROM "invoice"
            WHERE "campaign_id" IN (
              SELECT "id" FROM "campaign"
              WHERE "account_id" = ${AID}
            )
          )
        )
    `);

    // ================================================================
    // AnalyticsSchema (1725)
    // ================================================================

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "content_submission_metric_snapshot"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "content_submission_metric_snapshot"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID}
          )
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "performance_metric_ingestion_attempt"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "performance_metric_ingestion_attempt"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID}
          )
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "campaign_performance_aggregate"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "campaign_performance_aggregate"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID}
          )
          OR (
            current_setting('app.agency_cross_client_read', true) = 'true'
            AND "campaign_id" IN (
              SELECT c."id" FROM "campaign" c
              JOIN "account" a ON a."id" = c."account_id"
              WHERE a."workspace_id" = ${WID}
            )
          )
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "campaign_performance_report"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "campaign_performance_report"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID}
          )
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "client_performance_report"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "client_performance_report"
        USING ("account_id" = ${AID})
    `);

    // ================================================================
    // AgencyMultiClientSchema (1735)
    // ================================================================

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "campaign_template"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "campaign_template"
        USING (
          "account_id" = ${AID}
          OR (
            current_setting('app.agency_template_copy', true) = 'true'
            AND "account_id" IN (
              SELECT "id" FROM "account"
              WHERE "workspace_id" = ${WID}
            )
          )
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "client_report_share_link"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "client_report_share_link"
        USING (
          "account_id" = ${AID}
          OR current_setting('app.public_share_link_read', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS audit_log_read ON "audit_log"`);
    await queryRunner.query(`
      CREATE POLICY audit_log_read ON "audit_log"
        FOR SELECT USING ("target_account_id" = ${AID})
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore the pre-NULLIF versions (latest from each preceding migration).
    const AID_UNSAFE = `current_setting('app.current_account_id', true)::uuid`;
    const UID_UNSAFE = `current_setting('app.current_user_id', true)::uuid`;
    const WID_UNSAFE = `current_setting('app.current_workspace_id', true)::uuid`;

    // audit_log
    await queryRunner.query(`DROP POLICY IF EXISTS audit_log_read ON "audit_log"`);
    await queryRunner.query(`
      CREATE POLICY audit_log_read ON "audit_log"
        FOR SELECT USING ("target_account_id" = ${AID_UNSAFE})
    `);

    // client_report_share_link
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "client_report_share_link"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "client_report_share_link"
        USING (
          "account_id" = ${AID_UNSAFE}
          OR current_setting('app.public_share_link_read', true) = 'true'
        )
    `);

    // campaign_template (AgencyMultiClient version)
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "campaign_template"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "campaign_template"
        USING (
          "account_id" = ${AID_UNSAFE}
          OR (
            current_setting('app.agency_template_copy', true) = 'true'
            AND "account_id" IN (
              SELECT "id" FROM "account"
              WHERE "workspace_id" = ${WID_UNSAFE}
            )
          )
        )
    `);

    // Analytics
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "client_performance_report"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "client_performance_report"
        USING ("account_id" = ${AID_UNSAFE})
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "campaign_performance_report"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "campaign_performance_report"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID_UNSAFE}
          )
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "campaign_performance_aggregate"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "campaign_performance_aggregate"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID_UNSAFE}
          )
          OR (
            current_setting('app.agency_cross_client_read', true) = 'true'
            AND "campaign_id" IN (
              SELECT c."id" FROM "campaign" c
              JOIN "account" a ON a."id" = c."account_id"
              WHERE a."workspace_id" = ${WID_UNSAFE}
            )
          )
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "performance_metric_ingestion_attempt"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "performance_metric_ingestion_attempt"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID_UNSAFE}
          )
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "content_submission_metric_snapshot"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "content_submission_metric_snapshot"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID_UNSAFE}
          )
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);

    // Payments
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "invoice_line_item"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "invoice_line_item"
        USING (
          "invoice_id" IN (
            SELECT "id" FROM "invoice"
            WHERE "campaign_id" IN (
              SELECT "id" FROM "campaign"
              WHERE "account_id" = ${AID_UNSAFE}
            )
          )
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "invoice"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "invoice"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID_UNSAFE}
          )
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "tax_document"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "tax_document"
        USING (
          "payout_obligation_id" IN (
            SELECT "id" FROM "payout_obligation"
            WHERE "campaign_id" IN (
              SELECT "id" FROM "campaign"
              WHERE "account_id" = ${AID_UNSAFE}
            )
          )
          OR current_setting('app.creator_portal', true) = 'true'
          OR current_setting('app.aurora_operator', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "ledger_entry"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "ledger_entry"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID_UNSAFE}
          )
          OR current_setting('app.aurora_operator', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "payout_execution_attempt"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "payout_execution_attempt"
        USING (
          "payout_obligation_id" IN (
            SELECT "id" FROM "payout_obligation"
            WHERE "campaign_id" IN (
              SELECT "id" FROM "campaign"
              WHERE "account_id" = ${AID_UNSAFE}
            )
          )
          OR current_setting('app.aurora_operator', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "payout_obligation"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "payout_obligation"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID_UNSAFE}
          )
          OR current_setting('app.creator_portal', true) = 'true'
          OR current_setting('app.aurora_operator', true) = 'true'
        )
    `);

    // ContentWorkflow
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "content_review_decision"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "content_review_decision"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID_UNSAFE}
          )
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "briefing_qa_message"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "briefing_qa_message"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID_UNSAFE}
          )
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "briefing_qa_thread"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "briefing_qa_thread"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID_UNSAFE}
          )
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "briefing_distribution_recipient"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "briefing_distribution_recipient"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID_UNSAFE}
          )
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "briefing"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "briefing"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID_UNSAFE}
          )
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);

    // BrandSafety (1742 versions for overridden, 1710 for others)
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "published_content_snapshot"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "published_content_snapshot"
        USING (
          "content_submission_id" IN (
            SELECT "id" FROM "content_submission"
            WHERE "campaign_id" IN (
              SELECT "id" FROM "campaign"
              WHERE "account_id" = ${AID_UNSAFE}
            )
          )
          OR current_setting('app.aurora_system_job', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "safety_review_queue_item"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "safety_review_queue_item"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID_UNSAFE}
          )
          OR current_setting('app.aurora_system_job', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "safety_rule_trigger"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "safety_rule_trigger"
        USING (
          "safety_check_id" IN (
            SELECT "id" FROM "safety_check"
            WHERE "campaign_id" IN (
              SELECT "id" FROM "campaign"
              WHERE "account_id" = ${AID_UNSAFE}
            )
          )
          OR current_setting('app.creator_portal', true) = 'true'
          OR current_setting('app.aurora_system_job', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "safety_check"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "safety_check"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID_UNSAFE}
          )
          OR current_setting('app.creator_portal', true) = 'true'
          OR current_setting('app.aurora_system_job', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "content_submission"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "content_submission"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID_UNSAFE}
          )
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "safety_rule"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "safety_rule"
        USING (
          "ruleset_id" IN (
            SELECT "id" FROM "safety_ruleset"
            WHERE "account_id" = ${AID_UNSAFE}
          )
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "safety_ruleset"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "safety_ruleset"
        USING ("account_id" = ${AID_UNSAFE})
    `);

    // Matching
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "campaign_opportunity"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "campaign_opportunity"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID_UNSAFE}
          )
          OR current_setting('app.creator_portal', true) = 'true'
        )
    `);

    const matchingCreatorPortalTables = ['additional_candidates_request', 'campaign_shortlist_entry'];
    for (const table of matchingCreatorPortalTables) {
      await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
      await queryRunner.query(`
        CREATE POLICY tenant_isolation ON "${table}"
          USING (
            "campaign_id" IN (
              SELECT "id" FROM "campaign"
              WHERE "account_id" = ${AID_UNSAFE}
            )
            OR current_setting('app.creator_portal', true) = 'true'
          )
      `);
    }

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "campaign_shortlist"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "campaign_shortlist"
        USING (
          "campaign_id" IN (
            SELECT "id" FROM "campaign"
            WHERE "account_id" = ${AID_UNSAFE}
          )
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "creator_exclusion"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "creator_exclusion"
        USING ("account_id" = ${AID_UNSAFE})
    `);

    // Campaign
    const campaignJoinTables = [
      'pool_shortfall_resolution',
      'reallocation_bounds',
      'campaign_state_transition',
      'campaign_reallocation_event',
      'campaign_pool_member',
      'campaign_quote',
    ];
    for (const table of campaignJoinTables) {
      await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
      await queryRunner.query(`
        CREATE POLICY tenant_isolation ON "${table}"
          USING (
            "campaign_id" IN (
              SELECT "id" FROM "campaign"
              WHERE "account_id" = ${AID_UNSAFE}
            )
          )
      `);
    }

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "campaign"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "campaign"
        USING ("account_id" = ${AID_UNSAFE})
    `);

    // Self-lookup policies
    await queryRunner.query(`DROP POLICY IF EXISTS account_self_lookup ON "account"`);
    await queryRunner.query(`
      CREATE POLICY account_self_lookup ON "account"
        FOR SELECT
        USING (
          EXISTS (
            SELECT 1 FROM "membership" m
            WHERE m."account_id" = "account"."id"
              AND m."user_id" = ${UID_UNSAFE}
          )
        )
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS membership_self_lookup ON "membership"`);
    await queryRunner.query(`
      CREATE POLICY membership_self_lookup ON "membership"
        FOR SELECT
        USING ("user_id" = ${UID_UNSAFE})
    `);

    // InitialSchema
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "operator_client_access"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "operator_client_access"
        USING ("account_id" = ${AID_UNSAFE})
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "membership"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "membership"
        USING ("account_id" = ${AID_UNSAFE})
    `);

    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "invitation"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "invitation"
        USING ("account_id" = ${AID_UNSAFE})
    `);
  }
}
