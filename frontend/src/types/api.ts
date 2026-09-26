// API response types matching the contracts in docs/architecture/e1-access-onboarding.md

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
  };
}

// Auth
export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  workspace_name: string;
  workspace_type: 'brand' | 'agency';
}

export interface RegisterResponse {
  message: string;
  user_id: string;
}

export interface VerifyEmailRequest {
  token: string;
}

export interface VerifyEmailResponse {
  message: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface ResendVerificationRequest {
  email: string;
}

export interface ResendVerificationResponse {
  message: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  mfa_code?: string;
}

export interface Membership {
  account_id: string;
  account_name: string;
  workspace_id: string;
  workspace_type: 'brand' | 'agency';
  role: Role;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: {
    id: string;
    email: string;
    name: string;
    mfa_enabled: boolean;
  };
  memberships: Membership[];
}

export interface RefreshRequest {
  refresh_token: string;
}

export interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface MfaSetupResponse {
  secret: string;
  qr_code_url: string;
  backup_codes: string[];
}

export interface MfaConfirmRequest {
  code: string;
}

export interface MfaConfirmResponse {
  message: string;
}

// Pricing
export interface PricingPlan {
  workspace_type: 'brand' | 'agency';
  name: string;
  platform_fee: {
    amount: string;
    currency: string;
    interval: string;
  };
  commission: {
    rate: string;
    description: string;
  };
  features: string[];
  client_account_limit?: number;
}

export interface PricingResponse {
  updated_at: string;
  plans: PricingPlan[];
}

// Brand Profile
export interface BrandProfile {
  id: string;
  account_id: string;
  name: string;
  logo_url: string | null;
  tone_of_voice: string | null;
  content_guidelines: string | null;
  prohibited_topics: string[] | null;
  status: 'draft' | 'complete';
  created_at: string;
  updated_at: string;
}

export interface CreateBrandProfileRequest {
  name: string;
  tone_of_voice?: string;
  content_guidelines?: string;
  prohibited_topics?: string[];
}

export interface UpdateBrandProfileRequest {
  name?: string;
  tone_of_voice?: string;
  content_guidelines?: string;
  prohibited_topics?: string[];
}

export interface LogoUploadResponse {
  logo_url: string;
  status: 'draft' | 'complete';
}

// Invitations
export interface Invitation {
  id: string;
  email: string;
  role: Role;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  expires_at: string;
  created_at: string;
}

export interface CreateInvitationRequest {
  email: string;
  role: Role;
}

export interface AcceptInvitationRequest {
  token: string;
  name?: string;
  password?: string;
}

export interface AcceptInvitationResponse {
  message: string;
  account_id: string;
  workspace_id: string;
  role: Role;
}

export interface ResendInvitationResponse {
  message: string;
  expires_at: string;
}

// Workspace
export interface Workspace {
  id: string;
  type: 'brand' | 'agency';
  name: string;
  max_client_accounts: number;
  created_at: string;
}

export interface Account {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  is_home: boolean;
}

export interface WorkspaceResponse {
  workspace: Workspace;
  accounts: Account[];
  current_account: {
    id: string;
    role: Role;
  };
}

// Members
export interface Member {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  joined_at: string;
}

export interface UpdateMemberRequest {
  role: Role;
}

export interface UpdateMemberResponse {
  user_id: string;
  role: Role;
  updated_at: string;
}

// Agency Clients
export interface ClientAccount {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  brand_profile_status: 'draft' | 'complete' | null;
  created_at: string;
}

export interface ClientListResponse {
  data: ClientAccount[];
  pagination: Pagination;
  limits: {
    used: number;
    max: number;
  };
}

export interface CreateClientRequest {
  name: string;
  copy_templates_from?: string;
}

export interface CreateClientResponse {
  id: string;
  workspace_id: string;
  name: string;
  status: string;
  templates_copied: number;
  created_at: string;
}

export interface OperatorAccess {
  membership_id: string;
  account_id: string;
  granted_at: string;
}

export interface AddOperatorRequest {
  user_id: string;
}

// Common
export interface Pagination {
  next_cursor: string | null;
  has_more: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}

export type Role =
  | 'brand_owner'
  | 'brand_manager'
  | 'brand_analyst'
  | 'agency_admin'
  | 'agency_operator';
