import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Workspace } from './workspace.entity';
import { Membership } from './membership.entity';
import { BrandProfile } from './brand-profile.entity';
import { Invitation } from './invitation.entity';

export enum AccountStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
}

@Entity('account')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'workspace_id' })
  workspaceId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', enum: AccountStatus, default: AccountStatus.ACTIVE })
  status: AccountStatus;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Workspace, (workspace) => workspace.accounts)
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @OneToMany(() => Membership, (membership) => membership.account)
  memberships: Membership[];

  @OneToOne(() => BrandProfile, (bp) => bp.account)
  brandProfile: BrandProfile;

  @OneToMany(() => Invitation, (invitation) => invitation.account)
  invitations: Invitation[];
}
