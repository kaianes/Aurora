import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { creatorPortalApi, getCreatorToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { DeliverableFormat } from '@/types/api';

const DELIVERABLE_OPTIONS: { value: DeliverableFormat; label: string }[] = [
  { value: 'instagram_reel', label: 'Instagram Reel' },
  { value: 'instagram_story', label: 'Instagram Story' },
  { value: 'instagram_post', label: 'Instagram Post' },
  { value: 'tiktok_video', label: 'TikTok Video' },
  { value: 'youtube_short', label: 'YouTube Short' },
];

const DELIVERABLE_LABEL: Record<string, string> = Object.fromEntries(
  DELIVERABLE_OPTIONS.map((o) => [o.value, o.label]),
);

// ADR-0058's pilot-scoped bound (section 2.5): rate_amount > 0 and <= 50000.
const rateSchema = z.object({
  deliverable_format: z.string().min(1, 'Selecione um formato'),
  rate_amount: z
    .string()
    .min(1, 'Informe um valor')
    .refine((v) => !Number.isNaN(Number(v)), 'Valor invalido')
    .refine((v) => Number(v) > 0, 'O valor deve ser maior que zero')
    .refine((v) => Number(v) <= 50000, 'O valor maximo permitido e R$ 50.000,00'),
});

type RateForm = z.infer<typeof rateSchema>;

function formatCurrency(amount: string) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(amount));
}

/**
 * Duda's own rate per deliverable format (US-27): an input to the payout figures an
 * opportunity for that format will show her, never retroactive to an opportunity already
 * created. Per docs/architecture/e8-creator-recruitment-growth.md section 7.
 */
export function RatePreferencesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [savedFormat, setSavedFormat] = useState<string | null>(null);

  useEffect(() => {
    if (!getCreatorToken()) {
      navigate('/creator-portal/login');
    }
  }, [navigate]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['creator-rate-preferences'],
    queryFn: () => creatorPortalApi.listRatePreferences(),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RateForm>({
    resolver: zodResolver(rateSchema),
    defaultValues: { deliverable_format: '', rate_amount: '' },
  });

  const mutation = useMutation({
    mutationFn: (data: RateForm) =>
      creatorPortalApi.setRatePreference(data.deliverable_format, { rate_amount: data.rate_amount, currency: 'BRL' }),
    onSuccess: (result) => {
      setSavedFormat(result.deliverable_format);
      reset({ deliverable_format: '', rate_amount: '' });
      queryClient.invalidateQueries({ queryKey: ['creator-rate-preferences'] });
    },
  });

  const onSubmit = (data: RateForm) => mutation.mutate(data);

  const errorCode = isAxiosError(mutation.error) ? mutation.error.response?.data?.error?.code : null;
  const errorMessage =
    mutation.error && isAxiosError(mutation.error) && mutation.error.response?.data?.error?.message
      ? mutation.error.response.data.error.message
      : mutation.isError
        ? errorCode === 'INVALID_RATE'
          ? 'Valor invalido. O valor deve ser maior que zero e no maximo R$ 50.000,00.'
          : 'Nao foi possivel salvar essa preferencia agora.'
        : null;

  const preferences = data?.data ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <CardTitle>Suas preferencias de valor</CardTitle>
        <CardDescription>
          Defina o valor que voce quer receber por formato de entrega. A mudanca vale apenas para
          novas oportunidades -- qualquer oportunidade ja criada mantem o valor original.
        </CardDescription>
      </CardHeader>

      <Card>
        {errorMessage && (
          <Alert variant="error" className="mb-4">
            {errorMessage}
          </Alert>
        )}
        {savedFormat && !mutation.isPending && (
          <Alert variant="success" className="mb-4">
            Valor salvo para {DELIVERABLE_LABEL[savedFormat] ?? savedFormat}. Vale a partir de agora,
            para novas oportunidades.
          </Alert>
        )}
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1">
            <Select
              label="Formato"
              options={DELIVERABLE_OPTIONS}
              placeholder="Selecione um formato"
              {...register('deliverable_format')}
              error={errors.deliverable_format?.message}
            />
          </div>
          <div className="flex-1">
            <Input
              label="Valor (BRL)"
              inputMode="decimal"
              placeholder="350.00"
              {...register('rate_amount')}
              error={errors.rate_amount?.message}
            />
          </div>
          <Button type="submit" loading={mutation.isPending}>
            Salvar
          </Button>
        </form>
      </Card>

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <Alert variant="error">Nao foi possivel carregar suas preferencias agora.</Alert>
      ) : preferences.length === 0 ? (
        <Card>
          <p className="text-sm text-muted py-6 text-center">Voce ainda nao definiu nenhum valor.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {preferences.map((pref) => (
            <Card key={pref.deliverable_format}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-text-dark">
                  {DELIVERABLE_LABEL[pref.deliverable_format] ?? pref.deliverable_format}
                </p>
                <p className="font-mono text-sm text-text-dark">{formatCurrency(pref.rate_amount)}</p>
              </div>
              <p className="text-xs text-muted mt-1">
                Atualizado em {new Date(pref.updated_at).toLocaleString('pt-BR')} · vale apenas para
                novas oportunidades
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
