import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { agencyApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { canManageAgencyBranding } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
// Lowercase, RFC 1123-compatible hostname: labels of letters/digits/hyphens (no leading or
// trailing hyphen), at least one dot, matching the backend's own format-only validation
// (no DNS lookup, no ownership proof) per ADR-0061.
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

const brandingSchema = z.object({
  logo_url: z.string().max(2048, 'URL muito longa (maximo de 2048 caracteres)'),
  primary_color_hex: z.string().refine((v) => v === '' || HEX_RE.test(v), {
    message: 'Use o formato hexadecimal #RRGGBB.',
  }),
  secondary_color_hex: z.string().refine((v) => v === '' || HEX_RE.test(v), {
    message: 'Use o formato hexadecimal #RRGGBB.',
  }),
  custom_domain: z.string().refine((v) => v === '' || DOMAIN_RE.test(v), {
    message: 'Use um dominio valido, em letras minusculas (ex: relatorios.suaagencia.com.br).',
  }),
});

type BrandingForm = z.infer<typeof brandingSchema>;

/** Small colored data point used as a motif accent, on a thin grid line. */
function MetricDot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full mr-2" style={{ backgroundColor: color }} />;
}

/**
 * Agency branding profile (ADR-0048, section 2.3 of the E7 architecture doc): the logo and
 * two colors Renata's per-client reports (US-43) render under when branding_applied is true.
 * Restricted to agency_admin, matching the backend's @Roles() on both GET and PUT
 * /agency/branding. Closes the gap flagged when E7's frontend was first built, where this
 * page did not yet exist because no write API contract did either.
 */
