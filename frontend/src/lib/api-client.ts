import axios, { isAxiosError, type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type {
  AcceptInvitationRequest,
  AcceptInvitationResponse,
  AcknowledgeDriftRequest,
  AddOperatorRequest,
  AgencyBrandingProfile,
  AnswerBriefingQuestionRequest,
  AskBriefingQuestionRequest,
  AskBriefingQuestionResponse,
  Briefing,
  BriefingDistribution,
  BriefingQaThreadDetail,
  BriefingQaThreadSummary,
  BrandContentSubmissionVersion,
  BrandProfile,
  BulkShortlistDecisionRequest,
  Campaign,
  CampaignDashboard,
  CampaignSafetyRuleset,
  CampaignShortlist,
  CampaignSummary,
  CampaignTemplate,
  ClientListResponse,
  ClientPerformanceReport,
  CompareClientReportsResponse,
  ConfigureBrandingRequest,
  CreatorPerformanceResponse,
  ConfirmPublicationRequest,
  ConfirmPublicationResponse,
  ContentSubmissionVersion,
  Invoice,
  CreateBrandProfileRequest,
  CreateCampaignOverrideRequest,
  CreateCampaignRequest,
  CreateClientRequest,
  CreateClientResponse,
  CreateContentSubmissionRequest,
  CreateContentSubmissionResponse,
  CreateExclusionRequest,
  CreateInvitationRequest,
  CreateSafetyRuleRequest,
  CreatorMetrics,
  CreatorOpportunity,
  CreatorQaThreadResponse,
  ConfirmCampaignResponse,
  DecideReviewItemRequest,
  DecideReviewItemResponse,
  DecideSubmissionRequest,
  DecideSubmissionResponse,
  DeleteSafetyRuleResponse,
  Exclusion,
  InstantiateTemplateRequest,
  Invitation,
  IssueBriefingResponse,
  LifecycleActionRequest,
  LifecycleActionResponse,
  LoginRequest,
  LoginResponse,
  LogoUploadResponse,
  Member,
  MfaConfirmRequest,
  MfaConfirmResponse,
  MfaSetupResponse,
  MonitoringSnapshot,
  MonitoringSnapshotDetail,
  OperatorAccess,
  PaginatedResponse,
  PayoutObligationDetail,
  PayoutObligationListItem,
  PayoutObligationStatus,
  PayoutStatementResponse,
  PricingResponse,
  CampaignQuote,
  ReallocationBounds,
  ReallocationEvent,
  RefreshResponse,
  RegisterRequest,
  RegisterResponse,
  RequestAdditionalCandidatesResponse,
  RequestQuoteResponse,
  RequestReportResponse,
  RequestShortlistResponse,
  ResendInvitationResponse,
  ResendVerificationRequest,
  ResendVerificationResponse,
  ResolveShortfallRequest,
  ReviewQueueItem,
  ReviewQueueItemDetail,
  SafetyCheckResult,
  SafetyRule,
  SafetyRuleset,
  SaveAsTemplateRequest,
  SaveBriefingRequest,
  ShortfallResponse,
  ShortlistDecisionRequest,
  ShortlistDecisionResponse,
  ShortlistOverrideRequest,
  ShortlistOverrideResponse,
  TaxDocumentResponse,
  UpdateBrandProfileRequest,
  UpdateCampaignRequest,
  UpdateMemberRequest,
  UpdateMemberResponse,
  UpdateSafetyRuleRequest,
  VerifyEmailRequest,
  VerifyEmailResponse,
  WorkspaceResponse,
} from '@/types/api';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/v1';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Token management
const TOKEN_KEY = 'aurora_access_token';
const REFRESH_KEY = 'aurora_refresh_token';

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

// Account context for agency workspaces
const ACCOUNT_ID_KEY = 'aurora_account_id';

export function getCurrentAccountId(): string | null {
  return localStorage.getItem(ACCOUNT_ID_KEY);
}

export function setCurrentAccountId(id: string) {
  localStorage.setItem(ACCOUNT_ID_KEY, id);
}

// Request interceptor: attach auth token and account context
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const accountId = getCurrentAccountId();
  if (accountId) {
    config.headers['X-Account-Id'] = accountId;
  }
  return config;
});

