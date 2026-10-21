// Same signed-short-lived-URL-over-object-storage pattern E6/E7 already
// established (ADR-0042), reused here. A small, local equivalent of
// analytics' buildReportDocumentUrl rather than importing across a module
// boundary for a plain formatting helper -- the only cross-module
// dependency ADR-0057 introduces is the one exported analytics method.
export function buildMediaKitDocumentUrl(exportId: string): string {
  const s3Key = `media-kits/${exportId}/kit.pdf`;
  const baseUrl = process.env.S3_PUBLIC_URL || 'https://assets.aurora.com.br';
  return `${baseUrl}/${s3Key}`;
}
