// Matching weights and authenticity thresholds live in a typed config
// object, not the database, so they can be tuned without a migration
// (ADR-0011, ADR-0017, NFR-29).
export const MATCHING_WEIGHTS = {
  audienceAttributeMatch: 0.4,
  authenticity: 0.25,
  engagementPercentile: 0.2,
  historicalReliability: 0.15,
};

export const AUTHENTICITY_THRESHOLDS = {
  low: 50,
  review: 70,
};

export function authenticityFlag(score: number | null): 'low' | 'review' | 'none' {
  if (score === null) return 'none';
  if (score < AUTHENTICITY_THRESHOLDS.low) return 'low';
  if (score < AUTHENTICITY_THRESHOLDS.review) return 'review';
  return 'none';
}
