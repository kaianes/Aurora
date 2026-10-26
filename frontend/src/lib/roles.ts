import type { Role } from '@/types/api';

export const ROLE_LABELS: Record<Role, string> = {
  brand_owner: 'Proprietario',
  brand_manager: 'Gerente',
  brand_analyst: 'Analista',
  agency_admin: 'Administrador',
  agency_operator: 'Operador',
};

export const BRAND_INVITABLE_ROLES: Role[] = ['brand_manager', 'brand_analyst'];
export const AGENCY_INVITABLE_ROLES: Role[] = ['agency_operator'];

export function canManageTeam(role: Role): boolean {
  return role === 'brand_owner' || role === 'agency_admin';
}

export function canEditBrandProfile(role: Role): boolean {
  return ['brand_owner', 'brand_manager', 'agency_admin', 'agency_operator'].includes(role);
}

export function canManageClients(role: Role): boolean {
  return role === 'agency_admin';
}

// Agency branding profile (ADR-0048), per the agency controller's @Roles(Role.AGENCY_ADMIN)
// on both GET and PUT /agency/branding.
export function canManageAgencyBranding(role: Role): boolean {
  return role === 'agency_admin';
}

export function getInvitableRoles(workspaceType: 'brand' | 'agency'): Role[] {
  return workspaceType === 'brand' ? BRAND_INVITABLE_ROLES : AGENCY_INVITABLE_ROLES;
}

// Campaign (E2) permissions, per docs/architecture/e2-campaign-planning-pool-buying.md 2.3

const CAMPAIGN_WRITE_ROLES: Role[] = ['brand_owner', 'brand_manager', 'agency_admin', 'agency_operator'];

export function canWriteCampaign(role: Role): boolean {
  return CAMPAIGN_WRITE_ROLES.includes(role);
}

export function canResolveShortfall(role: Role): boolean {
  return role === 'brand_owner' || role === 'agency_admin';
}

// Shortlist / exclusion / override (E3) permissions, per
// docs/architecture/e3-creator-matching-curation.md section 2.3

const SHORTLIST_WRITE_ROLES: Role[] = ['brand_owner', 'brand_manager', 'agency_admin', 'agency_operator'];

export function canDecideShortlist(role: Role): boolean {
  return SHORTLIST_WRITE_ROLES.includes(role);
}

export function canManageExclusions(role: Role): boolean {
  return SHORTLIST_WRITE_ROLES.includes(role);
}

// Shortlist override (US-40) is agency-only: no "brand overrides its own shortlist" story exists.
export function canOverrideShortlist(role: Role): boolean {
  return role === 'agency_admin' || role === 'agency_operator';
}

// Brand safety (E4) permissions, per docs/architecture/e4-brand-safety.md section 2.4.
// brand_analyst is read-only across this epic: it can view rulesets, the review queue and
// monitoring, but cannot write rules or decide a flagged item.
const SAFETY_WRITE_ROLES: Role[] = ['brand_owner', 'brand_manager', 'agency_admin', 'agency_operator'];

export function canManageSafetyRules(role: Role): boolean {
  return SAFETY_WRITE_ROLES.includes(role);
}

export function canDecideReviewQueue(role: Role): boolean {
  return SAFETY_WRITE_ROLES.includes(role);
}

// Briefing, Q&A, and content review (E5) permissions, per
// docs/architecture/e5-briefing-content-workflow.md section 3.4.
// brand_analyst stays read-only here too, consistent with every other brand-risk or
// creative-approval action in E2 through E4 -- this is an architectural default pending the
// product decision the architecture document flags as open (PRD open question 5).
const CONTENT_WORKFLOW_WRITE_ROLES: Role[] = ['brand_owner', 'brand_manager', 'agency_admin', 'agency_operator'];

export function canManageBriefing(role: Role): boolean {
  return CONTENT_WORKFLOW_WRITE_ROLES.includes(role);
}

export function canAnswerBriefingQa(role: Role): boolean {
  return CONTENT_WORKFLOW_WRITE_ROLES.includes(role);
}

export function canDecideContentSubmission(role: Role): boolean {
  return CONTENT_WORKFLOW_WRITE_ROLES.includes(role);
}

// Invoice generation (US-20, US-42) permissions, per
// docs/architecture/e6-payments-financial-transparency.md section 3.5. brand_analyst can view
// an invoice (any authenticated account member can, section 4.4) but never generate one.
const INVOICE_GENERATE_ROLES: Role[] = ['brand_owner', 'brand_manager', 'agency_admin', 'agency_operator'];

export function canGenerateInvoice(role: Role): boolean {
  return INVOICE_GENERATE_ROLES.includes(role);
}
