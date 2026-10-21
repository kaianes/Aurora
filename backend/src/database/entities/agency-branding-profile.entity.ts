import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

// Owned long-term by E9 (US-44, FR-57's full scope: logo, colors, domain,
// the white-label client-facing surface, and a configuration UI). This
// epic (E7, ADR-0048) adds exactly the two visual properties US-43's report
// renderer needs and nothing else -- no domain, no client-facing portal
// theming. Lives in the agency module, not analytics, the same "extend an
// existing module minimally, owned long-term by whichever epic owns that
// domain" discipline E6 applied to creator.tax_id.
@Entity('agency_branding_profile')
export class AgencyBrandingProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true, name: 'workspace_id' })
  workspaceId: string;

  @Column({ type: 'text', nullable: true, name: 'logo_url' })
  logoUrl: string | null;

  @Column({ type: 'text', nullable: true, name: 'primary_color_hex' })
  primaryColorHex: string | null;

  @Column({ type: 'text', nullable: true, name: 'secondary_color_hex' })
  secondaryColorHex: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'updated_by_user_id' })
  updatedByUserId: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
