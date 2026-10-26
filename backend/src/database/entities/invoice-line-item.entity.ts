import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Invoice } from './invoice.entity';

export enum InvoiceLineItemType {
  BASE_PRICE = 'base_price',
  SHORTFALL_REFUND_ADJUSTMENT = 'shortfall_refund_adjustment',
}

// ADR-0039: exactly two line_type values. base_price is always present,
// equal to campaign.locked_price. shortfall_refund_adjustment is present
// only when E2's pool_shortfall_resolution for the campaign resolved
// partial_refund, carrying a negative amount. A revised_guarantee
// resolution, or an FR-23 reallocation, produces no line item at all.
@Entity('invoice_line_item')
export class InvoiceLineItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'invoice_id' })
  invoiceId: string;

  @Column({ type: 'text', enum: InvoiceLineItemType, name: 'line_type' })
  lineType: InvoiceLineItemType;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'numeric' })
  amount: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Invoice, (invoice) => invoice.lineItems)
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;
}
