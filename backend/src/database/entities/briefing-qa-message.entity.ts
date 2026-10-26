import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { BriefingQaThread } from './briefing-qa-thread.entity';
import { Campaign } from './campaign.entity';

export enum QaSenderType {
  CREATOR = 'creator',
  BRAND = 'brand',
}

// A message within a private briefing Q&A thread (ADR-0028). No "answered"
// flag is stored: whether a thread is unanswered is computed at read time
// from whether its last message has sender_type = creator.
@Entity('briefing_qa_message')
export class BriefingQaMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'thread_id' })
  threadId: string;

  @Column({ type: 'uuid', name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'text', enum: QaSenderType, name: 'sender_type' })
  senderType: QaSenderType;

  @Column({ type: 'uuid', nullable: true, name: 'sender_user_id' })
  senderUserId: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'sender_creator_id' })
  senderCreatorId: string | null;

  @Column({ type: 'text' })
  body: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => BriefingQaThread)
  @JoinColumn({ name: 'thread_id' })
  thread: BriefingQaThread;

  @ManyToOne(() => Campaign)
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;
}
