import { IsUUID } from 'class-validator';

// US-41 / FR-22, section 4.2 of the E9 architecture document.
export class CopyTemplateDto {
  @IsUUID('4', { message: 'ID de conta de destino invalido.' })
  target_account_id: string;
}
