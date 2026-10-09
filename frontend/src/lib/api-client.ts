import axios, { isAxiosError, type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type {
  AcceptInvitationRequest,
  AcceptInvitationResponse,
  AcknowledgeDriftRequest,
  AddOperatorRequest,
  BrandProfile,
  BulkShortlistDecisionRequest,
  Campaign,
  CampaignShortlist,
  CampaignSummary,
  CampaignTemplate,
  ClientListResponse,
  CreateBrandProfileRequest,
  CreateCampaignRequest,
  CreateClientRequest,
  CreateClientResponse,
  CreateExclusionRequest,
  CreateInvitationRequest,
  CreatorMetrics,
  CreatorOpportunity,
  ConfirmCampaignResponse,
  Exclusion,
  InstantiateTemplateRequest,
  Invitation,
  LifecycleActionRequest,
  LifecycleActionResponse,
  LoginRequest,
  LoginResponse,
  LogoUploadResponse,
  Member,
  MfaConfirmRequest,
  MfaConfirmResponse,
  MfaSetupResponse,
  OperatorAccess,
  PaginatedResponse,
  PricingResponse,
  CampaignQuote,
  ReallocationBounds,
  ReallocationEvent,
  RefreshResponse,
  RegisterRequest,
  RegisterResponse,
  RequestAdditionalCandidatesResponse,
  RequestQuoteResponse,
  RequestShortlistResponse,
  ResendInvitationResponse,
  ResendVerificationRequest,
  ResendVerificationResponse,
  ResolveShortfallRequest,
  SaveAsTemplateRequest,
  ShortfallResponse,
  ShortlistDecisionRequest,
  ShortlistDecisionResponse,
  ShortlistOverrideRequest,
  ShortlistOverrideResponse,
  UpdateBrandProfileRequest,
  UpdateCampaignRequest,
  UpdateMemberRequest,
  UpdateMemberResponse,
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
};

export default api;
