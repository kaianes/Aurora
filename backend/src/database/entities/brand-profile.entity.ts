import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Account } from './account.entity';

export enum BrandProfileStatus {
  DRAFT = 'draft',
  COMPLETE = 'complete',
}

@Entity('brand_profile')
export class BrandProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true, name: 'account_id' })
  accountId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true, name: 'logo_url' })
  logoUrl: string | null;

  @Column({ type: 'text', nullable: true, name: 'tone_of_voice' })
  toneOfVoice: string | null;

  @Column({ type: 'text', nullable: true, name: 'content_guidelines' })
  contentGuidelines: string | null;

  @Column({ type: 'jsonb', nullable: true, name: 'prohibited_topics' })
  prohibitedTopics: string[] | null;

  @Column({ type: 'text', default: BrandProfileStatus.DRAFT })
  status: BrandProfileStatus;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @OneToOne(() => Account, (account) => account.brandProfile)
  @JoinColumn({ name: 'account_id' })
  account: Account;

  computeStatus(): BrandProfileStatus {
    const allFilled =
      this.name &&
      this.logoUrl &&
      this.toneOfVoice &&
      this.contentGuidelines &&
      this.prohibitedTopics &&
      this.prohibitedTopics.length > 0;
    return allFilled ? BrandProfileStatus.COMPLETE : BrandProfileStatus.DRAFT;
  }
}
