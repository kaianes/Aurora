import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { templateApi, campaignApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { Campaign } from '@/types/api';

interface FormValues {
  name: string;
  budget_amount: string;
  timeline_start: string;
}

export function TemplateInstantiatePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [createdCampaign, setCreatedCampaign] = useState<Campaign | null>(null);
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: { name: '', budget_amount: '', timeline_start: '' } });

  const instantiateMutation = useMutation({
    mutationFn: (data: FormValues) =>
      templateApi.instantiate(id!, {
        name: data.name,
        budget_amount: data.budget_amount,
        timeline_start: `${data.timeline_start}T00:00:00Z`,
      }),
    onSuccess: (campaign) => {
      setCreatedCampaign(campaign);
      if (!campaign.brand_profile_drift || campaign.brand_profile_drift.length === 0) {
        navigate(`/app/campaigns/${campaign.id}`);
      }
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: () =>
      campaignApi.acknowledgeDrift(createdCampaign!.id, {
        acknowledged_fields: Object.keys(acknowledged).filter((k) => acknowledged[k]),
      }),
    onSuccess: (campaign) => {
      if (!campaign.brand_profile_drift || campaign.brand_profile_drift.length === 0) {
        navigate(`/app/campaigns/${campaign.id}`);
      } else {
        setCreatedCampaign(campaign);
      }
    },
  });

  const onSubmit = (data: FormValues) => instantiateMutation.mutate(data);

  const drift = createdCampaign?.brand_profile_drift ?? [];
  const allAcknowledged = drift.length > 0 && drift.every((f) => acknowledged[f]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <CardTitle>Nova campanha a partir de modelo</CardTitle>
        <CardDescription>
          Preencha o orcamento e a data de inicio. Os demais campos sao herdados do modelo e uma nova cotacao sera
          gerada.
        </CardDescription>
      </CardHeader>

      {!drift.length ? (
        <Card>
          {instantiateMutation.error && (
            <Alert variant="error" className="mb-4">
              {isAxiosError(instantiateMutation.error) && instantiateMutation.error.response?.data?.error?.message
                ? instantiateMutation.error.response.data.error.message
                : 'Nao foi possivel criar a campanha a partir do modelo.'}
            </Alert>
          )}
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <Input label="Nome da campanha" {...register('name', { required: 'Nome e obrigatorio' })} error={errors.name?.message} />
            <Input
              label="Orcamento (BRL)"
              type="number"
              step="0.01"
              {...register('budget_amount', { required: 'Orcamento e obrigatorio' })}
              error={errors.budget_amount?.message}
            />
            <Input
              label="Data de inicio"
              type="date"
              {...register('timeline_start', { required: 'Data de inicio e obrigatoria' })}
              error={errors.timeline_start?.message}
            />
            <Button type="submit" loading={instantiateMutation.isPending}>
              Criar campanha
            </Button>
          </form>
        </Card>
      ) : (
        <Card>
          <Alert variant="warning" className="mb-4">
            O perfil da marca mudou desde que este modelo foi salvo. Confirme os campos abaixo antes de solicitar uma
            cotacao.
          </Alert>
          <div className="space-y-2 mb-4">
            {drift.map((field) => (
              <label key={field} className="flex items-center gap-2 text-sm text-text-dark">
                <input
                  type="checkbox"
                  checked={!!acknowledged[field]}
                  onChange={(e) => setAcknowledged((prev) => ({ ...prev, [field]: e.target.checked }))}
                />
                Confirmo o campo <span className="font-mono">{field}</span> com as configuracoes atuais do perfil
              </label>
            ))}
          </div>
          <Button
            disabled={!allAcknowledged}
            loading={acknowledgeMutation.isPending}
            onClick={() => acknowledgeMutation.mutate()}
          >
            Confirmar e continuar
          </Button>
          {acknowledgeMutation.error && (
            <Alert variant="error" className="mt-3">
              Nao foi possivel confirmar as alteracoes do perfil.
            </Alert>
          )}
        </Card>
      )}
    </div>
  );
}
