import { SetMetadata } from '@nestjs/common';

// Marks a route (or an entire controller) as creator-portal-only: its real
// authorization is CreatorAuthGuard's job, applied at the same call site, not
// RolesGuard's. Creators carry no Membership row and no currentAccountId, so
// RolesGuard has nothing to resolve for these routes and must not fall
// through to its default "no account context" denial for them (ADR-0064).
//
// Every call site that carries @UseGuards(CreatorAuthGuard) must also carry
// this decorator, at the same level (class or method). A route decorated
// with CreatorAuthGuard but not this decorator fails closed for creators
// (RolesGuard denies with no_account_context) rather than failing open --
// the correct direction for a missing decorator here.
export const CREATOR_PORTAL_ROUTE_KEY = 'creatorPortalRoute';
export const CreatorPortalRoute = () => SetMetadata(CREATOR_PORTAL_ROUTE_KEY, true);
