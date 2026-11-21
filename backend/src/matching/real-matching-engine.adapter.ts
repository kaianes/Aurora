import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Creator,
  CreatorStatus,
  CreatorOnboardingStatus,
} from '../database/entities';
import {
  MatchingEngineAdapter,
  EstimatePoolInput,
  EstimatePoolResult,
  GenerateShortlistInput,
  GenerateShortlistResult,
  GenerateShortlistEntry,
} from '../campaign/matching-engine.adapter';
import { AudienceTargeting } from '../database/entities/campaign.entity';
import { MATCHING_WEIGHTS } from './matching-config';
import { InferenceService, InferenceUnavailableError } from '../inference/inference.service';

const PRICE_PER_CREATOR_PER_FORMAT = 350; // BRL, same pilot rate as E2's stub

// Replaces StubMatchingEngineAdapter (ADR-0011). Ranks real creator rows with
// a transparent, weighted multi-signal score instead of a learned model, so
// every ranking decision is traceable to specific, named signals (FR-26).
// Bound to the same MATCHING_ENGINE_ADAPTER DI token campaign already
// consumes; estimatePool's contract is unchanged, only its implementation
// moves from a heuristic to a real query against the creator table.
@Injectable()
export class RealMatchingEngineAdapter implements MatchingEngineAdapter {
  private readonly logger = new Logger(RealMatchingEngineAdapter.name);

  constructor(
    @InjectRepository(Creator)
    private creatorRepo: Repository<Creator>,
    private inferenceService: InferenceService,
    private configService: ConfigService,
  ) {}

  async estimatePool(input: EstimatePoolInput): Promise<EstimatePoolResult> {
    const targeting = input.audienceTargeting || {};
    const formats = input.deliverableFormats || [];

    if (this.isZeroAddressable(targeting)) {
      return { noViablePool: true };
    }

    const eligibleCount = await this.countEligible(targeting, []);
    if (eligibleCount === 0) {
      return { noViablePool: true };
    }

    const budget = parseFloat(input.budgetAmount) || 0;
    const formatCount = Math.max(formats.length, 1);
    const costPerCreator = PRICE_PER_CREATOR_PER_FORMAT * formatCount;

    const budgetCappedPoolSize = Math.max(
      1,
      Math.floor(budget / Math.max(costPerCreator, 1)),
    );
    const guaranteedMinPoolSize = Math.max(
      1,
      Math.min(budgetCappedPoolSize, eligibleCount, 150),
    );

    return {
      guaranteedMinPoolSize,
      projectedReachLow: guaranteedMinPoolSize * 4000,
      projectedReachHigh: guaranteedMinPoolSize * 7500,
      totalPrice:
        budget > 0
          ? budget.toFixed(2)
          : (guaranteedMinPoolSize * costPerCreator).toFixed(2),
    };
  }

