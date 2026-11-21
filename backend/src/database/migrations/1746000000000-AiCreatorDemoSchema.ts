import { MigrationInterface, QueryRunner } from 'typeorm';

// E10: purely additive changes -- nullable columns on existing tables and one
// new enum value. No existing column is modified; no existing row needs a
// backfill. See section 3 of the E10 architecture doc.
//
// Three changes:
// 1. campaign_shortlist_entry: fit_reason TEXT NULL,
//    fit_reason_unavailable BOOLEAN NOT NULL DEFAULT false
// 2. safety_review_queue_item: ai_safety_reason TEXT NULL
// 3. briefing_qa_message: extend sender_type CHECK constraint to allow 'system',
//    extend chk_message_sender to allow system messages with no user and no creator
export class AiCreatorDemoSchema1746000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 3.2: fit reason columns on campaign_shortlist_entry
    await queryRunner.query(`
      ALTER TABLE "campaign_shortlist_entry"
        ADD COLUMN "fit_reason" TEXT NULL,
        ADD COLUMN "fit_reason_unavailable" BOOLEAN NOT NULL DEFAULT false
    `);

    // 3.3: ai_safety_reason on safety_review_queue_item
    await queryRunner.query(`
      ALTER TABLE "safety_review_queue_item"
        ADD COLUMN "ai_safety_reason" TEXT NULL
    `);

    // 3.4: extend briefing_qa_message.sender_type to include 'system'.
    // Drop the old CHECK constraint and chk_message_sender, then re-add both
    // with the extended values.
    await queryRunner.query(`
      ALTER TABLE "briefing_qa_message"
        DROP CONSTRAINT IF EXISTS "briefing_qa_message_sender_type_check"
    `);
    await queryRunner.query(`
      ALTER TABLE "briefing_qa_message"
        ADD CONSTRAINT "briefing_qa_message_sender_type_check"
        CHECK ("sender_type" IN ('creator', 'brand', 'system'))
    `);

    // The existing chk_message_sender constraint only allows creator or brand
    // sender shapes. Add 'system' as the third valid shape (null for both
    // sender_user_id and sender_creator_id).
    await queryRunner.query(`
      ALTER TABLE "briefing_qa_message"
        DROP CONSTRAINT IF EXISTS "chk_message_sender"
    `);
    await queryRunner.query(`
      ALTER TABLE "briefing_qa_message"
        ADD CONSTRAINT "chk_message_sender" CHECK (
          ("sender_type" = 'creator' AND "sender_creator_id" IS NOT NULL AND "sender_user_id" IS NULL)
          OR ("sender_type" = 'brand' AND "sender_user_id" IS NOT NULL AND "sender_creator_id" IS NULL)
          OR ("sender_type" = 'system' AND "sender_user_id" IS NULL AND "sender_creator_id" IS NULL)
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse 3.4: restore original sender_type constraint and chk_message_sender
    await queryRunner.query(`
      ALTER TABLE "briefing_qa_message"
        DROP CONSTRAINT IF EXISTS "chk_message_sender"
    `);
    await queryRunner.query(`
      ALTER TABLE "briefing_qa_message"
        ADD CONSTRAINT "chk_message_sender" CHECK (
          ("sender_type" = 'creator' AND "sender_creator_id" IS NOT NULL AND "sender_user_id" IS NULL)
          OR ("sender_type" = 'brand' AND "sender_user_id" IS NOT NULL AND "sender_creator_id" IS NULL)
        )
    `);
    await queryRunner.query(`
      ALTER TABLE "briefing_qa_message"
        DROP CONSTRAINT IF EXISTS "briefing_qa_message_sender_type_check"
    `);
    await queryRunner.query(`
      ALTER TABLE "briefing_qa_message"
        ADD CONSTRAINT "briefing_qa_message_sender_type_check"
        CHECK ("sender_type" IN ('creator', 'brand'))
    `);

    // Reverse 3.3
    await queryRunner.query(`
      ALTER TABLE "safety_review_queue_item"
        DROP COLUMN IF EXISTS "ai_safety_reason"
    `);

    // Reverse 3.2
    await queryRunner.query(`
      ALTER TABLE "campaign_shortlist_entry"
        DROP COLUMN IF EXISTS "fit_reason_unavailable",
        DROP COLUMN IF EXISTS "fit_reason"
    `);
  }
}
