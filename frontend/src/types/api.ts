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
  choice_offered: boolean;
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

// ---------------------------------------------------------------------------
// E3 -- Creator Matching and Curation
// Types mirror docs/architecture/e3-creator-matching-curation.md section 3.
// ---------------------------------------------------------------------------

export type ShortlistStatus = 'pending' | 'ready' | 'failed' | 'no_viable_pool';
export type ShortlistEntryOrigin = 'system_ranked' | 'agency_added';
export type ShortlistEntryDecision = 'pending' | 'approved' | 'rejected';

export interface ShortlistEntry {
  id: string;
  creator_id: string;
  rank: number | null;
  fit_score: number | null;
  matched_attributes: string[];
  origin: ShortlistEntryOrigin;
  decision: ShortlistEntryDecision;
  included: boolean;
  decision_at?: string | null;
}

export interface CampaignShortlist {
  id: string;
  campaign_id: string;
  status: ShortlistStatus;
  below_guaranteed_minimum: boolean;
  locked: boolean;
  locked_reason?: 'agency_override' | 'campaign_activated' | null;
  entries: ShortlistEntry[];
  guaranteed_min_pool_size?: number;
  matched_count?: number;
  failure_reason?: string | null;
  requested_at: string;
  resolved_at?: string | null;
}

export interface RequestShortlistResponse {
  shortlist_id: string;
  status: 'pending';
  poll_url: string;
}

export interface ShortlistDecisionRequest {
  decision: 'approved' | 'rejected';
}

export interface ShortlistDecisionResponse {
  id: string;
  decision: ShortlistEntryDecision;
  included: boolean;
  decision_at: string;
  warning?: 'pool_below_guaranteed_minimum';
}

export interface BulkShortlistDecisionRequest {
  decisions: { entry_id: string; decision: 'approved' | 'rejected' }[];
}

export interface RequestAdditionalCandidatesResponse {
  request_id: string;
  status: 'pending';
}

export type AuthenticityFlag = 'none' | 'review' | 'low';

export interface CreatorMetrics {
  creator_id: string;
  display_name: string;
  audience_size: number | null;
  demographic_composition: Record<string, number> | null;
  engagement_rate: string | null;
  content_niche: string | null;
  authenticity_score: number | null;
  authenticity_flag: AuthenticityFlag;
  metrics_computed_at: string | null;
  metrics_stale: boolean;
  stale_since?: string | null;
  matched_attributes?: string[];
}

export type ExclusionScope = 'brand' | 'campaign';
export type ExclusionType = 'creator' | 'competitor_brand';

export interface Exclusion {
  id: string;
  scope: ExclusionScope;
  exclusion_type: ExclusionType;
  creator_id?: string | null;
  competitor_name?: string | null;
  campaign_id?: string | null;
  created_at: string;
  applies_to?: string;
}

export interface CreateExclusionRequest {
  scope: ExclusionScope;
  exclusion_type: ExclusionType;
  creator_id?: string;
  competitor_name?: string;
  campaign_id?: string;
}

export interface ShortlistOverrideRequest {
  remove_entry_ids: string[];
  add_creators: { creator_id: string }[];
}

export interface ShortlistOverrideResponse {
  shortlist_id: string;
  locked: true;
  locked_reason: 'agency_override';
  locked_at: string;
  below_guaranteed_minimum: boolean;
  entries: ShortlistEntry[];
}

export type OpportunityStatus = 'pending' | 'accepted' | 'declined' | 'expired';

export interface CreatorOpportunity {
  id: string;
  campaign_id: string;
  brand_name: string;
  deliverable: { format: string; quantity: number };
  payout_gross: string;
  payout_commission: string;
  payout_net: string;
  // E6 (US-29): projected from campaign.timeline_end / opportunity.expires_at, always an
  // estimate on this pre-acceptance surface -- never the same visual weight as the three
  // locked figures above. See docs/architecture/e6-payments-financial-transparency.md section 4.2.
  expected_payment_date?: string;
  expected_payment_date_is_estimate?: boolean;
  expires_at: string;
  status: OpportunityStatus;
  responded_at?: string | null;
}

// ---------------------------------------------------------------------------
// E4 -- Brand Safety
// Types mirror docs/architecture/e4-brand-safety.md section 3.
// ---------------------------------------------------------------------------

export type SafetyRuleType = 'prohibited_topic' | 'restricted_language' | 'competitor_mention';
export type SafetyRuleAction = 'add' | 'replace' | 'suppress';

export interface ProhibitedTopicDefinition {
  topic: string;
}

export interface RestrictedLanguageDefinition {
  pattern: string;
  pattern_type: 'keyword' | 'regex';
}

export interface CompetitorMentionDefinition {
  competitor_name: string;
  aliases?: string[];
}

