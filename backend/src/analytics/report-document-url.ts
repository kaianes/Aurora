// Same signed-short-lived-URL-over-object-storage pattern E6's tax-document
// generation already established (ADR-0042), reused here for both the
// single-campaign and the per-client report. No real PDF/CSV rendering
// engine or S3 client exists in this pilot's dependency graph yet; the URL
// shape itself is the contract the frontend route map (section 7 of the E7
// architecture document) and the API contracts (section 5.3/5.5) commit to.
export function buildReportDocumentUrl(
  prefix: string,
  reportId: string,
  extension: 'pdf' | 'csv',
): string {
  const s3Key = `${prefix}/${reportId}/report.${extension}`;
  const baseUrl = process.env.S3_PUBLIC_URL || 'https://assets.aurora.com.br';
  return `${baseUrl}/${s3Key}`;
}
