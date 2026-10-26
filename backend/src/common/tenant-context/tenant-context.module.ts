import { Global, Module } from '@nestjs/common';
import { TenantContextRunner } from './tenant-context.runner';
import { TenantContextInterceptor } from '../interceptors/tenant-context.interceptor';

// Global for the same reason CommonModule is (ADR-0063): TenantContextInterceptor
// is registered via APP_INTERCEPTOR in AppModule's own injector context, and
// APP_INTERCEPTOR, like APP_GUARD, can only resolve providers declared there
// directly or exported by a @Global() module imported there.
@Global()
@Module({
  providers: [TenantContextRunner, TenantContextInterceptor],
  exports: [TenantContextRunner, TenantContextInterceptor],
})
export class TenantContextModule {}
