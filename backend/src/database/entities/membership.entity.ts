import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity';
import { Account } from './account.entity';

export enum Role {
  BRAND_OWNER = 'brand_owner',
  BRAND_MANAGER = 'brand_manager',
  BRAND_ANALYST = 'brand_analyst',
  AGENCY_ADMIN = 'agency_admin',
  AGENCY_OPERATOR = 'agency_operator',
}

@Entity('membership')
@Unique('uq_membership', ['userId', 'accountId'])
export class Membership {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'uuid', name: 'account_id' })
  accountId: string;

  @Column({ type: 'text', enum: Role })
  role: Role;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => User, (user) => user.memberships)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Account, (account) => account.memberships)
  @JoinColumn({ name: 'account_id' })
  account: Account;
}
