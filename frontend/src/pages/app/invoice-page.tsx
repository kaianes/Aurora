import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { campaignApi, invoiceApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { canGenerateInvoice } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { InvoiceLineItem } from '@/types/api';

function formatCurrency(amount: string) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(amount));
}

const LINE_TYPE_LABEL: Record<InvoiceLineItem['line_type'], string> = {
  base_price: 'Preco base',
  shortfall_refund_adjustment: 'Ajuste de reembolso (pool abaixo do minimo)',
};

/**
 * Consolidated campaign invoice (US-20 direct brand buyer, US-42 agency client -- no shape
 * difference between the two, ADR-0040): one invoice per campaign, the fixed total price plus
 * any itemized FR-19 refund adjustment, generated explicitly once the pool has settled.
 */
export function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { currentRole } = useAuth();
  const canGenerate = currentRole ? canGenerateInvoice(currentRole) : false;

  const { data: campaign, isLoading: isLoadingCampaign } = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => campaignApi.get(id!),
    enabled: !!id,
  });

  const { data: invoice, isLoading: isLoadingInvoice, error: invoiceError } = useQuery({
    queryKey: ['campaign-invoice', id],
    queryFn: () => invoiceApi.get(id!),
    enabled: !!id,
  });

  const generateMutation = useMutation({
    mutationFn: () => invoiceApi.generate(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign-invoice', id] });
    },
    onError: (err) => {
      // 409 INVOICE_ALREADY_GENERATED: someone else already generated it -- refetch rather
      // than treat this as a failure the user needs to act on.
      if (isAxiosError(err) && err.response?.data?.error?.code === 'INVOICE_ALREADY_GENERATED') {
        queryClient.invalidateQueries({ queryKey: ['campaign-invoice', id] });
      }
    },
  });

  if (isLoadingCampaign || isLoadingInvoice) return <Spinner />;
  if (invoiceError) return <Alert variant="error">Nao foi possivel carregar a fatura desta campanha.</Alert>;

  const generateErrorCode =
    isAxiosError(generateMutation.error) ? generateMutation.error.response?.data?.error?.code : undefined;
  const generateErrorDetails =
    isAxiosError(generateMutation.error) ? generateMutation.error.response?.data?.error?.details : undefined;
  const generateErrorMessage =
    isAxiosError(generateMutation.error) ? generateMutation.error.response?.data?.error?.message : undefined;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <CardTitle>Fatura</CardTitle>
        <CardDescription>{campaign?.name ?? 'Campanha'}</CardDescription>
      </CardHeader>

      {!invoice ? (
        <Card>
          <p className="text-sm text-text-dark mb-4">
            Nenhuma fatura foi gerada ainda para esta campanha. Uma fatura unica cobre o preco fixo de toda a
            campanha, incluindo qualquer reembolso aplicavel.
          </p>

          {generateErrorCode === 'CAMPAIGN_NOT_BILLABLE' && (
            <Alert variant="warning" className="mb-4">
              {generateErrorMessage ?? 'A campanha ainda tem oportunidades pendentes de resposta.'}
              {typeof generateErrorDetails?.pending_opportunities === 'number' && (
                <span className="font-mono"> ({generateErrorDetails.pending_opportunities} pendentes)</span>
              )}
            </Alert>
          )}

          {generateMutation.isError && generateErrorCode !== 'CAMPAIGN_NOT_BILLABLE' && generateErrorCode !== 'INVOICE_ALREADY_GENERATED' && (
            <Alert variant="error" className="mb-4">
              {generateErrorMessage ?? 'Nao foi possivel gerar a fatura agora.'}
            </Alert>
          )}

          {canGenerate ? (
            <Button onClick={() => generateMutation.mutate()} loading={generateMutation.isPending}>
              Gerar fatura
            </Button>
          ) : (
            <p className="text-sm text-muted">
              Apenas quem gerencia esta conta pode gerar a fatura desta campanha.
            </p>
          )}
        </Card>
      ) : (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-text-dark">Fatura #{invoice.id}</h3>
            <p className="font-mono text-xs text-muted">
              Emitida em {new Date(invoice.issued_at).toLocaleDateString('pt-BR')}
            </p>
          </div>

          <div className="space-y-2 border-t border-border pt-3">
            {invoice.line_items.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <div>
                  <p className="text-text-dark">{LINE_TYPE_LABEL[item.line_type] ?? item.line_type}</p>
                  <p className="text-xs text-muted">{item.description}</p>
                </div>
                <p className={`font-mono ${Number(item.amount) < 0 ? 'text-error' : 'text-text-dark'}`}>
                  {formatCurrency(item.amount)}
                </p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-border mt-4 pt-4">
            <p className="text-sm font-semibold text-text-dark">Total</p>
            <p className="font-mono text-xl text-text-dark">{formatCurrency(invoice.total_amount)}</p>
          </div>
        </Card>
      )}

      <Button variant="ghost" size="sm" onClick={() => navigate(`/app/campaigns/${id}`)}>
        Voltar para a campanha
      </Button>
    </div>
  );
}
