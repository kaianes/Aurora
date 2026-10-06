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

// ---------------------------------------------------------------------------
// E2 -- Campaign Planning and Pool Buying
// Types mirror docs/architecture/e2-campaign-planning-pool-buying.md section 3.
// ---------------------------------------------------------------------------

export type CampaignState =
  | 'draft'
  | 'quoted'
  | 'confirmed'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled';

export interface AudienceTargeting {
  geography?: string[];
  age_range?: [number, number];
  interests?: string[];
  gender?: 'any' | 'male' | 'female';
}

export type DeliverableFormat =
  | 'instagram_reel'
  | 'instagram_story'
  | 'instagram_post'
  | 'tiktok_video'
  | 'youtube_short';

export interface CampaignQuote {
  id: string;
  status: 'pending' | 'ready' | 'failed' | 'no_viable_pool';
  guaranteed_min_pool_size?: number;
  projected_reach_low?: number;
  projected_reach_high?: number;
  total_price?: string;
  failure_reason?: string;
  requested_at: string;
  resolved_at?: string | null;
}

export interface Campaign {
  id: string;
  account_id: string;
  template_id?: string | null;
  name: string;
  state: CampaignState;
  budget_amount: string | null;
  budget_currency: string;
  audience_targeting: AudienceTargeting | null;
  message: string | null;
  deliverable_formats: DeliverableFormat[] | null;
  timeline_start: string | null;
  timeline_end: string | null;
  missing_fields: string[];
  brand_profile_status?: 'draft' | 'complete';
  brand_profile_drift?: string[];
  latest_quote?: CampaignQuote | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignSummary {
  id: string;
  name: string;
  state: CampaignState;
  budget_amount: string | null;
  created_at: string;
}

export interface CreateCampaignRequest {
  name: string;
  budget_amount?: string;
  budget_currency?: string;
  audience_targeting?: AudienceTargeting;
  message?: string;
  deliverable_formats?: DeliverableFormat[];
  timeline_start?: string;
  timeline_end?: string;
}

export type UpdateCampaignRequest = Partial<CreateCampaignRequest>;

export interface RequestQuoteResponse {
  quote_id: string;
  status: 'pending';
  poll_url: string;
}

export interface ConfirmCampaignResponse {
  id: string;
  state: CampaignState;
  locked_price: string;
  guaranteed_min_pool_size: number;
  confirmed_at: string;
}

export interface PoolShortfallResolution {
  id: string;
  resolution_type: 'partial_refund' | 'revised_guarantee';
  refund_amount: string | null;
  revised_min_pool_size: number | null;
  chosen_by: 'buyer' | 'aurora_default';
  notified_at: string;
  resolved_at: string | null;
}

export interface ShortfallResponse {
  shortfall: PoolShortfallResolution | null;
}

export interface ResolveShortfallRequest {
  resolution_type: 'partial_refund' | 'revised_guarantee';
}

export interface LifecycleActionRequest {
  reason?: string;
}

export interface LifecycleActionResponse {
  id: string;
  state: CampaignState;
  paused_at?: string;
  resumed_at?: string;
  cancelled_at?: string;
}

export interface ReallocationBounds {
  enabled: boolean;
  max_shift_pct: number;
  min_guaranteed_share_pct: number;
}

export interface ReallocationEvent {
  id: string;
  trigger: 'scheduled' | 'manual';
  outcome: 'applied' | 'skipped_stale_metrics' | 'skipped_no_data';
  before_allocations: Record<string, string>;
  after_allocations: Record<string, string>;
  created_at: string;
}

export interface CampaignTemplate {
  id: string;
  account_id: string;
  source_campaign_id?: string | null;
  name: string;
  audience_targeting?: AudienceTargeting;
  message?: string;
  deliverable_formats?: DeliverableFormat[];
  timeline_shape?: { duration_days: number };
  created_at: string;
}

export interface SaveAsTemplateRequest {
  name: string;
}

export interface InstantiateTemplateRequest {
  name: string;
  budget_amount: string;
  timeline_start: string;
}

export interface AcknowledgeDriftRequest {
  acknowledged_fields: string[];
  overrides?: Record<string, unknown>;
}
