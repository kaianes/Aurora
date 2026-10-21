import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/contexts/auth-context';
import { PublicLayout } from '@/components/layout/public-layout';
import { AppLayout } from '@/components/layout/app-layout';
import { ProtectedRoute } from '@/components/layout/protected-route';
import { CreatorPortalLayout } from '@/components/layout/creator-portal-layout';
import { PricingPage } from '@/pages/pricing-page';
import { RegisterPage } from '@/pages/auth/register-page';
import { VerifyEmailPage } from '@/pages/auth/verify-email-page';
import { LoginPage } from '@/pages/auth/login-page';
import { AcceptInvitationPage } from '@/pages/auth/accept-invitation-page';
import { BrandProfilePage } from '@/pages/app/brand-profile-page';
import { TeamPage } from '@/pages/app/team-page';
import { ClientsPage } from '@/pages/app/clients-page';
import { ClientDetailPage } from '@/pages/app/client-detail-page';
import { CampaignsPage } from '@/pages/app/campaigns-page';
import { CampaignFormPage } from '@/pages/app/campaign-form-page';
import { CampaignDetailPage } from '@/pages/app/campaign-detail-page';
import { ShortfallPage } from '@/pages/app/shortfall-page';
import { TemplatesPage } from '@/pages/app/templates-page';
import { TemplateInstantiatePage } from '@/pages/app/template-instantiate-page';
import { ShortlistPage } from '@/pages/app/shortlist-page';
import { CreatorMetricsPage } from '@/pages/app/creator-metrics-page';
import { ExclusionsPage } from '@/pages/app/exclusions-page';
import { ShortlistOverridePage } from '@/pages/app/shortlist-override-page';
import { CreatorAccessPage } from '@/pages/creator-portal/creator-access-page';
import { OpportunitiesPage } from '@/pages/creator-portal/opportunities-page';
import { SafetyRulesetPage } from '@/pages/app/safety-ruleset-page';
import { CampaignSafetyRulesetPage } from '@/pages/app/campaign-safety-ruleset-page';
import { ReviewQueuePage } from '@/pages/app/review-queue-page';
import { ReviewQueueDetailPage } from '@/pages/app/review-queue-detail-page';
import { MonitoringPage } from '@/pages/app/monitoring-page';
import { NewSubmissionPage } from '@/pages/creator-portal/new-submission-page';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route element={<PublicLayout />}>
              <Route path="/pricing" element={<PricingPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/verify-email" element={<VerifyEmailPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/invitations/accept" element={<AcceptInvitationPage />} />
            </Route>

            {/* Protected routes */}
            <Route
              path="/app"
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route path="brand-profile" element={<BrandProfilePage />} />
              <Route path="team" element={<TeamPage />} />
              <Route path="campaigns" element={<CampaignsPage />} />
              <Route path="campaigns/new" element={<CampaignFormPage />} />
              <Route path="campaigns/:id/edit" element={<CampaignFormPage />} />
              <Route path="campaigns/:id/shortfall" element={<ShortfallPage />} />
              <Route path="campaigns/:id/shortlist" element={<ShortlistPage />} />
              <Route path="campaigns/:id/shortlist/creators/:creatorId" element={<CreatorMetricsPage />} />
              <Route path="campaigns/:id/exclusions" element={<ExclusionsPage />} />
              <Route
                path="campaigns/:id/shortlist/override"
                element={
                  <ProtectedRoute requiredWorkspaceType="agency">
                    <ShortlistOverridePage />
                  </ProtectedRoute>
                }
              />
              <Route path="campaigns/:id" element={<CampaignDetailPage />} />
              <Route path="campaigns/:id/safety-ruleset" element={<CampaignSafetyRulesetPage />} />
              <Route path="exclusions" element={<ExclusionsPage />} />
              <Route path="templates" element={<TemplatesPage />} />
              <Route path="templates/:id/instantiate" element={<TemplateInstantiatePage />} />
              {/* E4 -- Brand Safety (US-15, US-16b, US-17) */}
              <Route path="safety/ruleset" element={<SafetyRulesetPage />} />
              <Route path="safety/review-queue" element={<ReviewQueuePage />} />
              <Route path="safety/review-queue/:id" element={<ReviewQueueDetailPage />} />
              <Route path="safety/monitoring" element={<MonitoringPage />} />
              <Route
                path="clients"
                element={
                  <ProtectedRoute requiredWorkspaceType="agency">
                    <ClientsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="clients/:id"
                element={
                  <ProtectedRoute requiredWorkspaceType="agency">
                    <ClientDetailPage />
                  </ProtectedRoute>
                }
              />
            </Route>

            {/* Creator portal (US-28): separate from /app, creators are not account members */}
            <Route path="/creator-portal" element={<CreatorPortalLayout />}>
              <Route path="access" element={<CreatorAccessPage />} />
              <Route path="opportunities" element={<OpportunitiesPage />} />
              <Route path="submissions/new" element={<NewSubmissionPage />} />
            </Route>

            {/* Default redirect */}
            <Route path="/" element={<Navigate to="/pricing" replace />} />
            <Route path="*" element={<Navigate to="/pricing" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