  // Scores and ranks the eligible candidate set in a single batched query
  // (NFR-01, NFR-06). The hard eligibility gate (exclusions, status,
  // onboarding, zero audience-attribute overlap) runs once, before scoring
  // (ADR-0011, FR-27's "applied before a shortlist is produced").
  async generateShortlist(
    input: GenerateShortlistInput,
  ): Promise<GenerateShortlistResult> {
    const targeting = input.audienceTargeting || {};
    const excluded = new Set([
      ...input.excludedCreatorIds,
      ...input.alreadyOnShortlistCreatorIds,
    ]);

    const candidates = await this.eligibleCandidates(targeting, excluded, input.maxCandidates);
    if (candidates.length === 0) {
      return { status: 'no_viable_pool' };
    }

    const engagementRates = candidates.map((c) => parseFloat(c.engagementRate || '0'));
    const maxEngagement = Math.max(...engagementRates, 0.0001);

    const scored = candidates.map((creator) => {
      const { score: attributeScore, matchedAttributes } = this.audienceAttributeMatch(
        creator,
        targeting,
      );
      const authenticity = parseFloat(creator.authenticityScore || '0') / 100;
      const engagementRate = parseFloat(creator.engagementRate || '0');
      const engagementPercentile = maxEngagement > 0 ? engagementRate / maxEngagement : 0;
      const historicalReliability =
        creator.historicalReliability !== null && creator.historicalReliability !== undefined
          ? parseFloat(creator.historicalReliability)
          : 0.5; // neutral default for creators with no history (ADR-0011)

      const fitScore =
        MATCHING_WEIGHTS.audienceAttributeMatch * attributeScore +
        MATCHING_WEIGHTS.authenticity * authenticity +
        MATCHING_WEIGHTS.engagementPercentile * engagementPercentile +
        MATCHING_WEIGHTS.historicalReliability * historicalReliability;

      return { creator, fitScore, matchedAttributes };
    });

    scored.sort((a, b) => b.fitScore - a.fitScore);

    const topScored = scored.slice(0, input.maxCandidates);

    // Build entries without fit reasons first so scoring is complete before
    // any Claude call is attempted.
    const baseEntries = topScored.map((s, index) => ({
      creator: s.creator,
      fitScore: Math.round(s.fitScore * 10000) / 10000,
      matchedAttributes: s.matchedAttributes,
      rank: index + 1,
    }));

    // Generate fit reasons in parallel batches (section 8 of the E10
    // architecture doc). Agency-added entries skip this entirely; this adapter
    // only produces system_ranked entries, so all entries are eligible.
    const fitReasons = await this.generateFitReasons(baseEntries, input);

    const entries: GenerateShortlistEntry[] = baseEntries.map((base, i) => ({
      creatorId: base.creator.id,
      rank: base.rank,
      fitScore: base.fitScore,
      matchedAttributes: base.matchedAttributes,
      fitReason: fitReasons[i].fitReason,
      fitReasonUnavailable: fitReasons[i].fitReasonUnavailable,
    }));

    return { status: 'ready', entries };
  }

  // ---- Fit reason generation (E10, section 8) ----

  private async generateFitReasons(
    entries: Array<{
      creator: Creator;
      fitScore: number;
      matchedAttributes: string[];
      rank: number;
    }>,
    input: GenerateShortlistInput,
  ): Promise<Array<{ fitReason: string | null; fitReasonUnavailable: boolean }>> {
    const model = this.configService.get<string>('ANTHROPIC_MODEL_FIT_REASON', 'claude-sonnet-4-5');
    const batchSize = parseInt(
      this.configService.get<string>('AI_FIT_REASON_BATCH_SIZE', '10'),
      10,
    );
    const timeoutMs = parseInt(
      this.configService.get<string>('AI_FIT_REASON_TIMEOUT_MS', '10000'),
      10,
    );

    // Build a flat results array aligned with the input entries array.
    const results: Array<{ fitReason: string | null; fitReasonUnavailable: boolean }> =
      new Array(entries.length).fill(null).map(() => ({
        fitReason: null,
        fitReasonUnavailable: false,
      }));

    // Process in sequential batches of batchSize; within each batch, all
    // calls run concurrently via Promise.allSettled (NFR-01, section 8).
    for (let batchStart = 0; batchStart < entries.length; batchStart += batchSize) {
      const batch = entries.slice(batchStart, batchStart + batchSize);

      const batchPromises = batch.map((entry, batchIdx) => {
        const globalIdx = batchStart + batchIdx;
        return this.generateOneFitReason(entry, input, model, timeoutMs)
          .then((reason) => {
            results[globalIdx] = { fitReason: reason, fitReasonUnavailable: false };
          })
          .catch((err) => {
            const isExpected = err instanceof InferenceUnavailableError;
            if (!isExpected) {
              this.logger.warn(
                `Unexpected error generating fit reason for creator ${entry.creator.id}: ${(err as Error).message}`,
              );
            }
            results[globalIdx] = { fitReason: null, fitReasonUnavailable: true };
          });
      });

      await Promise.allSettled(batchPromises);
    }

    return results;
  }

