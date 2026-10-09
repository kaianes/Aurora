import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ReallocationBoundsDto } from './reallocation-bounds.dto';

// ADR-0007: max_shift_pct in 0-30, min_guaranteed_share_pct in 40-100.
describe('ReallocationBoundsDto', () => {
  it('accepts values within the system-enforced ranges', async () => {
    const dto = plainToInstance(ReallocationBoundsDto, {
      enabled: true,
      max_shift_pct: 20,
      min_guaranteed_share_pct: 50,
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('rejects max_shift_pct above 30', async () => {
    const dto = plainToInstance(ReallocationBoundsDto, {
      enabled: true,
      max_shift_pct: 50,
      min_guaranteed_share_pct: 50,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects min_guaranteed_share_pct below 40', async () => {
    const dto = plainToInstance(ReallocationBoundsDto, {
      enabled: true,
      max_shift_pct: 10,
      min_guaranteed_share_pct: 10,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
