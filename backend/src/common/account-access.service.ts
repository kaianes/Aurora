import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, Membership, OperatorClientAccess, Role } from '../database/entities';

export interface JwtMembership {
  account_id: string;
  role: Role;
}

// Resolves whether a user can act on a given account and, if so, with which
// role. Direct membership (the common case: a brand's own account, or an
// agency's own home account) is checked first, against the JWT's own
// membership list -- no DB round trip needed.
//
// An agency acting on one of its OWN client accounts is the exception: no
// Membership row exists on the client account itself (agency.service.ts's
// createClient never creates one). An agency_admin has implicit access to
// every client account in their own workspace; an agency_operator only has
// access to a client account they were explicitly granted via
// grantOperatorAccess, recorded in operator_client_access keyed by their
// membership on the agency's home account (not the client account).
@Injectable()
export class AccountAccessService {
  constructor(
    @InjectRepository(Account)
    private accountRepo: Repository<Account>,
    @InjectRepository(Membership)
    private membershipRepo: Repository<Membership>,
    @InjectRepository(OperatorClientAccess)
    private operatorAccessRepo: Repository<OperatorClientAccess>,
  ) {}

  async resolveAccess(
    userId: string,
    memberships: JwtMembership[],
    accountId: string | undefined,
  ): Promise<Role | null> {
    if (!accountId) return null;

    const direct = memberships.find((m) => m.account_id === accountId);
    if (direct) return direct.role;

    const agencyMemberships = memberships.filter(
      (m) => m.role === Role.AGENCY_ADMIN || m.role === Role.AGENCY_OPERATOR,
    );
    if (agencyMemberships.length === 0) return null;

    const targetAccount = await this.accountRepo.findOne({ where: { id: accountId } });
    if (!targetAccount) return null;

    for (const agencyMembership of agencyMemberships) {
      const homeAccount = await this.accountRepo.findOne({
        where: { id: agencyMembership.account_id },
      });
      if (!homeAccount || homeAccount.workspaceId !== targetAccount.workspaceId) continue;

      if (agencyMembership.role === Role.AGENCY_ADMIN) {
        return Role.AGENCY_ADMIN;
      }

      const homeMembership = await this.membershipRepo.findOne({
        where: { userId, accountId: agencyMembership.account_id },
      });
      if (!homeMembership) continue;

      const grant = await this.operatorAccessRepo.findOne({
        where: { membershipId: homeMembership.id, accountId },
      });
      if (grant) return Role.AGENCY_OPERATOR;
    }

    return null;
  }
}
