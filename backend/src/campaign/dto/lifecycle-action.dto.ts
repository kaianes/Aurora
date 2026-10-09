import { IsString, IsOptional } from 'class-validator';

// Shared shape for pause/cancel requests.
export class LifecycleActionDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