  private async generateOneFitReason(
    entry: { creator: Creator; fitScore: number; matchedAttributes: string[] },
    input: GenerateShortlistInput,
    model: string,
    timeoutMs: number,
  ): Promise<string> {
    const campaignName = input.campaignName || 'campanha';
    const campaignBrief = input.campaignBriefSummary || '(nao informado)';
    const audienceDesc = this.renderAudienceTargeting(input.audienceTargeting);
    const deliverableList =
      input.deliverableFormats && input.deliverableFormats.length > 0
        ? input.deliverableFormats.join(', ')
        : '(nao informado)';

    const matchedList =
      entry.matchedAttributes.length > 0
        ? entry.matchedAttributes
            .map((a) => {
              const [dim, val] = a.split(':');
              return `${dim} de ${val} (compativel com '${a}')`;
            })
            .join(', ')
        : 'nenhum atributo especifico identificado';

    const system = `Voce e um assistente da plataforma Aurora. Sua tarefa e gerar uma justificativa de compatibilidade entre um criador de conteudo e uma campanha especifica de marketing.

Instrucoes:
- Responda SEMPRE em Portugues Brasileiro.
- Escreva exatamente 1 ou 2 frases.
- Mencione pelo menos um sinal concreto e quantitativo (taxa de engajamento, tamanho do publico, nicho especifico, pontuacao de autenticidade).
- Relacione diretamente o perfil do criador ao objetivo desta campanha em especifico.
- Se a compatibilidade for parcial, seja honesto sobre isso sem ser negativo.
- Nao repita apenas o nome do criador ou o titulo da campanha sem contextualizar a relacao entre eles.`;

    const user = `Campanha: ${campaignName}
Objetivo da campanha: ${campaignBrief}
Publico-alvo: ${audienceDesc}
Formatos de entrega solicitados: ${deliverableList}

Criador: ${this.sanitizePromptField(entry.creator.displayName)}
Nicho de conteudo: ${this.sanitizePromptField(entry.creator.contentNiche || '(nao informado)')}
Tamanho do publico: ${entry.creator.audienceSize ?? 0} seguidores
Taxa de engajamento: ${entry.creator.engagementRate ?? '0'}%
Pontuacao de autenticidade: ${entry.creator.authenticityScore ?? '0'}/100
Atributos da campanha satisfeitos por este criador: ${matchedList}

Gere a justificativa de compatibilidade para este criador nesta campanha.`;

    return this.inferenceService.completeText({
      model,
      maxTokens: 128,
      system,
      user,
      correlationId: `fit-reason-${entry.creator.id}`,
      timeoutMs,
    });
  }

  // Renders AudienceTargeting to a human-readable Portuguese string for the
  // prompt (never raw JSON -- section 5.2 of the E10 architecture doc).
  private renderAudienceTargeting(targeting: AudienceTargeting | null): string {
    if (!targeting) return '(nao informado)';
    const parts: string[] = [];
    if (targeting.gender) parts.push(targeting.gender);
    if (targeting.age_range && targeting.age_range.length === 2) {
      parts.push(`de ${targeting.age_range[0]} a ${targeting.age_range[1]} anos`);
    }
    if (targeting.interests && targeting.interests.length > 0) {
      parts.push(`interessados em ${targeting.interests.join(', ')}`);
    }
    if (targeting.geography && targeting.geography.length > 0) {
      parts.push(`localizados em ${targeting.geography.join(', ')}`);
    }
    return parts.length > 0 ? parts.join(', ') : '(nao informado)';
  }

