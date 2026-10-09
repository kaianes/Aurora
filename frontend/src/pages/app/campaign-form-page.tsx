import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { campaignApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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

const MISSING_FIELD_LABELS: Record<string, string> = {
  budget_amount: 'Orcamento',
  audience_targeting: 'Publico-alvo',
  message: 'Mensagem',
  deliverable_formats: 'Formatos de entrega',
  timeline_start: 'Data de inicio',
  timeline_end: 'Data de fim',
};

interface FormValues {
  name: string;
  budget_amount: string;
  geography: string;
  age_min: string;
  age_max: string;
  interests: string;
  gender: 'any' | 'male' | 'female' | '';
  message: string;
  deliverable_formats: DeliverableFormat[];
  timeline_start: string;
  timeline_end: string;
}

export function CampaignFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [preserved, setPreserved] = useState<Record<string, unknown> | null>(null);

  const { data: campaign, isLoading } = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => campaignApi.get(id!),
    enabled: isEditing,
  });

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      name: '',
      budget_amount: '',
      geography: '',
      age_min: '',
      age_max: '',
      interests: '',
      gender: '',
      message: '',
      deliverable_formats: [],
      timeline_start: '',
      timeline_end: '',
    },
  });

  useEffect(() => {
    if (campaign) {
      reset({
        name: campaign.name,
        budget_amount: campaign.budget_amount ?? '',
        geography: campaign.audience_targeting?.geography?.join(', ') ?? '',
        age_min: campaign.audience_targeting?.age_range?.[0]?.toString() ?? '',
        age_max: campaign.audience_targeting?.age_range?.[1]?.toString() ?? '',
        interests: campaign.audience_targeting?.interests?.join(', ') ?? '',
        gender: campaign.audience_targeting?.gender ?? '',
        message: campaign.message ?? '',
        deliverable_formats: campaign.deliverable_formats ?? [],
        timeline_start: campaign.timeline_start?.slice(0, 10) ?? '',
        timeline_end: campaign.timeline_end?.slice(0, 10) ?? '',
      });
    }
  }, [campaign, reset]);

  const saveMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof buildPayload>) =>
      isEditing ? campaignApi.update(id!, payload) : campaignApi.create(payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['campaign', data.id] });
      setPreserved(null);
      navigate(`/app/campaigns/${data.id}`);
    },
    onError: (err, variables) => {
      // Preserve submitted fields on validation failure (US-05 scenario 3)
      if (isAxiosError(err) && (err.response?.status === 422 || err.response?.status === 400)) {
        setPreserved(variables as unknown as Record<string, unknown>);
      }
    },
  });

  function buildPayload(data: FormValues) {
    const audience_targeting =
      data.geography || data.interests || data.age_min || data.age_max || data.gender
        ? {
            ...(data.geography ? { geography: data.geography.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
            ...(data.interests ? { interests: data.interests.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
            ...(data.age_min && data.age_max
              ? { age_range: [Number(data.age_min), Number(data.age_max)] as [number, number] }
              : {}),
            ...(data.gender ? { gender: data.gender } : {}),
          }
        : undefined;

    return {
      name: data.name,
      budget_amount: data.budget_amount || undefined,
      budget_currency: 'BRL',
      audience_targeting,
      message: data.message || undefined,
      deliverable_formats: data.deliverable_formats.length ? data.deliverable_formats : undefined,
      timeline_start: data.timeline_start ? `${data.timeline_start}T00:00:00Z` : undefined,
      timeline_end: data.timeline_end ? `${data.timeline_end}T00:00:00Z` : undefined,
    };
  }

  const onSubmit = (data: FormValues) => {
    saveMutation.mutate(buildPayload(data));
  };

  const apiError = saveMutation.error;
  const errorCode = isAxiosError(apiError) ? apiError.response?.data?.error?.code : undefined;
  const errorMessage = isAxiosError(apiError)
    ? apiError.response?.data?.error?.message
    : apiError
      ? 'Nao foi possivel salvar a campanha.'
      : null;

  if (isEditing && isLoading) {
    return <Spinner />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <CardTitle>{isEditing ? 'Editar campanha' : 'Nova campanha'}</CardTitle>
        <CardDescription>
          Defina orcamento, publico, mensagem e formatos uma unica vez. Voce pode salvar como rascunho e
          completar depois.
        </CardDescription>
      </CardHeader>

      {errorMessage && (
        <Alert variant="error">
          {errorMessage}
          {preserved && (
            <span className="block mt-1 text-xs opacity-80">
              {errorCode === 'BUDGET_BELOW_MINIMUM' && 'O orcamento minimo por campanha e R$ 2.000,00.'}
              {errorCode === 'TARGETING_TOO_NARROW' && 'Amplie a geografia ou os interesses selecionados.'}
            </span>
          )}
        </Alert>
      )}

      {campaign && campaign.missing_fields.length > 0 && (
        <Alert variant="warning">
          Campos pendentes antes de solicitar uma cotacao:{' '}
          {campaign.missing_fields.map((f) => MISSING_FIELD_LABELS[f] ?? f).join(', ')}.
        </Alert>
      )}

      <Card>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <Input
            label="Nome da campanha"
            {...register('name', { required: 'Nome e obrigatorio' })}
            error={errors.name?.message}
          />
          <Input
            label="Orcamento (BRL)"
            type="number"
            step="0.01"
            hint="Minimo de R$ 2.000,00 por campanha"
            {...register('budget_amount')}
          />

          <fieldset className="space-y-3 border border-border rounded-lg p-4">
            <legend className="text-sm font-medium text-text-dark px-1">Publico-alvo</legend>
            <Input label="Geografia (separado por virgula)" placeholder="BR-SP, BR-RJ" {...register('geography')} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Idade minima" type="number" {...register('age_min')} />
              <Input label="Idade maxima" type="number" {...register('age_max')} />
            </div>
            <Input label="Interesses (separado por virgula)" placeholder="skincare, beleza natural" {...register('interests')} />
            <Select
              label="Genero"
              placeholder="Selecione"
              options={[
                { value: 'any', label: 'Qualquer' },
                { value: 'male', label: 'Masculino' },
                { value: 'female', label: 'Feminino' },
              ]}
              {...register('gender')}
            />
          </fieldset>

          <Textarea label="Mensagem" placeholder="Brief da campanha" {...register('message')} />

          <Controller
            control={control}
            name="deliverable_formats"
            render={({ field }) => (
              <fieldset className="space-y-2 border border-border rounded-lg p-4">
                <legend className="text-sm font-medium text-text-dark px-1">Formatos de entrega</legend>
                {DELIVERABLE_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 text-sm text-text-dark">
                    <input
                      type="checkbox"
                      checked={field.value.includes(opt.value)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          field.onChange([...field.value, opt.value]);
                        } else {
                          field.onChange(field.value.filter((v) => v !== opt.value));
                        }
                      }}
                    />
                    {opt.label}
                  </label>
                ))}
              </fieldset>
            )}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input label="Inicio" type="date" {...register('timeline_start')} />
            <Input label="Fim" type="date" {...register('timeline_end')} />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" loading={saveMutation.isPending}>
              Salvar rascunho
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
