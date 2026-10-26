import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Campaign } from './campaign.entity';
import { InvoiceLineItem } from './invoice-line-item.entity';

export enum InvoiceStatus {
  ISSUED = 'issued',
}

// FR-48/FR-49's entity (US-20, US-42), serving both a direct brand buyer and
// an agency client identically, with no schema difference between the two
// (ADR-0040). One row per campaign (unique on campaign_id). total_amount is
// campaign.locked_price plus the sum of invoice_line_item.amount.
@Entity('invoice')
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true, name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'numeric', name: 'total_amount' })
  totalAmount: string;

  @Column({ type: 'text', enum: InvoiceStatus, default: InvoiceStatus.ISSUED })
  status: InvoiceStatus;

  @Column({ type: 'uuid', name: 'generated_by_user_id' })
  generatedByUserId: string;

  @Column({ type: 'timestamptz', name: 'issued_at' })
  issuedAt: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @OneToOne(() => Campaign)
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @OneToMany(() => InvoiceLineItem, (lineItem) => lineItem.invoice)
  lineItems: InvoiceLineItem[];
}