export function AgencyBrandingPage() {
  const { currentRole } = useAuth();
  const queryClient = useQueryClient();
  const [saveSuccess, setSaveSuccess] = useState(false);

  const canManage = currentRole ? canManageAgencyBranding(currentRole) : false;

  const { data: profile, isLoading, error } = useQuery({
    queryKey: ['agency-branding'],
    queryFn: () => agencyApi.getBranding(),
    enabled: canManage,
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<BrandingForm>({
    resolver: zodResolver(brandingSchema),
    defaultValues: { logo_url: '', primary_color_hex: '', secondary_color_hex: '', custom_domain: '' },
  });

  useEffect(() => {
    if (profile) {
      reset({
        logo_url: profile.logo_url ?? '',
        primary_color_hex: profile.primary_color_hex ?? '',
        secondary_color_hex: profile.secondary_color_hex ?? '',
        custom_domain: profile.custom_domain ?? '',
      });
    }
  }, [profile, reset]);

  const saveMutation = useMutation({
    mutationFn: (data: BrandingForm) =>
      agencyApi.configureBranding({
        logo_url: data.logo_url || undefined,
        primary_color_hex: data.primary_color_hex || undefined,
        secondary_color_hex: data.secondary_color_hex || undefined,
        custom_domain: data.custom_domain || undefined,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['agency-branding'], data);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
  });

  const onSubmit = (data: BrandingForm) => saveMutation.mutate(data);

  const logoUrl = watch('logo_url');
  const primaryColor = watch('primary_color_hex');
  const secondaryColor = watch('secondary_color_hex');

  const saveErrorMessage =
    saveMutation.error && isAxiosError(saveMutation.error) && saveMutation.error.response?.data?.error?.message
      ? saveMutation.error.response.data.error.message
      : saveMutation.error
        ? 'Nao foi possivel salvar a marca da agencia.'
        : null;

  if (!canManage) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <CardHeader>
          <CardTitle>Marca da Agencia</CardTitle>
        </CardHeader>
        <Alert variant="warning">
          Apenas administradores da agencia podem ver e configurar a marca usada nos relatorios de clientes.
        </Alert>
      </div>
    );
  }

  if (isLoading) {
    return <Spinner />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <CardTitle>Marca da Agencia</CardTitle>
        <CardDescription>
          Configure o logo e as cores que aparecem nos relatorios de desempenho entregues aos seus clientes.
        </CardDescription>
      </CardHeader>

      {saveSuccess && <Alert variant="success">Marca da agencia salva com sucesso.</Alert>}
      {saveErrorMessage && <Alert variant="error">{saveErrorMessage}</Alert>}
      {error && (
        <Alert variant="error">
          {isAxiosError(error) && error.response?.data?.error?.message
            ? error.response.data.error.message
            : 'Nao foi possivel carregar a marca da agencia.'}
        </Alert>
      )}

      <Card>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
          <div className="flex items-center gap-4">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt="Logo da agencia"
                className="h-16 w-16 rounded-lg object-cover border border-border"
              />
            ) : (
              <div className="h-16 w-16 rounded-lg bg-surface border border-border flex items-center justify-center text-muted text-xs">
                Sem logo
              </div>
            )}
            <div className="flex-1">
              <Input
                label="URL do logo"
                placeholder="https://..."
                {...register('logo_url')}
                error={errors.logo_url?.message}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-dark mb-1" htmlFor="primary_color_hex">
                Cor primaria
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Selecionar cor primaria"
                  value={HEX_RE.test(primaryColor) ? primaryColor : '#000000'}
                  onChange={(e) => setValue('primary_color_hex', e.target.value, { shouldDirty: true })}
                  className="h-10 w-10 rounded border border-border cursor-pointer"
                />
                <input
                  id="primary_color_hex"
                  type="text"
                  placeholder="#3DDC97"
                  {...register('primary_color_hex')}
                  className={`block w-full rounded-lg border px-3 py-2 text-sm font-mono transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                    errors.primary_color_hex
                      ? 'border-error text-error focus:ring-error/50'
                      : 'border-border text-text-dark focus:border-primary focus:ring-primary/50'
                  }`}
                />
              </div>
              {errors.primary_color_hex && (
                <p className="mt-1 text-sm text-error" role="alert">
                  {errors.primary_color_hex.message}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-text-dark mb-1" htmlFor="secondary_color_hex">
                Cor secundaria
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Selecionar cor secundaria"
                  value={HEX_RE.test(secondaryColor) ? secondaryColor : '#000000'}
                  onChange={(e) => setValue('secondary_color_hex', e.target.value, { shouldDirty: true })}
                  className="h-10 w-10 rounded border border-border cursor-pointer"
                />
                <input
                  id="secondary_color_hex"
                  type="text"
                  placeholder="#7F77DD"
                  {...register('secondary_color_hex')}
                  className={`block w-full rounded-lg border px-3 py-2 text-sm font-mono transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                    errors.secondary_color_hex
                      ? 'border-error text-error focus:ring-error/50'
                      : 'border-border text-text-dark focus:border-primary focus:ring-primary/50'
                  }`}
                />
              </div>
              {errors.secondary_color_hex && (
                <p className="mt-1 text-sm text-error" role="alert">
                  {errors.secondary_color_hex.message}
                </p>
              )}
            </div>
          </div>

          {/* US-44 (E9): custom domain, format-validated only (no DNS lookup, no ownership
              proof in this pilot, ADR-0061). Every request this epic serves, including the
              public share-link view, continues to be served at Aurora's own domain -- this
              field is for display/reference only until Aurora's infrastructure team activates
              it, never implying real-time self-service activation. */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-text-dark" htmlFor="custom_domain">
                Dominio personalizado
              </label>
              {profile?.domain_status === 'pending_activation' && (
                <Badge variant="warning">Ativacao pendente</Badge>
              )}
            </div>
            <Input
              id="custom_domain"
              placeholder="relatorios.suaagencia.com.br"
              {...register('custom_domain')}
              error={errors.custom_domain?.message}
            />
            <p className="mt-1 text-xs text-muted">
              Esse dominio e exibido para referencia da sua equipe ao compartilhar relatorios com
              clientes. A ativacao real (DNS e certificado) depende da equipe de infraestrutura
              da Aurora e nao acontece automaticamente ao salvar.
            </p>
          </div>

          {/* Preview strip: brand motif, colored data points on a thin horizontal grid */}
          <div className="border-t border-b border-border py-3">
            <p className="flex items-center font-mono text-xs text-muted">
              <MetricDot color={HEX_RE.test(primaryColor) ? primaryColor : '#3DDC97'} />
              Cor primaria {HEX_RE.test(primaryColor) ? primaryColor.toUpperCase() : '(nao definida)'}
            </p>
            <p className="flex items-center font-mono text-xs text-muted mt-1">
              <MetricDot color={HEX_RE.test(secondaryColor) ? secondaryColor : '#7F77DD'} />
              Cor secundaria {HEX_RE.test(secondaryColor) ? secondaryColor.toUpperCase() : '(nao definida)'}
            </p>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" loading={saveMutation.isPending} disabled={!isDirty}>
              Salvar marca
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