export type SafetyRuleDefinition =
  | ProhibitedTopicDefinition
  | RestrictedLanguageDefinition
  | CompetitorMentionDefinition;

export interface SafetyRule {
  id: string;
  rule_type: SafetyRuleType;
  definition: SafetyRuleDefinition | null;
  action: SafetyRuleAction;
  supersedes_rule_id: string | null;
  created_at: string;
}

export interface SafetyRuleset {
  id: string;
  scope: 'brand';
  rules: SafetyRule[];
  updated_at: string;
}

export interface CreateSafetyRuleRequest {
  rule_type: SafetyRuleType;
  definition: SafetyRuleDefinition;
}

export interface UpdateSafetyRuleRequest {
  definition: Partial<ProhibitedTopicDefinition & RestrictedLanguageDefinition & CompetitorMentionDefinition>;
}

export interface DeleteSafetyRuleResponse {
  affected_campaign_overrides?: string[];
}

export type EffectiveRuleSource = 'brand' | 'campaign_override';

export interface EffectiveSafetyRule {
  id: string;
  rule_type: SafetyRuleType;
  definition: SafetyRuleDefinition | null;
  source: EffectiveRuleSource;
  override_action?: SafetyRuleAction;
  supersedes_rule_id?: string | null;
  note?: string;
}

export interface CampaignSafetyRuleset {
  campaign_id: string;
  has_override: boolean;
  effective_rules: EffectiveSafetyRule[];
  override_rule_ids: string[];
}

export interface CreateCampaignOverrideRequest {
  action: SafetyRuleAction;
  supersedes_rule_id?: string;
  rule_type?: SafetyRuleType;
  definition?: SafetyRuleDefinition;
}

// Safety check / content submission intake (US-16)

export type SafetyCheckStatus = 'pending' | 'passed' | 'flagged' | 'check_unavailable';
export type SafetyCheckChannel = 'caption' | 'on_screen_text' | 'audio' | 'system';
export type SafetyCheckTier = 'tier1' | 'tier2';

export interface TriggeredRule {
  rule_id: string | null;
  rule_type: SafetyRuleType | null;
  channel: SafetyCheckChannel;
  matched_excerpt: string | null;
}

export interface SafetyCheckResult {
  id: string;
  status: SafetyCheckStatus;
  tier_reached?: SafetyCheckTier | null;
  triggered_rules?: TriggeredRule[];
  message?: string;
  requested_at: string;
  resolved_at?: string | null;
}

export interface CreateContentSubmissionRequest {
  campaign_id: string;
  opportunity_id?: string;
  caption_text: string;
  on_screen_text?: string;
  audio_transcript?: string;
  media_asset_url?: string;
}

export interface CreateContentSubmissionResponse {
  content_submission_id: string;
  safety_check_id: string;
  status: 'pending';
  poll_url: string;
  // E5 (US-32a/US-32b): populated once content-workflow's own controller replaces E4's stub at
  // this same route, per docs/architecture/e5-briefing-content-workflow.md section 4.4.
  version_number?: number;
  review_deadline_at?: string;
}

// Human review queue (US-17)

export type ReviewQueueReasonCategory = 'rule_violation' | 'check_unavailable';
export type ReviewQueueStatus = 'pending' | 'approved' | 'rejected' | 'revision_requested';

export interface ReviewQueueItem {
  id: string;
  content_submission_id: string;
  campaign_id: string;
  campaign_name: string;
  creator_display_name: string;
  reason_category: ReviewQueueReasonCategory;
  triggered_rules: TriggeredRule[];
  status: ReviewQueueStatus;
  decision_reason?: string | null;
  decided_at?: string | null;
  created_at: string;
}

export interface ReviewQueueItemDetail extends Omit<ReviewQueueItem, 'triggered_rules'> {
  caption_text: string;
  on_screen_text: string | null;
  audio_transcript: string | null;
  tier_reached: SafetyCheckTier | null;
  triggered_rules: (TriggeredRule & { definition?: SafetyRuleDefinition | null })[];
}

export interface DecideReviewItemRequest {
  decision: 'approved' | 'rejected' | 'revision_requested';
  reason?: string;
}

export interface DecideReviewItemResponse {
  id: string;
  status: ReviewQueueStatus;
  decided_at: string;
}

// Post-publication monitoring (US-16b)

export type MonitoringResult = 'matching' | 'deviated' | 'unreachable';

export interface MonitoringSnapshot {
  id: string;
  content_submission_id: string;
  campaign_id: string;
  published_url: string;
  last_result: MonitoringResult | null;
  last_checked_at: string | null;
  deviation_details?: Record<string, unknown> | null;
  consecutive_unreachable_count?: number;
}

export interface MonitoringSnapshotDetail extends MonitoringSnapshot {
  approved_caption_text: string;
  approved_on_screen_text: string | null;
  approved_audio_transcript: string | null;
  monitoring_status: 'active' | 'stopped';
}

