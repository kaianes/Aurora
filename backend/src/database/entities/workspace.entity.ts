import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Account } from './account.entity';

export enum WorkspaceType {
  BRAND = 'brand',
  AGENCY = 'agency',
}

@Entity('workspace')
export class Workspace {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', enum: WorkspaceType })
  type: WorkspaceType;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'int', default: 10, name: 'max_client_accounts' })
  maxClientAccounts: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => Account, (account) => account.workspace)
  accounts: Account[];
}
