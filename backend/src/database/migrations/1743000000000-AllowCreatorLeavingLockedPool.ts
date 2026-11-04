import { MigrationInterface, QueryRunner } from 'typeorm';

// FR (advisor feedback, Sprint 5): a creator cannot decline a campaign
// opportunity today. Root cause is shortlist_entry_lock_guard
// (MatchingSchema migration, section 2.5 of the E3 architecture doc):
// once the parent campaign_shortlist is locked, the trigger rejects every
// UPDATE on campaign_shortlist_entry unconditionally. By the time a
// campaign_opportunity exists at all, its shortlist is always already
// locked (agency override or campaign activation) -- so OpportunityService
// .decline()'s `included: false` write has never once succeeded, and
// neither has MatchingScheduledTasksService.expireOpportunities()'s
// identical write for an unanswered, auto-expired opportunity (ADR-0012:
// expiry leaves the pool the same way a decline does).
//
// The lock's actual purpose is to stop the *brand or agency* from further
// editing shortlist composition after it's final -- not to prevent a
// creator's own accept/decline choice (or its auto-expiry equivalent) from
// being recorded. Rather than loosen the lock generally, this allows
// exactly one shape of post-lock mutation: included flips true -> false
// with every other column held constant (updated_at excepted, since it's
// expected to move on any write). Any other post-lock edit -- changing
// rank, fit_score, origin, decision, re-including a previously-excluded
// entry -- still hits the exception exactly as before.
export class AllowCreatorLeavingLockedPool1743000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_locked_shortlist_entry_mutation()
      RETURNS trigger AS $$
      DECLARE
        is_locked boolean;
      BEGIN
        SELECT locked INTO is_locked FROM campaign_shortlist WHERE id = OLD.shortlist_id;
        IF is_locked THEN
          IF NEW.included = false AND OLD.included = true
             AND NEW.shortlist_id IS NOT DISTINCT FROM OLD.shortlist_id
             AND NEW.campaign_id IS NOT DISTINCT FROM OLD.campaign_id
             AND NEW.creator_id IS NOT DISTINCT FROM OLD.creator_id
             AND NEW.rank IS NOT DISTINCT FROM OLD.rank
             AND NEW.fit_score IS NOT DISTINCT FROM OLD.fit_score
             AND NEW.matched_attributes IS NOT DISTINCT FROM OLD.matched_attributes
             AND NEW.origin IS NOT DISTINCT FROM OLD.origin
             AND NEW.decision IS NOT DISTINCT FROM OLD.decision
             AND NEW.decision_by_user_id IS NOT DISTINCT FROM OLD.decision_by_user_id
             AND NEW.decision_at IS NOT DISTINCT FROM OLD.decision_at
             AND NEW.added_by_user_id IS NOT DISTINCT FROM OLD.added_by_user_id
             AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
          THEN
            RETURN NEW;
          END IF;
          RAISE EXCEPTION 'shortlist entry % belongs to a locked shortlist: no further changes permitted', OLD.id;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_locked_shortlist_entry_mutation()
      RETURNS trigger AS $$
      DECLARE
        is_locked boolean;
      BEGIN
        SELECT locked INTO is_locked FROM campaign_shortlist WHERE id = OLD.shortlist_id;
        IF is_locked THEN
          RAISE EXCEPTION 'shortlist entry % belongs to a locked shortlist: no further changes permitted', OLD.id;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
  }
}