// ---------------------------------------------------------------------------
// E5 -- Briefing and Content Workflow
// Types mirror docs/architecture/e5-briefing-content-workflow.md section 4.
// ---------------------------------------------------------------------------

export type BriefingStatus = 'draft' | 'issued';

export interface DeliverableSpec {
  format: string;
  quantity?: number;
  aspect_ratio?: string;
  caption_length_limit?: number;
  mandatory_hashtags?: string[];
  notes?: string;
}

export interface Briefing {
  id: string;
  campaign_id: string;
  status: BriefingStatus;
  dos: string[] | null;
  donts: string[] | null;
  reference_examples: string[] | null;
  deliverable_spec: DeliverableSpec | null;
  deadline: string | null;
  issued_at: string | null;
  issued_by_user_id?: string | null; // brand-side read only, absent on the creator-portal GET
  created_at: string;
  updated_at: string;
}

export interface SaveBriefingRequest {
  dos?: string[];
  donts?: string[];
  reference_examples?: string[];
  deliverable_spec?: DeliverableSpec;
  deadline?: string;
}

export interface IssueBriefingResponse {
  id: string;
  status: 'issued';
  issued_at: string;
  recipients_queued: number;
}

export interface BriefingDistributionFailure {
  creator_id: string;
  failure_reason: string;
}

export interface BriefingDistribution {
  briefing_id: string;
  recipients_total: number;
  delivered: number;
  failed: BriefingDistributionFailure[];
  pending: number;
}

// Briefing Q&A (US-31)

export type QaSenderType = 'creator' | 'brand';

export interface QaMessage {
  sender_type: QaSenderType;
  body: string;
  created_at: string;
}

export interface CreatorQaThreadResponse {
  thread_id: string | null;
  messages: QaMessage[];
  answered: boolean | null;
}

export interface AskBriefingQuestionRequest {
  campaign_id: string;
  question: string;
}

export interface AskBriefingQuestionResponse extends QaMessage {
  thread_id: string;
  sender_type: 'creator';
}

export interface BriefingQaThreadSummary {
  thread_id: string;
  creator_id: string;
  creator_display_name: string;
  message_count: number;
  answered: boolean;
  last_message_at: string;
}

export interface BriefingQaThreadDetail {
  thread_id: string;
  creator_id: string;
  creator_display_name?: string;
  messages: QaMessage[];
  answered: boolean;
}

export interface AnswerBriefingQuestionRequest {
  body: string;
}

// Content submission version history and review decision (US-32a, US-32b, US-19, US-33)

export type ReviewDecisionStatus = 'pending' | 'approved' | 'rejected' | 'revision_requested';

export interface SafetyGateStatus {
  cleared: boolean;
  blocking_reason: string | null;
}

export interface ContentSubmissionVersion {
  id: string;
  version_number: number;
  supersedes_submission_id: string | null;
  review_status: ReviewDecisionStatus;
  review_reason: string | null;
  review_decided_at: string | null;
  review_deadline_at: string | null;
  review_escalated: boolean;
  safety_gate: SafetyGateStatus;
  published_url: string | null;
  submitted_at: string;
}

export interface BrandContentSubmissionVersion extends ContentSubmissionVersion {
  creator_display_name: string;
  latest_version: boolean;
}

export interface DecideSubmissionRequest {
  decision: 'approved' | 'rejected' | 'revision_requested';
  reason?: string;
}

export interface DecideSubmissionResponse {
  id: string;
  content_submission_id: string;
  decision: 'approved' | 'rejected' | 'revision_requested';
  decided_at: string;
}

// Publication confirmation (US-34)

export interface ConfirmPublicationRequest {
  published_url: string;
}

export interface ConfirmPublicationResponse {
  content_submission_id: string;
  published_url: string;
  published_at: string;
  status: 'confirmed';
}

// ---------------------------------------------------------------------------
// E6 -- Payments and Financial Transparency
// Types mirror docs/architecture/e6-payments-financial-transparency.md sections 3-4.
// ---------------------------------------------------------------------------

// Failure is deliberately not a fourth status (section 3.2): a failed execution attempt
// leaves the obligation visibly `owed`, carrying `last_failure_reason` alongside it.
export type PayoutObligationStatus = 'owed' | 'in_flight' | 'settled';

export interface PayoutObligationListItem {
  id: string;
  campaign_id: string;
  campaign_name: string;
  buyer_name: string;
  payout_gross: string;
  payout_commission: string;
  payout_net: string;
  status: PayoutObligationStatus;
  committed_deadline_at: string;
  last_failure_reason: string | null;
  escalated_for_manual_review: boolean;
  settled_at: string | null;
  created_at: string;
}

