import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgencyBrandingPage } from './agency-branding-page';
import { agencyApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  agencyApi: {
    getBranding: vi.fn(),
    configureBranding: vi.fn(),
  },
}));

let mockCurrentRole = 'agency_admin';
vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ currentRole: mockCurrentRole }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AgencyBrandingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const unconfiguredProfile = {
  logo_url: null,
  primary_color_hex: null,
  secondary_color_hex: null,
  custom_domain: null,
  domain_status: null,
};
const configuredProfile = {
  logo_url: 'https://cdn.example.com/logo.png',
  primary_color_hex: '#3ddc97',
  secondary_color_hex: '#7f77dd',
  custom_domain: 'relatorios.agenciacriativa.com.br',
  domain_status: 'pending_activation' as const,
  updated_at: '2026-10-21T10:00:00Z',
};

// ADR-0048, section 2.3 of the E7 architecture doc: this page configures the
// agency_branding_profile that US-43's per-client report renders under.
// Restricted to agency_admin on both GET and PUT /agency/branding. Had no
// test coverage at all until this spec -- it was built as a later, gap-fill
// addition after the rest of E7's frontend shipped.
describe('AgencyBrandingPage - ADR-0048 (US-43 branding configuration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentRole = 'agency_admin';
  });

  // ---- Role gating (section 2.4 of the architecture doc): branding
  // configuration is restricted to agency_admin, matching E1's existing
  // precedent for workspace-level settings. ----
  it('shows a restricted message and never loads or renders the form for a non-agency_admin role', async () => {
    mockCurrentRole = 'agency_operator';

    renderPage();

    expect(
      await screen.findByText(/Apenas administradores da agencia podem ver e configurar/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('URL do logo')).not.toBeInTheDocument();
    expect(agencyApi.getBranding).not.toHaveBeenCalled();
  });

  // ---- The "not yet configured" default state: a brand-new agency with no
  // branding configured yet sees an empty form (no logo, no fallback to
  // Aurora's own branding ever shown here), not an error. ----
  it('renders an empty form with no logo preview before any branding is configured', async () => {
    (agencyApi.getBranding as any).mockResolvedValue(unconfiguredProfile);

    renderPage();

    expect(await screen.findByText('Sem logo')).toBeInTheDocument();
    expect(screen.getByLabelText('URL do logo')).toHaveValue('');
    expect(screen.getByText(/Cor primaria \(nao definida\)/)).toBeInTheDocument();
    expect(screen.getByText(/Cor secundaria \(nao definida\)/)).toBeInTheDocument();
  });

  // ---- Once a profile exists, the form is pre-filled with its current
  // values, and a logo preview renders from the saved URL. ----
  it('pre-fills the form and shows a logo preview once a branding profile already exists', async () => {
    (agencyApi.getBranding as any).mockResolvedValue(configuredProfile);

    renderPage();

    expect(await screen.findByLabelText('URL do logo')).toHaveValue('https://cdn.example.com/logo.png');
    expect(screen.getByAltText('Logo da agencia')).toHaveAttribute('src', 'https://cdn.example.com/logo.png');
    expect(screen.getByText(/Cor primaria #3DDC97/)).toBeInTheDocument();
    expect(screen.getByText(/Cor secundaria #7F77DD/)).toBeInTheDocument();
  });

  // ---- Saving configures the branding via PUT /agency/branding and shows
  // a success confirmation -- this is the write path US-43's report
  // renderer depends on to ever show branding_applied: true. ----
  it('saves updated branding and shows a success confirmation', async () => {
    (agencyApi.getBranding as any).mockResolvedValue(unconfiguredProfile);
    (agencyApi.configureBranding as any).mockResolvedValue(configuredProfile);

    renderPage();

    await screen.findByLabelText('URL do logo');
    await userEvent.type(screen.getByLabelText('URL do logo'), 'https://cdn.example.com/logo.png');
    await userEvent.type(screen.getByLabelText('Cor primaria'), '#3DDC97');
    await userEvent.type(screen.getByLabelText('Cor secundaria'), '#7F77DD');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar marca' }));

    expect(await screen.findByText('Marca da agencia salva com sucesso.')).toBeInTheDocument();
    expect(agencyApi.configureBranding).toHaveBeenCalledWith({
      logo_url: 'https://cdn.example.com/logo.png',
      primary_color_hex: '#3DDC97',
      secondary_color_hex: '#7F77DD',
    });
  });

  // ---- The save action is disabled until the form is actually dirty, so
  // an agency_admin cannot accidentally re-submit an unchanged profile. ----
  it('disables the save action until the form has unsaved changes', async () => {
    (agencyApi.getBranding as any).mockResolvedValue(configuredProfile);

    renderPage();

    await screen.findByLabelText('URL do logo');
    expect(screen.getByRole('button', { name: 'Salvar marca' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('URL do logo'), '2');

    expect(screen.getByRole('button', { name: 'Salvar marca' })).toBeEnabled();
  });

  // ---- Client-side validation rejects a malformed hex color before ever
  // reaching the backend, consistent with the backend's own DTO validation
  // for the same two fields. ----
  it('shows a validation error for a malformed hex color and does not call the API', async () => {
    (agencyApi.getBranding as any).mockResolvedValue(unconfiguredProfile);

    renderPage();

    await screen.findByLabelText('URL do logo');
    await userEvent.type(screen.getByLabelText('Cor primaria'), 'not-a-hex-color');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar marca' }));

    expect(await screen.findByText('Use o formato hexadecimal #RRGGBB.')).toBeInTheDocument();
    expect(agencyApi.configureBranding).not.toHaveBeenCalled();
  });

  it('shows an explicit error message when saving fails', async () => {
    (agencyApi.getBranding as any).mockResolvedValue(unconfiguredProfile);
    (agencyApi.configureBranding as any).mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { message: 'Nao foi possivel salvar a marca da agencia.' } } },
    });

    renderPage();

    await screen.findByLabelText('URL do logo');
    await userEvent.type(screen.getByLabelText('URL do logo'), 'https://cdn.example.com/logo.png');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar marca' }));

    expect(await screen.findByText('Nao foi possivel salvar a marca da agencia.')).toBeInTheDocument();
  });

  it('shows an explicit error state when loading the existing profile fails', async () => {
    (agencyApi.getBranding as any).mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { message: 'Nao foi possivel carregar a marca da agencia.' } } },
    });

    renderPage();

    expect(await screen.findByText('Nao foi possivel carregar a marca da agencia.')).toBeInTheDocument();
  });

  // ---- US-44 (ADR-0061): the domain field is format-validated only, and reference-only
  // help text is shown -- never implying real-time self-service activation. ----
  describe('custom domain (US-44)', () => {
    it('pre-fills the custom domain and shows a pending-activation badge once one is configured', async () => {
      (agencyApi.getBranding as any).mockResolvedValue(configuredProfile);

      renderPage();

      expect(await screen.findByLabelText('Dominio personalizado')).toHaveValue(
        'relatorios.agenciacriativa.com.br',
      );
      expect(screen.getByText('Ativacao pendente')).toBeInTheDocument();
    });

    it('shows no pending-activation badge and an empty field before any domain is configured', async () => {
      (agencyApi.getBranding as any).mockResolvedValue(unconfiguredProfile);

      renderPage();

      expect(await screen.findByLabelText('Dominio personalizado')).toHaveValue('');
      expect(screen.queryByText('Ativacao pendente')).not.toBeInTheDocument();
    });

    it('rejects an invalid domain format and does not call the API', async () => {
      (agencyApi.getBranding as any).mockResolvedValue(unconfiguredProfile);

      renderPage();

      await screen.findByLabelText('Dominio personalizado');
      await userEvent.type(screen.getByLabelText('Dominio personalizado'), 'Not A Domain!!');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar marca' }));

      expect(
        await screen.findByText('Use um dominio valido, em letras minusculas (ex: relatorios.suaagencia.com.br).'),
      ).toBeInTheDocument();
      expect(agencyApi.configureBranding).not.toHaveBeenCalled();
    });

    it('saves a valid custom domain along with the rest of the branding profile', async () => {
      (agencyApi.getBranding as any).mockResolvedValue(unconfiguredProfile);
      (agencyApi.configureBranding as any).mockResolvedValue(configuredProfile);

      renderPage();

      await screen.findByLabelText('Dominio personalizado');
      await userEvent.type(screen.getByLabelText('Dominio personalizado'), 'relatorios.agenciacriativa.com.br');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar marca' }));

      expect(await screen.findByText('Marca da agencia salva com sucesso.')).toBeInTheDocument();
      expect(agencyApi.configureBranding).toHaveBeenCalledWith(
        expect.objectContaining({ custom_domain: 'relatorios.agenciacriativa.com.br' }),
      );
    });
  });
});
