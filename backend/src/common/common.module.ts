import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account, Membership, OperatorClientAccess } from '../database/entities';
import { AccountAccessService } from './account-access.service';

// Global so AccountAccessService is injectable into RolesGuard, which is
// registered via APP_GUARD in AppModule's own injector context and so can
// only resolve providers that are either declared there directly or exported
// by a @Global() module imported there (the same pattern AuditModule uses).
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Account, Membership, OperatorClientAccess])],
  providers: [AccountAccessService],
  exports: [AccountAccessService],
})
export class CommonModule {}