export type PayoutExecutionAttemptTrigger = 'scheduled' | 'manual';
export type PayoutExecutionAttemptOutcome = 'instructed' | 'failed';

export interface PayoutExecutionAttempt {
  id: string;
  trigger: PayoutExecutionAttemptTrigger;
  outcome: PayoutExecutionAttemptOutcome;
  failure_reason: string | null;
  provider_reference: string | null;
  created_at: string;
}

export interface PayoutObligationDetail extends PayoutObligationListItem {
  payout_execution_attempts: PayoutExecutionAttempt[];
}

export interface PayoutStatementResponse {
  payout_obligation_id: string;
  document_url: string;
  generated_at: string;
}

export type TaxDocumentStatus = 'generated' | 'blocked_missing_info';

export interface TaxDocumentResponse {
  status: TaxDocumentStatus;
  tax_period?: string;
  document_url?: string;
  generated_at?: string;
  missing_fields?: string[];
  message?: string;
}

// US-20 / US-42: no schema difference between a direct brand buyer and an agency client
// (ADR-0040) -- the same invoice shape serves both.
export type InvoiceLineType = 'base_price' | 'shortfall_refund_adjustment';

export interface InvoiceLineItem {
  line_type: InvoiceLineType;
  description: string;
  amount: string;
}

export interface Invoice {
  id: string;
  campaign_id: string;
  total_amount: string;
  line_items: InvoiceLineItem[];
  issued_at: string;
}

// ---------------------------------------------------------------------------
// E7 -- Analytics and Reporting
// Types mirror docs/architecture/e7-analytics-reporting.md sections 2 and 5.
// ---------------------------------------------------------------------------

// US-21a's distinction between a transient failure and a structurally different one
// (auth_revoked) is preserved end to end, never conflated, wherever ingestion_status is shown.
export type IngestionStatus =
  | 'pending_first_pull'
  | 'fresh'
  | 'stale_rate_limited'
  | 'stale_unreachable'
  | 'stale_auth_revoked';

export type DashboardCreatorStatus = 'delivered' | 'pending_delivery';

export interface DashboardCreatorEntry {
  creator_id: string;
  display_name: string;
  status: DashboardCreatorStatus;
  // null (never 0) whenever status is pending_delivery or no successful pull has happened yet.
  reach: number | null;
  engagement: number | null;
  impressions: number | null;
  ingestion_status: IngestionStatus | null;
  last_successful_pull_at: string | null;
}

export interface CampaignDashboardAggregate {
  total_delivered_reach: number;
  total_delivered_engagement: number;
  total_delivered_impressions: number;
  any_stale: boolean;
  last_computed_at: string;
}

// US-21b -- GET /campaigns/:id/dashboard
export interface CampaignDashboard {
  campaign_id: string;
  campaign_state: CampaignState;
  pool_size: number;
  delivered_count: number;
  pending_delivery_count: number;
  pool_aggregate: CampaignDashboardAggregate;
  creators: DashboardCreatorEntry[];
}

// US-37 -- GET /creator-portal/performance
export interface CreatorPerformanceEntry {
  content_submission_id: string;
  campaign_id: string;
  campaign_name: string;
  published_url: string;
  published_at: string;
  reach: number | null;
  engagement: number | null;
  impressions: number | null;
  ingestion_status: IngestionStatus;
  last_successful_pull_at: string | null;
}

export interface CreatorPerformanceResponse {
  data: CreatorPerformanceEntry[];
}

// US-43 / US-46 -- shared report request/poll shape (section 5.3's pattern, reused by 5.5)
export type ReportStatus = 'pending' | 'ready' | 'failed';

export interface RequestReportResponse {
  report_id: string;
  status: 'pending';
  poll_url: string;
}

// US-43 -- GET /agency/clients/:clientAccountId/reports/:reportId
export interface ClientPerformanceReport {
  id: string;
  status: ReportStatus;
  campaign_count: number | null;
  total_spend: string | null;
  total_delivered_reach: number | null;
  total_delivered_engagement: number | null;
  // Null, never zero, whenever there is no delivered engagement/reach to divide by.
  cost_per_engagement: string | null;
  cpm_equivalent: string | null;
  branding_applied: boolean | null;
  pdf_document_url: string | null;
  csv_document_url: string | null;
  requested_at: string;
  resolved_at: string | null;
}

// US-46 -- GET /agency/reports/compare
export interface ClientComparisonEntry {
  client_account_id: string;
  client_name: string;
  campaign_count: number;
  total_spend: string;
  total_delivered_reach: number;
  total_delivered_engagement: number;
  average_reach_per_campaign: number;
  average_engagement_per_campaign: number;
}

export interface RefusedClient {
  client_account_id: string;
  reason: string;
}

export interface CompareClientReportsResponse {
  data: ClientComparisonEntry[];
  refused: RefusedClient[];
}
