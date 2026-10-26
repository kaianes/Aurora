import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

// US-23.1 / ADR-0054. The literal, immutable record of what Aurora actually
// observed before the creator ever interacted with the platform. Unique on
// creator_id: an unclaimed profile is imported exactly once. Every field is
// nullable except source, imported_by_user_id, and imported_at -- there is
// no non-nullable engagement_rate/authenticity_score column here for a
// service to feel obliged to fill in (US-23.1 scenario 2). Immutable at the
// database level (trigger, section 2.5 of the E8 architecture doc): its
// only lawful subsequent fate is deletion on decline/expiry/claim-cleanup.
@Entity('creator_public_import')
export class CreatorPublicImport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'creator_id', unique: true })
  creatorId: string;

  @Column({ type: 'text' })
  source: string;

  @Column({ type: 'text', nullable: true })
  platform: string | null;

  @Column({ type: 'text', nullable: true, name: 'observed_handle' })
  observedHandle: string | null;

  @Column({ type: 'text', nullable: true, name: 'observed_display_name' })
  observedDisplayName: string | null;

  @Column({ type: 'int', nullable: true, name: 'observed_follower_count' })
  observedFollowerCount: number | null;

  @Column({ type: 'text', nullable: true, name: 'observed_niche' })
  observedNiche: string | null;

  @Column({ type: 'jsonb', nullable: true, name: 'raw_payload' })
  rawPayload: Record<string, any> | null;

  @Column({ type: 'uuid', name: 'imported_by_user_id' })
  importedByUserId: string;

  @Column({ type: 'timestamptz', name: 'imported_at' })
  importedAt: Date;
}
