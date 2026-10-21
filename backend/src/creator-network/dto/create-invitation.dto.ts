import { IsEmail } from 'class-validator';

// POST /ops/creators/:id/invitations (US-23.2, section 4.2 of the E8
// architecture doc). An unclaimed profile carries no verified contact
// channel of its own -- this is the first point a contact address enters
// the system at all.
export class CreateInvitationDto {
  @IsEmail({}, { message: 'Formato de email invalido.' })
  contact_email: string;
}
