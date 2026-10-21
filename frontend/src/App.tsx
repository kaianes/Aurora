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
import { BriefingComposerPage } from '@/pages/app/briefing-composer-page';
import { BriefingDistributionPage } from '@/pages/app/briefing-distribution-page';
import { BriefingQaPage } from '@/pages/app/briefing-qa-page';
import { ContentSubmissionsPage } from '@/pages/app/content-submissions-page';
import { CreatorBriefingPage } from '@/pages/creator-portal/briefing-page';
import { CreatorBriefingQaPage } from '@/pages/creator-portal/briefing-qa-page';
import { NewDraftPage } from '@/pages/creator-portal/new-draft-page';
import { DraftsPage } from '@/pages/creator-portal/drafts-page';
import { ConfirmPublicationPage } from '@/pages/creator-portal/confirm-publication-page';
import { PaymentsPage } from '@/pages/creator-portal/payments-page';
import { PaymentDetailPage } from '@/pages/creator-portal/payment-detail-page';
import { InvoicePage } from '@/pages/app/invoice-page';
import { CampaignDashboardPage } from '@/pages/app/campaign-dashboard-page';
import { CampaignReportPage } from '@/pages/app/campaign-report-page';
import { ClientReportPage } from '@/pages/app/client-report-page';
import { ReportsComparePage } from '@/pages/app/reports-compare-page';
import { AgencyBrandingPage } from '@/pages/app/agency-branding-page';
import { CreatorPerformancePage } from '@/pages/creator-portal/performance-page';

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
              {/* E5 -- Briefing and Content Workflow (US-18a, US-18b, US-19, US-31) */}
              <Route path="campaigns/:id/briefing" element={<BriefingComposerPage />} />
              <Route path="campaigns/:id/briefing/distribution" element={<BriefingDistributionPage />} />
              <Route path="campaigns/:id/briefing/qa" element={<BriefingQaPage />} />
              <Route path="campaigns/:id/content-submissions" element={<ContentSubmissionsPage />} />
              {/* E6 -- Payments and Financial Transparency (US-20, US-42) */}
              <Route path="campaigns/:id/invoice" element={<InvoicePage />} />
              {/* E7 -- Analytics and Reporting (US-21b, US-22, US-43, US-46) */}
              <Route path="campaigns/:id/dashboard" element={<CampaignDashboardPage />} />
              <Route path="campaigns/:id/reports" element={<CampaignReportPage />} />
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
              <Route
                path="clients/:id/reports"
                element={
                  <ProtectedRoute requiredWorkspaceType="agency">
                    <ClientReportPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/compare"
                element={
                  <ProtectedRoute requiredWorkspaceType="agency">
                    <ReportsComparePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="agency/branding"
                element={
                  <ProtectedRoute requiredWorkspaceType="agency">
                    <AgencyBrandingPage />
                  </ProtectedRoute>
                }
              />
            </Route>

            {/* Creator portal (US-28): separate from /app, creators are not account members */}
            <Route path="/creator-portal" element={<CreatorPortalLayout />}>
              <Route path="access" element={<CreatorAccessPage />} />
              <Route path="opportunities" element={<OpportunitiesPage />} />
              {/* E5 -- Briefing and Content Workflow (US-30, US-31, US-32a, US-32b, US-34) */}
              <Route path="briefing" element={<CreatorBriefingPage />} />
              <Route path="briefing/qa" element={<CreatorBriefingQaPage />} />
              <Route path="drafts/new" element={<NewDraftPage />} />
              <Route path="drafts" element={<DraftsPage />} />
              <Route path="drafts/:id/confirm-publication" element={<ConfirmPublicationPage />} />
              {/* E6 -- Payments and Financial Transparency (US-35a, US-35b, US-35c, US-36a, US-36b) */}
              <Route path="payments" element={<PaymentsPage />} />
              <Route path="payments/:id" element={<PaymentDetailPage />} />
              {/* E7 -- Analytics and Reporting (US-37) */}
              <Route path="performance" element={<CreatorPerformancePage />} />
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