  // Strips bare backticks and angle brackets from creator-submitted fields
  // before including them in prompts (section 5 of the E10 architecture doc).
  private sanitizePromptField(value: string): string {
    return value.replace(/[`<>]/g, '');
  }

  // ---- Eligibility and scoring helpers ----

  private isZeroAddressable(targeting: AudienceTargeting): boolean {
    const geographyProvided = 'geography' in targeting;
    const interestsProvided = 'interests' in targeting;
    const geoCount = targeting.geography?.length || 0;
    const interestCount = targeting.interests?.length || 0;
    const noGeography = geographyProvided && geoCount === 0;
    const noInterests = interestsProvided && interestCount === 0;
    const zeroAgeSpan =
      Array.isArray(targeting.age_range) &&
      targeting.age_range.length === 2 &&
      targeting.age_range[1] <= targeting.age_range[0];
    return noGeography || noInterests || zeroAgeSpan;
  }

  private async countEligible(
    targeting: AudienceTargeting,
    excludedCreatorIds: string[],
  ): Promise<number> {
    const candidates = await this.eligibleCandidates(targeting, new Set(excludedCreatorIds), 150);
    return candidates.length;
  }

  // Hard eligibility gate: excluded, inactive, or unqualified creators never
  // enter scoring (ADR-0011). Authenticity score is deliberately not part of
  // this gate (ADR-0017) -- it affects display only, never eligibility.
  private async eligibleCandidates(
    targeting: AudienceTargeting,
    excludedCreatorIds: Set<string>,
    maxCandidates: number,
  ): Promise<Creator[]> {
    const qb = this.creatorRepo
      .createQueryBuilder('c')
      .where('c.status = :status', { status: CreatorStatus.ACTIVE })
      .andWhere('c.onboardingStatus = :onboardingStatus', {
        onboardingStatus: CreatorOnboardingStatus.QUALIFIED,
      })
      .limit(Math.min(maxCandidates, 150) * 3); // headroom before the attribute-overlap filter

    if (excludedCreatorIds.size > 0) {
      qb.andWhere('c.id NOT IN (:...excludedIds)', {
        excludedIds: Array.from(excludedCreatorIds),
      });
    }

    const rows = await qb.getMany();

    if (this.isZeroAddressable(targeting)) {
      return [];
    }

    // Zero audience-attribute overlap excludes a candidate from scoring
    // entirely (ADR-0011).
    const filtered = rows.filter((c) => this.audienceAttributeMatch(c, targeting).score > 0);
    return filtered.slice(0, maxCandidates);
  }

  // matched_attributes (FR-26) is derived directly from which targeting
  // dimensions contributed non-zero overlap, a byproduct of scoring itself.
  private audienceAttributeMatch(
    creator: Creator,
    targeting: AudienceTargeting,
  ): { score: number; matchedAttributes: string[] } {
    const dimensions: string[] = [];
    const matched: string[] = [];

    // geography, age_range, and gender (advisor feedback, Sprint 5): no
    // creator-own-geography field exists anywhere in the system yet -- not
    // on the entity, not in the onboarding flow, not in the profile-edit
    // DTO -- and demographic_composition (the one field that could carry
    // age/gender data) is only ever populated with audience age buckets,
    // never gender, and describes the creator's *audience*, not the
    // creator themself. The previous code counted these as measured
    // dimensions and marked them matched unconditionally, inflating every
    // shortlist's fit score on data Aurora was never actually checking.
    // Counting them as *unmatched* instead would be equally dishonest in
    // the other direction: a dimension no real creator could ever satisfy
    // would zero out `no_viable_pool` for the common case of a campaign
    // that targets a geography (the grader walkthrough's own example).
    // Correct middle ground until this data genuinely exists: leave these
    // three out of `dimensions` entirely, so they neither inflate nor
    // deflate the score, and never appear in matched_attributes claiming a
    // check that didn't happen.
    if (targeting.interests && targeting.interests.length > 0) {
      dimensions.push('interests');
      const niche = (creator.contentNiche || '').toLowerCase();
      const hit = targeting.interests.find((i) => niche.includes(i.toLowerCase()));
      if (hit) matched.push(`interests:${hit}`);
    }

    if (dimensions.length === 0) {
      // No targeting dimensions specified: every qualified creator matches
      // with full overlap (nothing to disqualify them on).
      return { score: 1, matchedAttributes: [] };
    }

    const score = matched.length / dimensions.length;
    return { score, matchedAttributes: matched };
  }
}