// Response interceptor: handle token refresh
let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

function onRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      const refreshToken = getRefreshToken();
      if (!refreshToken) {
        clearTokens();
        window.location.href = '/login';
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve) => {
          refreshSubscribers.push((token: string) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(api(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { data } = await axios.post<RefreshResponse>(`${API_BASE_URL}/auth/refresh`, {
          refresh_token: refreshToken,
        });
        setTokens(data.access_token, data.refresh_token);
        onRefreshed(data.access_token);
        originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
        return api(originalRequest);
      } catch {
        clearTokens();
        window.location.href = '/login';
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

// API methods

export const authApi = {
  register: (data: RegisterRequest) =>
    api.post<RegisterResponse>('/auth/register', data).then((r) => r.data),

  verifyEmail: (data: VerifyEmailRequest) =>
    api.post<VerifyEmailResponse>('/auth/verify-email', data).then((r) => r.data),

  resendVerification: (data: ResendVerificationRequest) =>
    api.post<ResendVerificationResponse>('/auth/resend-verification', data).then((r) => r.data),

  login: (data: LoginRequest) =>
    api.post<LoginResponse>('/auth/login', data).then((r) => r.data),

  refresh: (refreshToken: string) =>
    api.post<RefreshResponse>('/auth/refresh', { refresh_token: refreshToken }).then((r) => r.data),

  mfaSetup: () =>
    api.post<MfaSetupResponse>('/auth/mfa/setup').then((r) => r.data),

  mfaConfirm: (data: MfaConfirmRequest) =>
    api.post<MfaConfirmResponse>('/auth/mfa/confirm', data).then((r) => r.data),
};

export const pricingApi = {
  get: () => api.get<PricingResponse>('/pricing').then((r) => r.data),
};

export const brandProfileApi = {
  getCurrent: () =>
    api.get<BrandProfile>('/brand-profiles/current').then((r) => r.data),

  create: (data: CreateBrandProfileRequest) =>
    api.post<BrandProfile>('/brand-profiles', data).then((r) => r.data),

  update: (id: string, data: UpdateBrandProfileRequest) =>
    api.patch<BrandProfile>(`/brand-profiles/${id}`, data).then((r) => r.data),

  uploadLogo: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api
      .post<LogoUploadResponse>(`/brand-profiles/${id}/logo`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },
};

export const invitationApi = {
  list: (params?: { status?: string; cursor?: string; limit?: number }) =>
    api.get<PaginatedResponse<Invitation>>('/invitations', { params }).then((r) => r.data),

  create: (data: CreateInvitationRequest) =>
    api.post<Invitation>('/invitations', data).then((r) => r.data),

  resend: (id: string) =>
    api.post<ResendInvitationResponse>(`/invitations/${id}/resend`).then((r) => r.data),

  accept: (data: AcceptInvitationRequest) =>
    api.post<AcceptInvitationResponse>('/invitations/accept', data).then((r) => r.data),

  cancel: (id: string) => api.delete(`/invitations/${id}`).then(() => undefined),
};

export const workspaceApi = {
  getCurrent: () =>
    api.get<WorkspaceResponse>('/workspaces/current').then((r) => r.data),
};

export const memberApi = {
  list: (accountId: string, params?: { cursor?: string; limit?: number }) =>
    api.get<PaginatedResponse<Member>>(`/accounts/${accountId}/members`, { params }).then((r) => r.data),

  updateRole: (accountId: string, userId: string, data: UpdateMemberRequest) =>
    api.patch<UpdateMemberResponse>(`/accounts/${accountId}/members/${userId}`, data).then((r) => r.data),

  remove: (accountId: string, userId: string) =>
    api.delete(`/accounts/${accountId}/members/${userId}`).then(() => undefined),
};

export const agencyApi = {
  listClients: (params?: { cursor?: string; limit?: number }) =>
    api.get<ClientListResponse>('/agency/clients', { params }).then((r) => r.data),

  createClient: (data: CreateClientRequest) =>
    api.post<CreateClientResponse>('/agency/clients', data).then((r) => r.data),

  addOperator: (clientId: string, data: AddOperatorRequest) =>
    api.post<OperatorAccess>(`/agency/clients/${clientId}/operators`, data).then((r) => r.data),

  removeOperator: (clientId: string, userId: string) =>
    api.delete(`/agency/clients/${clientId}/operators/${userId}`).then(() => undefined),

  // E7 -- per-client report (US-43), per docs/architecture/e7-analytics-reporting.md section
  // 5.5. The caller's X-Account-Id must be the client account itself (section 2.5) -- the page
  // calling these is responsible for switching account context around each call, the same
  // pattern client-detail-page already uses for brand-profile operations on a client account.
  requestClientReport: (clientAccountId: string) =>
    api.post<RequestReportResponse>(`/agency/clients/${clientAccountId}/reports`).then((r) => r.data),

  getClientReport: (clientAccountId: string, reportId: string) =>
    api
      .get<ClientPerformanceReport>(`/agency/clients/${clientAccountId}/reports/${reportId}`)
      .then((r) => r.data),

  // E7 -- cross-client comparison (US-46), per section 5.6. Runs under the agency's own home
  // account context; the backend's app.agency_cross_client_read escape hatch (section 2.5)
  // scopes the read, not X-Account-Id.
  compareReports: (clientAccountIds: string[]) =>
    api
      .get<CompareClientReportsResponse>('/agency/reports/compare', {
        params: { client_account_ids: clientAccountIds.join(',') },
      })
      .then((r) => r.data),

  // E7 -- agency branding profile (ADR-0048, section 2.3), closing the US-43 gap: an
  // agency_admin needs a way to actually configure the logo/colors a per-client report
  // renders under. Runs under the agency's own home account context, never a client account.
  getBranding: () => api.get<AgencyBrandingProfile>('/agency/branding').then((r) => r.data),

  configureBranding: (data: ConfigureBrandingRequest) =>
    api.put<AgencyBrandingProfile>('/agency/branding', data).then((r) => r.data),
};

export const campaignApi = {
  list: (params?: { state?: string; cursor?: string; limit?: number }) =>
    api.get<PaginatedResponse<CampaignSummary>>('/campaigns', { params }).then((r) => r.data),

  get: (id: string) => api.get<Campaign>(`/campaigns/${id}`).then((r) => r.data),

  create: (data: CreateCampaignRequest) =>
    api.post<Campaign>('/campaigns', data).then((r) => r.data),

  update: (id: string, data: UpdateCampaignRequest) =>
    api.patch<Campaign>(`/campaigns/${id}`, data).then((r) => r.data),

  requestQuote: (id: string) =>
    api.post<RequestQuoteResponse>(`/campaigns/${id}/quote`).then((r) => r.data),

  getQuote: (campaignId: string, quoteId: string) =>
    api.get<CampaignQuote>(`/campaigns/${campaignId}/quote/${quoteId}`).then((r) => r.data),

  confirm: (id: string) =>
    api.post<ConfirmCampaignResponse>(`/campaigns/${id}/confirm`).then((r) => r.data),

  getShortfall: (id: string) =>
    api.get<ShortfallResponse>(`/campaigns/${id}/shortfall`).then((r) => r.data),

  resolveShortfall: (id: string, data: ResolveShortfallRequest) =>
    api.post<ShortfallResponse['shortfall']>(`/campaigns/${id}/shortfall/resolve`, data).then((r) => r.data),

  pause: (id: string, data?: LifecycleActionRequest) =>
    api.post<LifecycleActionResponse>(`/campaigns/${id}/pause`, data ?? {}).then((r) => r.data),

  resume: (id: string) =>
    api.post<LifecycleActionResponse>(`/campaigns/${id}/resume`).then((r) => r.data),

  cancel: (id: string, data?: LifecycleActionRequest) =>
    api.post<LifecycleActionResponse>(`/campaigns/${id}/cancel`, data ?? {}).then((r) => r.data),

  setReallocationBounds: (id: string, data: ReallocationBounds) =>
    api.put<ReallocationBounds>(`/campaigns/${id}/reallocation-bounds`, data).then((r) => r.data),

  listReallocationEvents: (id: string, params?: { cursor?: string; limit?: number }) =>
    api
      .get<PaginatedResponse<ReallocationEvent>>(`/campaigns/${id}/reallocation-events`, { params })
      .then((r) => r.data),

  saveAsTemplate: (id: string, data: SaveAsTemplateRequest) =>
    api.post<CampaignTemplate>(`/campaigns/${id}/save-as-template`, data).then((r) => r.data),

  acknowledgeDrift: (id: string, data: AcknowledgeDriftRequest) =>
    api.post<Campaign>(`/campaigns/${id}/acknowledge-drift`, data).then((r) => r.data),

  // E7 -- unified dashboard (US-21b), per docs/architecture/e7-analytics-reporting.md section
  // 5.2. A direct read of campaign_performance_aggregate, never recomputed at request time.
  getDashboard: (id: string) =>
    api.get<CampaignDashboard>(`/campaigns/${id}/dashboard`).then((r) => r.data),
};

// E6 -- Campaign invoice, one per campaign, serving both a direct brand buyer (US-20) and an
// agency client (US-42) with no shape difference (ADR-0040), per
// docs/architecture/e6-payments-financial-transparency.md section 4.4.

export const invoiceApi = {
  get: (campaignId: string) =>
    api
      .get<Invoice>(`/campaigns/${campaignId}/invoice`)
      .then((r) => r.data)
      .catch((err) => {
        // 404 INVOICE_NOT_YET_GENERATED: no invoice exists yet, not an error state.
        if (isAxiosError(err) && err.response?.status === 404) return null;
        throw err;
      }),

  generate: (campaignId: string) =>
    api.post<Invoice>(`/campaigns/${campaignId}/invoice`).then((r) => r.data),
};

export const templateApi = {
  list: (params?: { cursor?: string; limit?: number }) =>
    api.get<PaginatedResponse<CampaignTemplate>>('/campaign-templates', { params }).then((r) => r.data),

  instantiate: (id: string, data: InstantiateTemplateRequest) =>
    api.post<Campaign>(`/campaign-templates/${id}/instantiate`, data).then((r) => r.data),
};

// E3 -- shortlist, metrics, exclusions, agency override (per docs/architecture/e3-creator-matching-curation.md section 3)

export const shortlistApi = {
  request: (campaignId: string) =>
    api.post<RequestShortlistResponse>(`/campaigns/${campaignId}/shortlist`).then((r) => r.data),

  get: (campaignId: string) =>
    api
      .get<CampaignShortlist>(`/campaigns/${campaignId}/shortlist`)
      .then((r) => r.data)
      .catch((err) => {
        if (isAxiosError(err) && err.response?.status === 404) return null;
        throw err;
      }),

  decide: (campaignId: string, entryId: string, data: ShortlistDecisionRequest) =>
    api
      .patch<ShortlistDecisionResponse>(`/campaigns/${campaignId}/shortlist/entries/${entryId}`, data)
      .then((r) => r.data),

  bulkDecide: (campaignId: string, data: BulkShortlistDecisionRequest) =>
    api
      .patch<{ entries: ShortlistDecisionResponse[] }>(`/campaigns/${campaignId}/shortlist/entries/bulk`, data)
      .then((r) => r.data),

  requestAdditionalCandidates: (campaignId: string) =>
    api
      .post<RequestAdditionalCandidatesResponse>(`/campaigns/${campaignId}/shortlist/request-additional-candidates`)
      .then((r) => r.data),

  override: (campaignId: string, data: ShortlistOverrideRequest) =>
    api.post<ShortlistOverrideResponse>(`/campaigns/${campaignId}/shortlist/override`, data).then((r) => r.data),
};

export const creatorApi = {
  getMetrics: (creatorId: string, campaignId?: string) =>
    api
      .get<CreatorMetrics>(`/creators/${creatorId}/metrics`, { params: campaignId ? { campaign_id: campaignId } : undefined })
      .then((r) => r.data),
};

export const exclusionApi = {
  list: (params?: { campaign_id?: string }) =>
    api.get<PaginatedResponse<Exclusion>>('/exclusions', { params }).then((r) => r.data),

  create: (data: CreateExclusionRequest) =>
    api.post<Exclusion>('/exclusions', data).then((r) => r.data),

  remove: (id: string) => api.delete(`/exclusions/${id}`).then(() => undefined),
};

// E4 -- Brand safety ruleset and campaign overrides (US-15), per
// docs/architecture/e4-brand-safety.md section 3.2.

export const safetyRulesetApi = {
  getBrand: () => api.get<SafetyRuleset>('/safety/rulesets/brand').then((r) => r.data),

  createBrandRule: (data: CreateSafetyRuleRequest) =>
    api.post<SafetyRule>('/safety/rulesets/brand/rules', data).then((r) => r.data),

  updateBrandRule: (ruleId: string, data: UpdateSafetyRuleRequest) =>
    api.patch<SafetyRule>(`/safety/rulesets/brand/rules/${ruleId}`, data).then((r) => r.data),

  deleteBrandRule: (ruleId: string) =>
    api.delete<DeleteSafetyRuleResponse | ''>(`/safety/rulesets/brand/rules/${ruleId}`).then((r) =>
      r.data && typeof r.data === 'object' ? r.data : {},
    ),

  getCampaignRuleset: (campaignId: string) =>
    api.get<CampaignSafetyRuleset>(`/campaigns/${campaignId}/safety-ruleset`).then((r) => r.data),

  createCampaignOverride: (campaignId: string, data: CreateCampaignOverrideRequest) =>
    api.post(`/campaigns/${campaignId}/safety-ruleset/overrides`, data).then((r) => r.data),

  deleteCampaignOverride: (campaignId: string, ruleId: string) =>
    api.delete(`/campaigns/${campaignId}/safety-ruleset/overrides/${ruleId}`).then(() => undefined),
};

// E4 -- Human review queue (US-17), per docs/architecture/e4-brand-safety.md section 3.4.

export const reviewQueueApi = {
  list: (params?: { status?: string; cursor?: string; limit?: number }) =>
    api.get<PaginatedResponse<ReviewQueueItem>>('/safety/review-queue', { params }).then((r) => r.data),

  get: (id: string) => api.get<ReviewQueueItemDetail>(`/safety/review-queue/${id}`).then((r) => r.data),

  decide: (id: string, data: DecideReviewItemRequest) =>
    api.post<DecideReviewItemResponse>(`/safety/review-queue/${id}/decide`, data).then((r) => r.data),
};

// E4 -- Post-publication monitoring (US-16b), per docs/architecture/e4-brand-safety.md section 3.5.

export const monitoringApi = {
  list: (params?: { campaign_id?: string; result?: string; cursor?: string; limit?: number }) =>
    api.get<PaginatedResponse<MonitoringSnapshot>>('/safety/monitoring', { params }).then((r) => r.data),

  get: (id: string) => api.get<MonitoringSnapshotDetail>(`/safety/monitoring/${id}`).then((r) => r.data),
};

// E5 -- Briefing composition, distribution, and Q&A (US-18a, US-18b, US-31 brand side), per
// docs/architecture/e5-briefing-content-workflow.md section 4.2-4.3.

export const briefingApi = {
  get: (campaignId: string) =>
    api
      .get<Briefing>(`/campaigns/${campaignId}/briefing`)
      .then((r) => r.data)
      .catch((err) => {
        // 404 BRIEFING_NOT_FOUND means Marina has never saved a draft yet -- not an error state.
        if (isAxiosError(err) && err.response?.status === 404) return null;
        throw err;
      }),

  save: (campaignId: string, data: SaveBriefingRequest) =>
    api.put<Briefing>(`/campaigns/${campaignId}/briefing`, data).then((r) => r.data),

  issue: (campaignId: string) =>
    api.post<IssueBriefingResponse>(`/campaigns/${campaignId}/briefing/issue`).then((r) => r.data),

  getDistribution: (campaignId: string) =>
    api.get<BriefingDistribution>(`/campaigns/${campaignId}/briefing/distribution`).then((r) => r.data),

  listQa: (campaignId: string) =>
    api.get<{ data: BriefingQaThreadSummary[] }>(`/campaigns/${campaignId}/briefing/qa`).then((r) => r.data),

  getQaThread: (campaignId: string, threadId: string) =>
    api.get<BriefingQaThreadDetail>(`/campaigns/${campaignId}/briefing/qa/${threadId}`).then((r) => r.data),

  answerQa: (campaignId: string, threadId: string, data: AnswerBriefingQuestionRequest) =>
    api
      .post<{ sender_type: 'brand'; body: string; created_at: string }>(
        `/campaigns/${campaignId}/briefing/qa/${threadId}/messages`,
        data,
      )
      .then((r) => r.data),
};

// E5 -- Marina's review queue and decision (US-19), per section 4.4-4.5.

export const contentSubmissionApi = {
  list: (
    campaignId: string,
    params?: { opportunity_id?: string; review_status?: string; cursor?: string; limit?: number },
  ) =>
    api
      .get<PaginatedResponse<BrandContentSubmissionVersion>>(`/campaigns/${campaignId}/content-submissions`, {
        params,
      })
      .then((r) => r.data),

  decide: (submissionId: string, data: DecideSubmissionRequest) =>
    api.post<DecideSubmissionResponse>(`/content-submissions/${submissionId}/decide`, data).then((r) => r.data),
};

// Creator portal (US-28): separate token storage since creators are not account members.
// Pilot-only creator login (ADR-0013): POST /creator-portal/login takes a creator_id
// (no password -- E8 owns the real social-auth/magic-link flow) and returns a short-lived
// creator JWT, used against the /creator-portal/* endpoints below.

const CREATOR_TOKEN_KEY = 'aurora_creator_token';

export function getCreatorToken(): string | null {
  return localStorage.getItem(CREATOR_TOKEN_KEY);
}

export function setCreatorToken(token: string) {
  localStorage.setItem(CREATOR_TOKEN_KEY, token);
}

export function clearCreatorToken() {
  localStorage.removeItem(CREATOR_TOKEN_KEY);
}

const creatorPortalClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

creatorPortalClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getCreatorToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const creatorPortalApi = {
  login: (creator_id: string) =>
    creatorPortalClient
      .post<{ access_token: string; expires_in: number; creator_id: string }>('/creator-portal/login', {
        creator_id,
      })
      .then((r) => r.data),

  listOpportunities: () =>
    creatorPortalClient.get<{ data: CreatorOpportunity[] }>('/creator-portal/opportunities').then((r) => r.data),

  accept: (id: string) =>
    creatorPortalClient.post<CreatorOpportunity>(`/creator-portal/opportunities/${id}/accept`).then((r) => r.data),

  decline: (id: string) =>
    creatorPortalClient.post<CreatorOpportunity>(`/creator-portal/opportunities/${id}/decline`).then((r) => r.data),

  // E5 -- content-workflow's own controller now answers this same route (US-32a), replacing
  // E4's stub per docs/architecture/e5-briefing-content-workflow.md section 4.4/7.4.
  submitContent: (data: CreateContentSubmissionRequest) =>
    creatorPortalClient
      .post<CreateContentSubmissionResponse>('/creator-portal/content-submissions', data)
      .then((r) => r.data),

  // Polling endpoint is shared with account members (section 3.3); reached here with the
  // creator JWT since this page is the creator-facing side of the check.
  getSafetyCheck: (contentSubmissionId: string) =>
    creatorPortalClient.get<SafetyCheckResult>(`/safety/submissions/${contentSubmissionId}/check`).then((r) => r.data),

  // E5 -- briefing viewer and Q&A (US-30, US-31), per section 4.3.
  getBriefing: (campaignId: string) =>
    creatorPortalClient
      .get<Briefing>('/creator-portal/briefing', { params: { campaign_id: campaignId } })
      .then((r) => r.data)
      .catch((err) => {
        // 404 BRIEFING_NOT_AVAILABLE covers "no briefing", "not issued", and "opportunity not
        // accepted" uniformly, by design (section 4.3) -- the UI never tries to tell those apart.
        if (isAxiosError(err) && err.response?.status === 404) return null;
        throw err;
      }),

  askBriefingQuestion: (data: AskBriefingQuestionRequest) =>
    creatorPortalClient.post<AskBriefingQuestionResponse>('/creator-portal/briefing/qa', data).then((r) => r.data),

  getBriefingQa: (campaignId: string) =>
    creatorPortalClient
      .get<CreatorQaThreadResponse>('/creator-portal/briefing/qa', { params: { campaign_id: campaignId } })
      .then((r) => r.data),

  // E5 -- draft version history (US-32a, US-32b, US-33), per section 4.4.
  listSubmissions: (opportunityId: string) =>
    creatorPortalClient
      .get<{ data: ContentSubmissionVersion[] }>('/creator-portal/content-submissions', {
        params: { opportunity_id: opportunityId },
      })
      .then((r) => r.data),

  // E5 -- publication confirmation (US-34), per section 4.6.
  confirmPublication: (submissionId: string, data: ConfirmPublicationRequest) =>
    creatorPortalClient
      .post<ConfirmPublicationResponse>(`/creator-portal/content-submissions/${submissionId}/confirm-publication`, data)
      .then((r) => r.data),

  // E6 -- payment history, statements, tax documents (US-35a/b/c, US-36a, US-36b), per
  // docs/architecture/e6-payments-financial-transparency.md section 4.3.
  listPayoutObligations: (params?: { status?: PayoutObligationStatus; campaign_id?: string; cursor?: string; limit?: number }) =>
    creatorPortalClient
      .get<PaginatedResponse<PayoutObligationListItem>>('/creator-portal/payout-obligations', { params })
      .then((r) => r.data),

  getPayoutObligation: (id: string) =>
    creatorPortalClient
      .get<PayoutObligationDetail>(`/creator-portal/payout-obligations/${id}`)
      .then((r) => r.data),

  getPayoutStatement: (id: string) =>
    creatorPortalClient
      .get<PayoutStatementResponse>(`/creator-portal/payout-obligations/${id}/statement`)
      .then((r) => r.data),

  getTaxDocument: (id: string) =>
    creatorPortalClient
      .get<TaxDocumentResponse>(`/creator-portal/payout-obligations/${id}/tax-document`)
      .then((r) => r.data)
      .catch((err) => {
        // 404 TAX_DOCUMENT_NOT_AVAILABLE: the obligation has not settled yet, not an error state.
        if (isAxiosError(err) && err.response?.status === 404) return null;
        throw err;
      }),

  // E7 -- Duda's own performance (US-37), per docs/architecture/e7-analytics-reporting.md
  // section 5.4. Scoped server-side to her creator ID from the JWT, never a parameter.
  listPerformance: () =>
    creatorPortalClient.get<CreatorPerformanceResponse>('/creator-portal/performance').then((r) => r.data),
};

export default api;
