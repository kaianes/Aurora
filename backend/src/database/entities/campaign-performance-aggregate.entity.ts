import { Entity, Column, CreateDateColumn, UpdateDateColumn, PrimaryColumn } from 'typeorm';

// One pre-computed row per campaign (unique on campaign_id), the dashboard's
// (US-21b) direct read, satisfying NFR-02 by construction (section 2.2 of
// the E7 architecture doc). Recomputed inline at the end of every
// discover-and-ingest-metrics run that touches that campaign's creators,
// bounded by the 150-creator pool ceiling (NFR-06) -- cheap enough to run
// inline rather than needing its own queue. Totals are summed only over
// delivered creators' current snapshot values.
@Entity('campaign_performance_aggregate')
export class CampaignPerformanceAggregate {
  @PrimaryColumn({ type: 'uuid', name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'int', default: 0, name: 'delivered_creator_count' })
  deliveredCreatorCount: number;

  @Column({ type: 'int', default: 0, name: 'pending_delivery_creator_count' })
  pendingDeliveryCreatorCount: number;

  @Column({ type: 'bigint', default: 0, name: 'total_delivered_reach' })
  totalDeliveredReach: string;

  @Column({ type: 'bigint', default: 0, name: 'total_delivered_engagement' })
  totalDeliveredEngagement: string;

  @Column({ type: 'bigint', default: 0, name: 'total_delivered_impressions' })
  totalDeliveredImpressions: string;

  @Column({ type: 'boolean', default: false, name: 'any_stale' })
  anyStale: boolean;

  @Column({ type: 'timestamptz', name: 'last_computed_at' })
  lastComputedAt: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
