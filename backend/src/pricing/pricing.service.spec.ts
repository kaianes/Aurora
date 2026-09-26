import { describe, it, expect, beforeEach } from 'vitest';
import { PricingService } from './pricing.service';

describe('PricingService - US-02 Transparent Pricing', () => {
  let service: PricingService;

  beforeEach(() => {
    service = new PricingService();
  });

  // US-02 Scenario 1 - Normal: pricing page visible pre-login (no auth required)
  it('should return complete fee model without authentication', async () => {
    const pricing = await service.getPricing();

    expect(pricing).toBeDefined();
    expect(pricing.plans).toBeDefined();
    expect(pricing.plans.length).toBeGreaterThan(0);

    // Each plan should have platform_fee and commission
    for (const plan of pricing.plans) {
      expect(plan.platform_fee).toBeDefined();
      expect(plan.platform_fee.amount).toBeDefined();
      expect(plan.platform_fee.currency).toBeDefined();
      expect(plan.commission).toBeDefined();
      expect(plan.commission.rate).toBeDefined();
      expect(plan.features).toBeDefined();
      expect(plan.features.length).toBeGreaterThan(0);
    }
  });

  // US-02 Scenario 2 - Hard: both workspace types shown with differences
  it('should return both brand and agency plans with distinct pricing', async () => {
    const pricing = await service.getPricing();

    const brandPlan = pricing.plans.find((p: any) => p.workspace_type === 'brand');
    const agencyPlan = pricing.plans.find((p: any) => p.workspace_type === 'agency');

    expect(brandPlan).toBeDefined();
    expect(agencyPlan).toBeDefined();

    // They should have different fee amounts
    expect(brandPlan!.platform_fee.amount).not.toBe(agencyPlan!.platform_fee.amount);

    // They should have different commission rates
    expect(brandPlan!.commission.rate).not.toBe(agencyPlan!.commission.rate);

    // Agency should have client_account_limit
    expect(agencyPlan!.client_account_limit).toBeDefined();
  });
});
