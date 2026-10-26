// Postgres unique_violation. Used to make obligation/tax-document creation
// idempotent under a concurrent/retried insert, without a prior
// SELECT-then-INSERT race window.
export function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as any).code === '23505';
}
