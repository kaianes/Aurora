import { IsBoolean, IsNumber, Max, Min } from 'class-validator';

export class ReallocationBoundsDto {
  @IsBoolean()
  enabled: boolean;

  @IsNumber()
  @Min(0, { message: 'max_shift_pct deve estar entre 0 e 30.' })
  @Max(30, { message: 'max_shift_pct deve estar entre 0 e 30.' })
  max_shift_pct: number;

  @IsNumber()
  @Min(40, { message: 'min_guaranteed_share_pct deve estar entre 40 e 100.' })
  @Max(100, { message: 'min_guaranteed_share_pct deve estar entre 40 e 100.' })
  min_guaranteed_share_pct: number;
}
