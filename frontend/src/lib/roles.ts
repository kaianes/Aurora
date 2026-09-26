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

export function getInvitableRoles(workspaceType: 'brand' | 'agency'): Role[] {
  return workspaceType === 'brand' ? BRAND_INVITABLE_ROLES : AGENCY_INVITABLE_ROLES;
}
