import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Membership } from './membership.entity';
import { Account } from './account.entity';

@Entity('operator_client_access')
@Unique('uq_operator_client_access', ['membershipId', 'accountId'])
export class OperatorClientAccess {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'membership_id' })
  membershipId: string;

  @Column({ type: 'uuid', name: 'account_id' })
  accountId: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Membership)
  @JoinColumn({ name: 'membership_id' })
  membership: Membership;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'account_id' })
  account: Account;
}
