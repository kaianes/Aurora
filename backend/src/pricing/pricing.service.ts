import { Injectable } from '@nestjs/common';

@Injectable()
export class PricingService {
  // Pricing data as specified in the architecture contract.
  // In a full implementation this would be stored in the database and cached in Redis.
  // For E1, the pricing is static and returned directly.
  private readonly pricingData = {
    updated_at: '2026-09-01T00:00:00Z',
    plans: [
      {
        workspace_type: 'brand',
        name: 'Brand',
        platform_fee: {
          amount: '497.00',
          currency: 'BRL',
          interval: 'month',
        },
        commission: {
          rate: '0.15',
          description: '15% sobre o valor pago aos criadores',
        },
        features: [
          '1 workspace de marca',
          'Ate 3 membros da equipe',
          'Perfil de marca completo',
          'Campanhas ilimitadas',
        ],
      },
      {
        workspace_type: 'agency',
        name: 'Agencia',
        platform_fee: {
          amount: '1497.00',
          currency: 'BRL',
          interval: 'month',
        },
        commission: {
          rate: '0.12',
          description: '12% sobre o valor pago aos criadores',
        },
        features: [
          '1 workspace de agencia',
          'Ate 10 contas de clientes',
          'Ate 10 membros da equipe',
          'Templates reutilizaveis entre clientes',
        ],
        client_account_limit: 10,
      },
    ],
  };

  async getPricing() {
    return this.pricingData;
  }
}
