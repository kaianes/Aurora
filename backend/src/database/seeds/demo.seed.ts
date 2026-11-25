/**
 * Demo seed script for E10 AI Creator Demo (US-10.5).
 *
 * Usage:
 *   npm run seed:demo        -- populate seed data, fail fast if already present
 *   npm run seed:demo:reset  -- teardown existing seed data, then re-seed
 *
 * Production guard (section 10.2 of the E10 architecture doc):
 *   - Proceeds if DEMO_SEED_ALLOWED=true
 *   - Proceeds if DATABASE_URL / DB_HOST contains 'localhost', '127.0.0.1', 'demo', or 'local'
 *   - Otherwise exits 1 with a clear error message
 *
 * Scenario (Apresentação Final Aurora):
 *   5 logins (3 marca/agência + 2 creators) · 10 creators · 4 campanhas
 *   2 campanhas ativas (Bella Verão 2027, NovaTech Pro) com AI features ao vivo
 *   2 campanhas encerradas (Bella Q4 2026, BF NovaTech 2026) com ROI completo
 *   2 templates · invoices · payouts · social accounts · rate preferences
 */

import { createHash } from 'crypto';
import * as dotenv from 'dotenv';
dotenv.config();

function checkProductionGuard(): void {
  if (process.env.DEMO_SEED_ALLOWED === 'true') return;

  const dbUrl = process.env.DATABASE_URL || process.env.DB_HOST || '';
  const safePatterns = ['localhost', '127.0.0.1', 'demo', 'local'];
  if (safePatterns.some((p) => dbUrl.includes(p))) return;

  console.error(
    '[seed:demo] RECUSADO: Ambiente nao reconhecido como demo/local. ' +
      'Defina DEMO_SEED_ALLOWED=true para forcar a execucao.',
  );
  process.exit(1);
}

checkProductionGuard();

import dataSource from '../data-source.js';

const RESET_MODE = process.argv.includes('--reset');
const SEED_NS = 'aurora-demo-seed-e10';

// bcrypt hash of 'Demo@2026', cost factor 10 — same for all demo users
const DEMO_HASH = '$2b$10$LL1WhT1EiJPPzSR88CyvL.1p.dVeD8RtBZgBUaXBt7auETl5p3if2';

function dId(key: string): string {
  const h = createHash('sha256').update(`${SEED_NS}:${key}`).digest('hex');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    '4' + h.slice(13, 16),
    ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join('-');
}

// ---------------------------------------------------------------------------
// Deterministic IDs
// ---------------------------------------------------------------------------
const IDS = {
  // ── Users ──────────────────────────────────────────────────────────────
  userBella:        dId('user:bella-manager'),
  userNovatech:     dId('user:novatech-manager'),
  userAgency:       dId('user:agency-operator'),
  userDuda:         dId('user:duda-creator'),
  userCarolina:     dId('user:carolina-creator'),

  // ── Workspaces / Accounts / Memberships ────────────────────────────────
  wsBella:          dId('workspace:bella'),
  wsNovatech:       dId('workspace:novatech'),
  wsAgency:         dId('workspace:agencia-pulso'),

  acctBella:        dId('account:bella'),
  acctNovatech:     dId('account:novatech'),
  acctAgency:       dId('account:agencia-pulso'),

  memBella:         dId('membership:bella'),
  memNovatech:      dId('membership:novatech'),
  memAgency:        dId('membership:agencia'),

  // ── Creators ───────────────────────────────────────────────────────────
  crDuda:           dId('creator:dudamartins'),
  crCarolina:       dId('creator:carolinafit'),
  crAna:            dId('creator:anafashionbr'),
  crPedro:          dId('creator:pedrogeek'),
  crLuana:          dId('creator:luanacook'),
  crThiago:         dId('creator:thiagoviagem'),
  crNaty:           dId('creator:natybeauty'),
  crBruno:          dId('creator:brunotech'),
  crMarina:         dId('creator:marinasaude'),
  crJessica:        dId('creator:jessicaarte'),

  // ── Safety ─────────────────────────────────────────────────────────────
  rulesetBella:     dId('ruleset:bella-brand'),
  rulesetNovatech:  dId('ruleset:novatech-brand'),
  ruleBella1:       dId('rule:bella-testes-animais'),
  ruleBella2:       dId('rule:bella-parabenos'),
  ruleBella3:       dId('rule:bella-natura'),
  ruleNova1:        dId('rule:nova-melhor-mercado'),
  ruleNova2:        dId('rule:nova-garantia-vida'),
  ruleNova3:        dId('rule:nova-samsung'),

  // ── Campanhas ativas ───────────────────────────────────────────────────
  campBella:        dId('campaign:verao-bella-2027'),
  campNovatech:     dId('campaign:lancamento-novatech-pro'),

  slBella:          dId('shortlist:verao-bella-2027'),
  slNovatech:       dId('shortlist:lancamento-novatech-pro'),

  sleBella1:        dId('sle:bella-duda'),
  sleBella2:        dId('sle:bella-carolina'),
  sleBella3:        dId('sle:bella-naty'),
  sleBella4:        dId('sle:bella-marina'),
  sleNova1:         dId('sle:nova-pedro'),
  sleNova2:         dId('sle:nova-bruno'),
  sleNova3:         dId('sle:nova-thiago'),

  oppBellaDuda:     dId('opp:bella-duda'),
  oppBellaCarolina: dId('opp:bella-carolina'),
  oppBellaNaty:     dId('opp:bella-naty'),
  oppBellaMarina:   dId('opp:bella-marina'),
  oppNovaPedro:     dId('opp:nova-pedro'),
  oppNovaBruno:     dId('opp:nova-bruno'),
  oppNovaThiago:    dId('opp:nova-thiago'),

  briefingBella:    dId('briefing:verao-bella-2027'),

  subDuda:          dId('submission:bella-duda'),
  subNaty:          dId('submission:bella-naty'),
  subCarolina:      dId('submission:bella-carolina'),

  checkDuda:        dId('safety-check:bella-duda'),
  checkNaty:        dId('safety-check:bella-naty'),
  checkCarolina:    dId('safety-check:bella-carolina'),

  queueNaty:        dId('queue-item:bella-naty'),
  triggerNaty:      dId('trigger:bella-naty'),

  // ── Campanha encerrada: Bella Q4 2026 ──────────────────────────────────
  campBellaQ4:      dId('campaign:hidratante-bella-q4-2026'),

  slBellaQ4:        dId('shortlist:hidratante-bella-q4-2026'),
  sleBellaQ4a:      dId('sle:q4-duda'),
  sleBellaQ4b:      dId('sle:q4-naty'),
  sleBellaQ4c:      dId('sle:q4-marina'),

  oppQ4Duda:        dId('opp:q4-duda'),
  oppQ4Naty:        dId('opp:q4-naty'),
  oppQ4Marina:      dId('opp:q4-marina'),

  briefingQ4:       dId('briefing:hidratante-bella-q4-2026'),

  subQ4Duda:        dId('submission:q4-duda'),
  subQ4Naty:        dId('submission:q4-naty'),
  subQ4Marina:      dId('submission:q4-marina'),

  checkQ4Duda:      dId('safety-check:q4-duda'),
  checkQ4Naty:      dId('safety-check:q4-naty'),
  checkQ4Marina:    dId('safety-check:q4-marina'),

  snapQ4Duda:       dId('snapshot:q4-duda'),
  snapQ4Naty:       dId('snapshot:q4-naty'),
  snapQ4Marina:     dId('snapshot:q4-marina'),

  aggBellaQ4:       dId('agg:bella-q4'),
  reportBellaQ4:    dId('report:bella-q4'),
  invBellaQ4:       dId('invoice:bella-q4'),
  invLineQ4:        dId('invline:bella-q4-base'),

  payoutQ4Duda:     dId('payout:q4-duda'),
  payoutQ4Naty:     dId('payout:q4-naty'),
  payoutQ4Marina:   dId('payout:q4-marina'),

  // ── Campanha encerrada: Black Friday NovaTech 2026 ─────────────────────
  campNovaBF:       dId('campaign:bf-novatech-2026'),

  slNovaBF:         dId('shortlist:bf-novatech-2026'),
  sleNovaBF1:       dId('sle:bf-pedro'),
  sleNovaBF2:       dId('sle:bf-bruno'),
  sleNovaBF3:       dId('sle:bf-thiago'),

  oppBFPedro:       dId('opp:bf-pedro'),
  oppBFBruno:       dId('opp:bf-bruno'),
  oppBFThiago:      dId('opp:bf-thiago'),

  briefingNovaBF:   dId('briefing:bf-novatech-2026'),

  subBFPedro:       dId('submission:bf-pedro'),
  subBFBruno:       dId('submission:bf-bruno'),
  subBFThiago:      dId('submission:bf-thiago'),

  checkBFPedro:     dId('safety-check:bf-pedro'),
  checkBFBruno:     dId('safety-check:bf-bruno'),
  checkBFThiago:    dId('safety-check:bf-thiago'),

  snapBFPedro:      dId('snapshot:bf-pedro'),
  snapBFBruno:      dId('snapshot:bf-bruno'),
  snapBFThiago:     dId('snapshot:bf-thiago'),

  aggNovaBF:        dId('agg:nova-bf'),
  reportNovaBF:     dId('report:nova-bf'),
  invNovaBF:        dId('invoice:nova-bf'),
  invLineNovaBF:    dId('invline:nova-bf-base'),

  payoutBFPedro:    dId('payout:bf-pedro'),
  payoutBFBruno:    dId('payout:bf-bruno'),
  payoutBFThiago:   dId('payout:bf-thiago'),

  // ── Payouts ativos (campanha ativa, submissão existe) ──────────────────
  payoutActiveDuda:     dId('payout:active-bella-duda'),
  payoutActiveCarolina: dId('payout:active-bella-carolina'),

  // ── NovaTech Pro: 1 submissão @pedrogeek pending safety ────────────────
  subNovaPedro:     dId('submission:nova-pedro'),
  checkNovaPedro:   dId('safety-check:nova-pedro'),
  queueNovaPedro:   dId('queue-item:nova-pedro'),

  // ── Q&A threads adicionais ─────────────────────────────────────────────
  qaThread:         dId('qa-thread:bella-carolina'),  // existente (Carolina, Bella Verão)
  qaMsg1:           dId('qa-msg:bella-carolina-1'),
  qaMsg2:           dId('qa-msg:bella-carolina-2'),

  qaThreadDuda:     dId('qa-thread:bella-duda'),      // novo (Duda, Bella Verão)
  qaMsg3:           dId('qa-msg:bella-duda-1'),

  qaThreadPedro:    dId('qa-thread:nova-pedro'),      // novo (Pedro, NovaTech Pro)
  qaMsg4:           dId('qa-msg:nova-pedro-1'),
  qaMsg5:           dId('qa-msg:nova-pedro-2'),

  // ── Pool members ───────────────────────────────────────────────────────
  poolBellaDuda:     dId('pool:bella-duda'),
  poolBellaCarolina: dId('pool:bella-carolina'),
  poolBellaNaty:     dId('pool:bella-naty'),
  poolBellaMarina:   dId('pool:bella-marina'),
  poolNovaPedro:     dId('pool:nova-pedro'),
  poolNovaBruno:     dId('pool:nova-bruno'),
  poolNovaThiago:    dId('pool:nova-thiago'),
  poolQ4Duda:        dId('pool:q4-duda'),
  poolQ4Naty:        dId('pool:q4-naty'),
  poolQ4Marina:      dId('pool:q4-marina'),
  poolBFPedro:       dId('pool:bf-pedro'),
  poolBFBruno:       dId('pool:bf-bruno'),
  poolBFThiago:      dId('pool:bf-thiago'),

  // ── Social accounts (Instagram para 9 creators) ────────────────────────
  socDuda:      dId('social:duda-ig'),
  socCarolina:  dId('social:carolina-ig'),
  socAna:       dId('social:ana-ig'),
  socPedro:     dId('social:pedro-ig'),
  socLuana:     dId('social:luana-ig'),
  socThiago:    dId('social:thiago-ig'),
  socNaty:      dId('social:naty-ig'),
  socBruno:     dId('social:bruno-ig'),
  socMarina:    dId('social:marina-ig'),

  // ── Rate preferences ───────────────────────────────────────────────────
  rateDuda:     dId('rate:duda-reels'),
  rateCarolina: dId('rate:carolina-reels'),
  rateAna:      dId('rate:ana-reels'),
  ratePedro:    dId('rate:pedro-feed'),
  rateLuana:    dId('rate:luana-reels'),
  rateThiago:   dId('rate:thiago-feed'),
  rateNaty:     dId('rate:naty-reels'),
  rateBruno:    dId('rate:bruno-feed'),
  rateMarina:   dId('rate:marina-reels'),

  // ── Campaign templates ─────────────────────────────────────────────────
  templateBella:   dId('template:bella-lancamento'),
  templateNovatech: dId('template:novatech-lancamento'),

  // ── Agency client access ───────────────────────────────────────────────
  operatorAccess:      dId('operator-access:agencia-novatech'),
  operatorAccessBella: dId('operator-access:agencia-bella'),

  // ── Content review decisions ──────────────────────────────────────────
  reviewDecDuda:   dId('review-dec:bella-duda'),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function checkAlreadySeeded(): Promise<boolean> {
  const rows = await dataSource.query(
    `SELECT id FROM creator WHERE id = $1 LIMIT 1`,
    [IDS.crDuda],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------
async function teardown(): Promise<void> {
  console.log('[seed:demo] Removendo dados de seed existentes...');
  const D = IDS;
  const campIds = `'${D.campBella}','${D.campNovatech}','${D.campBellaQ4}','${D.campNovaBF}'`;

  // Delete everything that references campaign by campaign_id, deepest dependents first.
  // Using campaign_id scope catches runtime-created rows (reports, AI messages, extra safety
  // checks) that were not in the original fixed-ID lists.

  // Q&A (briefing_qa_message → briefing_qa_thread → briefing → campaign)
  await dataSource.query(`DELETE FROM briefing_qa_message WHERE campaign_id IN (${campIds})`);
  await dataSource.query(`DELETE FROM briefing_qa_thread WHERE campaign_id IN (${campIds})`);

  // Safety checks and their dependents
  await dataSource.query(`DELETE FROM safety_review_queue_item WHERE safety_check_id IN (SELECT id FROM safety_check WHERE campaign_id IN (${campIds}))`);
  await dataSource.query(`DELETE FROM safety_rule_trigger WHERE safety_check_id IN (SELECT id FROM safety_check WHERE campaign_id IN (${campIds}))`);
  await dataSource.query(`DELETE FROM safety_check WHERE campaign_id IN (${campIds})`);

  // Payouts
  await dataSource.query(`DELETE FROM payout_obligation WHERE campaign_id IN (${campIds})`);

  // Metric snapshots & submissions (snapshot references submission)
  await dataSource.query(`DELETE FROM content_review_decision WHERE campaign_id IN (${campIds})`);
  await dataSource.query(`DELETE FROM content_submission_metric_snapshot WHERE campaign_id IN (${campIds})`);
  await dataSource.query(`DELETE FROM content_submission WHERE campaign_id IN (${campIds})`);

  // Performance reports & aggregates
  await dataSource.query(`DELETE FROM campaign_performance_report WHERE campaign_id IN (${campIds})`);
  await dataSource.query(`DELETE FROM campaign_performance_aggregate WHERE campaign_id IN (${campIds})`);

  // Invoice line items & invoices
  await dataSource.query(`DELETE FROM invoice_line_item WHERE invoice_id IN (SELECT id FROM invoice WHERE campaign_id IN (${campIds}))`);
  await dataSource.query(`DELETE FROM invoice WHERE campaign_id IN (${campIds})`);

  // Briefings
  await dataSource.query(`DELETE FROM briefing WHERE campaign_id IN (${campIds})`);

  // Pool members, opportunities, shortlist entries, shortlists
  await dataSource.query(`DELETE FROM campaign_pool_member WHERE campaign_id IN (${campIds})`);
  await dataSource.query(`DELETE FROM campaign_opportunity WHERE campaign_id IN (${campIds})`);
  await dataSource.query(`DELETE FROM campaign_shortlist_entry WHERE shortlist_id IN (SELECT id FROM campaign_shortlist WHERE campaign_id IN (${campIds}))`);
  await dataSource.query(`DELETE FROM campaign_shortlist WHERE campaign_id IN (${campIds})`);

  // Campaigns
  await dataSource.query(`DELETE FROM campaign WHERE id IN (${campIds})`);

  // Safety rules / rulesets
  await dataSource.query(`DELETE FROM safety_rule WHERE id IN ('${D.ruleBella1}','${D.ruleBella2}','${D.ruleBella3}','${D.ruleNova1}','${D.ruleNova2}','${D.ruleNova3}')`);
  await dataSource.query(`DELETE FROM safety_ruleset WHERE id IN ('${D.rulesetBella}','${D.rulesetNovatech}')`);

  // Rate preferences & social accounts
  await dataSource.query(`DELETE FROM creator_rate_preference WHERE id IN ('${D.rateDuda}','${D.rateCarolina}','${D.rateAna}','${D.ratePedro}','${D.rateLuana}','${D.rateThiago}','${D.rateNaty}','${D.rateBruno}','${D.rateMarina}')`);
  await dataSource.query(`DELETE FROM creator_social_account WHERE id IN ('${D.socDuda}','${D.socCarolina}','${D.socAna}','${D.socPedro}','${D.socLuana}','${D.socThiago}','${D.socNaty}','${D.socBruno}','${D.socMarina}')`);

  // Creators
  await dataSource.query(`DELETE FROM creator WHERE id IN ('${D.crDuda}','${D.crCarolina}','${D.crAna}','${D.crPedro}','${D.crLuana}','${D.crThiago}','${D.crNaty}','${D.crBruno}','${D.crMarina}','${D.crJessica}')`);

  // Campaign templates
  await dataSource.query(`DELETE FROM campaign_template WHERE id IN ('${D.templateBella}','${D.templateNovatech}')`);

  // Operator client access
  await dataSource.query(`DELETE FROM operator_client_access WHERE id IN ('${D.operatorAccess}','${D.operatorAccessBella}')`);

  // Memberships / accounts / workspaces / users
  await dataSource.query(`DELETE FROM membership WHERE id IN ('${D.memBella}','${D.memNovatech}','${D.memAgency}')`);
  await dataSource.query(`DELETE FROM account WHERE id IN ('${D.acctBella}','${D.acctNovatech}','${D.acctAgency}')`);
  await dataSource.query(`DELETE FROM workspace WHERE id IN ('${D.wsBella}','${D.wsNovatech}','${D.wsAgency}')`);
  // Unlink creator.user_id before deleting users (handles manually-created users with different UUIDs)
  await dataSource.query(`UPDATE creator SET user_id = NULL WHERE user_id IN (SELECT id FROM "user" WHERE email IN ('demo-duda@aurora.internal','demo-carolina@aurora.internal'))`);
  // Delete by email to cover any UUID mismatch from manually-created accounts
  await dataSource.query(`DELETE FROM "user" WHERE email IN ('demo-bella@aurora.internal','demo-novatech@aurora.internal','demo-agencia@aurora.internal','demo-duda@aurora.internal','demo-carolina@aurora.internal')`);

  console.log('[seed:demo] Teardown concluido.');
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
async function seed(): Promise<void> {
  console.log('[seed:demo] Iniciando seed de demonstracao E10 (expanded)...');
  const D = IDS;

  const expiry30d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const expiry45d = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString();
  const past90d  = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const past60d  = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const past30d  = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // ── 1. Users ─────────────────────────────────────────────────────────────
  // Brand / agency users use real bcrypt hash so the unified login works.
  // Creator users (Duda, Carolina) are linked to their creator records below.
  await dataSource.query(`
    INSERT INTO "user" (id, email, password_hash, name, email_verified, created_at, updated_at) VALUES
    ('${D.userBella}',    'demo-bella@aurora.internal',    '${DEMO_HASH}', 'Marina Lopes Demo',           true, now(), now()),
    ('${D.userNovatech}', 'demo-novatech@aurora.internal', '${DEMO_HASH}', 'Rafael Souza Demo',           true, now(), now()),
    ('${D.userAgency}',   'demo-agencia@aurora.internal',  '${DEMO_HASH}', 'Thais Drummond Demo',         true, now(), now()),
    ('${D.userDuda}',     'demo-duda@aurora.internal',     '${DEMO_HASH}', 'Duda Martins Demo',           true, now(), now()),
    ('${D.userCarolina}', 'demo-carolina@aurora.internal', '${DEMO_HASH}', 'Carolina Fit Demo',           true, now(), now())
    ON CONFLICT DO NOTHING
  `);

  // ── 2. Workspaces ─────────────────────────────────────────────────────────
  await dataSource.query(`
    INSERT INTO workspace (id, type, name, created_at, updated_at) VALUES
    ('${D.wsBella}',    'brand',  'Bella Natural Cosmeticos', now(), now()),
    ('${D.wsNovatech}', 'brand',  'NovaTech Eletronicos',     now(), now()),
    ('${D.wsAgency}',   'agency', 'Agencia Pulso Digital',    now(), now())
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 3. Accounts ───────────────────────────────────────────────────────────
  await dataSource.query(`
    INSERT INTO account (id, workspace_id, name, status, created_at, updated_at) VALUES
    ('${D.acctBella}',    '${D.wsBella}',    'Bella Natural Cosmeticos', 'active', now(), now()),
    ('${D.acctNovatech}', '${D.wsNovatech}', 'NovaTech Eletronicos',     'active', now(), now()),
    ('${D.acctAgency}',   '${D.wsAgency}',   'Agencia Pulso Digital',    'active', now(), now())
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 4. Memberships ────────────────────────────────────────────────────────
  await dataSource.query(`
    INSERT INTO membership (id, user_id, account_id, role, created_at, updated_at) VALUES
    ('${D.memBella}',    '${D.userBella}',    '${D.acctBella}',    'brand_manager',   now(), now()),
    ('${D.memNovatech}', '${D.userNovatech}', '${D.acctNovatech}', 'brand_manager',   now(), now()),
    ('${D.memAgency}',   '${D.userAgency}',   '${D.acctAgency}',   'agency_operator', now(), now())
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 5. Creators ───────────────────────────────────────────────────────────
  // user_id links Duda/Carolina so creator login works.
  await dataSource.query(`
    INSERT INTO creator (
      id, user_id, display_name, status, onboarding_status, content_niche,
      audience_size, engagement_rate, authenticity_score, authenticity_status,
      demographic_composition, created_at, updated_at
    ) VALUES
    ('${D.crDuda}',    '${D.userDuda}',     '@dudamartins',  'active', 'qualified', 'beleza sustentavel',  18400, 8.3,  87, 'scored',  '{"18-24":0.45,"25-34":0.35,"35+":0.20}', now(), now()),
    ('${D.crCarolina}','${D.userCarolina}', '@carolinafit',  'active', 'qualified', 'fitness e bem-estar', 24100, 6.1,  79, 'scored',  '{"18-24":0.38,"25-34":0.42,"35+":0.20}', now(), now()),
    ('${D.crAna}',     null,               '@anafashionbr', 'active', 'qualified', 'moda feminina',       31200, 4.7,  72, 'scored',  '{"18-24":0.50,"25-34":0.33,"35+":0.17}', now(), now()),
    ('${D.crPedro}',   null,               '@pedrogeek',    'active', 'qualified', 'tecnologia e games',  15800, 9.2,  91, 'scored',  '{"18-24":0.42,"25-34":0.40,"35+":0.18}', now(), now()),
    ('${D.crLuana}',   null,               '@luanacook',    'active', 'qualified', 'culinaria saudavel',  12600, 11.4, 94, 'scored',  '{"18-24":0.30,"25-34":0.45,"35+":0.25}', now(), now()),
    ('${D.crThiago}',  null,               '@thiagoviagem', 'active', 'qualified', 'viagens e lifestyle', 42000, 3.8,  61, 'scored',  '{"18-24":0.25,"25-34":0.48,"35+":0.27}', now(), now()),
    ('${D.crNaty}',    null,               '@natybeauty',   'active', 'qualified', 'beleza e skincare',    9700, 7.6,  83, 'scored',  '{"18-24":0.48,"25-34":0.36,"35+":0.16}', now(), now()),
    ('${D.crBruno}',   null,               '@brunotech',    'active', 'qualified', 'gadgets e inovacao',  20500, 5.3,  76, 'scored',  '{"18-24":0.40,"25-34":0.43,"35+":0.17}', now(), now()),
    ('${D.crMarina}',  null,               '@marinasaude',  'active', 'qualified', 'saude e nutricao',     8200, 10.1, 88, 'scored',  '{"18-24":0.35,"25-34":0.44,"35+":0.21}', now(), now()),
    ('${D.crJessica}', null,               '@jessicaarte',  'active', 'pending',   'arte e ilustracao',    6400, 13.2, 95, 'pending', '{"18-24":0.52,"25-34":0.33,"35+":0.15}', now(), now())
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 6. Social accounts (Instagram, 9 creators com token placeholder) ──────
  // access_token_ciphertext / nonce são placeholders — não são usados em demo
  const tokenExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  await dataSource.query(`
    INSERT INTO creator_social_account (
      id, creator_id, platform, platform_user_id, platform_handle, status,
      access_token_ciphertext, access_token_nonce, token_key_version,
      granted_scope, token_expires_at, connected_at, created_at, updated_at
    ) VALUES
    ('${D.socDuda}',    '${D.crDuda}',    'instagram', 'ig_duda_001',    'dudamartins',  'connected', 'demo_tok', 'demo_nonce', 1, '["basic","metrics"]', '${tokenExpiry}', now(), now(), now()),
    ('${D.socCarolina}','${D.crCarolina}','instagram', 'ig_carol_002',   'carolinafit',  'connected', 'demo_tok', 'demo_nonce', 1, '["basic","metrics"]', '${tokenExpiry}', now(), now(), now()),
    ('${D.socAna}',     '${D.crAna}',     'instagram', 'ig_ana_003',     'anafashionbr', 'connected', 'demo_tok', 'demo_nonce', 1, '["basic","metrics"]', '${tokenExpiry}', now(), now(), now()),
    ('${D.socPedro}',   '${D.crPedro}',   'instagram', 'ig_pedro_004',   'pedrogeek',    'connected', 'demo_tok', 'demo_nonce', 1, '["basic","metrics"]', '${tokenExpiry}', now(), now(), now()),
    ('${D.socLuana}',   '${D.crLuana}',   'instagram', 'ig_luana_005',   'luanacook',    'connected', 'demo_tok', 'demo_nonce', 1, '["basic","metrics"]', '${tokenExpiry}', now(), now(), now()),
    ('${D.socThiago}',  '${D.crThiago}',  'instagram', 'ig_thiago_006',  'thiagoviagem', 'connected', 'demo_tok', 'demo_nonce', 1, '["basic","metrics"]', '${tokenExpiry}', now(), now(), now()),
    ('${D.socNaty}',    '${D.crNaty}',    'instagram', 'ig_naty_007',    'natybeauty',   'connected', 'demo_tok', 'demo_nonce', 1, '["basic","metrics"]', '${tokenExpiry}', now(), now(), now()),
    ('${D.socBruno}',   '${D.crBruno}',   'instagram', 'ig_bruno_008',   'brunotech',    'connected', 'demo_tok', 'demo_nonce', 1, '["basic","metrics"]', '${tokenExpiry}', now(), now(), now()),
    ('${D.socMarina}',  '${D.crMarina}',  'instagram', 'ig_marina_009',  'marinasaude',  'connected', 'demo_tok', 'demo_nonce', 1, '["basic","metrics"]', '${tokenExpiry}', now(), now(), now())
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 7. Rate preferences ───────────────────────────────────────────────────
  await dataSource.query(`
    INSERT INTO creator_rate_preference (id, creator_id, deliverable_format, rate_amount, currency, created_at, updated_at) VALUES
    ('${D.rateDuda}',     '${D.crDuda}',    'reels', 2000, 'BRL', now(), now()),
    ('${D.rateCarolina}', '${D.crCarolina}','reels', 1800, 'BRL', now(), now()),
    ('${D.rateAna}',      '${D.crAna}',     'reels', 2500, 'BRL', now(), now()),
    ('${D.ratePedro}',    '${D.crPedro}',   'feed',  3000, 'BRL', now(), now()),
    ('${D.rateLuana}',    '${D.crLuana}',   'reels', 1500, 'BRL', now(), now()),
    ('${D.rateThiago}',   '${D.crThiago}',  'feed',  4000, 'BRL', now(), now()),
    ('${D.rateNaty}',     '${D.crNaty}',    'reels', 1600, 'BRL', now(), now()),
    ('${D.rateBruno}',    '${D.crBruno}',   'feed',  2800, 'BRL', now(), now()),
    ('${D.rateMarina}',   '${D.crMarina}',  'reels', 1400, 'BRL', now(), now())
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 8. Safety rulesets e regras ───────────────────────────────────────────
  await dataSource.query(`
    INSERT INTO safety_ruleset (id, account_id, scope, campaign_id, created_by_user_id, created_at, updated_at) VALUES
    ('${D.rulesetBella}',    '${D.acctBella}',    'brand', null, '${D.userBella}',    now(), now()),
    ('${D.rulesetNovatech}', '${D.acctNovatech}', 'brand', null, '${D.userNovatech}', now(), now())
    ON CONFLICT (id) DO NOTHING
  `);

  await dataSource.query(`
    INSERT INTO safety_rule (id, ruleset_id, rule_type, definition, action, supersedes_rule_id, created_by_user_id, created_at, updated_at) VALUES
    ('${D.ruleBella1}', '${D.rulesetBella}', 'prohibited_topic',   '{"topic":"testes em animais"}',          'add', null, '${D.userBella}',    now(), now()),
    ('${D.ruleBella2}', '${D.rulesetBella}', 'prohibited_topic',   '{"topic":"parabenos"}',                  'add', null, '${D.userBella}',    now(), now()),
    ('${D.ruleBella3}', '${D.rulesetBella}', 'competitor_mention', '{"competitor_name":"Natura Cosmeticos"}','add', null, '${D.userBella}',    now(), now()),
    ('${D.ruleNova1}',  '${D.rulesetNovatech}', 'restricted_language', '{"pattern":"o melhor do mercado","pattern_type":"keyword"}',  'add', null, '${D.userNovatech}', now(), now()),
    ('${D.ruleNova2}',  '${D.rulesetNovatech}', 'restricted_language', '{"pattern":"garantia de vida util","pattern_type":"keyword"}','add', null, '${D.userNovatech}', now(), now()),
    ('${D.ruleNova3}',  '${D.rulesetNovatech}', 'competitor_mention',  '{"competitor_name":"Samsung Brasil"}',                       'add', null, '${D.userNovatech}', now(), now())
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 9. Campanhas ativas ───────────────────────────────────────────────────
  await dataSource.query(`
    INSERT INTO campaign (
      id, account_id, created_by_user_id, name, state,
      message, deliverable_formats, audience_targeting,
      guaranteed_min_pool_size, budget_amount, budget_currency,
      locked_price, created_at, updated_at
    ) VALUES
    (
      '${D.campBella}', '${D.acctBella}', '${D.userBella}',
      'Campanha Verao Bella 2027', 'active',
      'Lancamento de linha de protetor solar vegano, publico-alvo mulheres 18 a 30 anos, formato Reels 30 segundos, hashtag obrigatoria #BellaNatural, nao mencionar ingredientes quimicos, nao fazer comparacoes com concorrentes',
      '["reels"]',
      '{"age_range":[18,30],"interests":["beleza"],"gender":"Mulheres","geography":["Brasil"]}',
      4, 20000, 'BRL', 20000, now(), now()
    ),
    (
      '${D.campNovatech}', '${D.acctNovatech}', '${D.userNovatech}',
      'Lancamento NovaTech Pro', 'active',
      'Apresentacao do novo smartphone NovaTech Pro, publico-alvo homens e mulheres de 20 a 35 anos interessados em tecnologia, formato feed + Stories, nao usar o termo o melhor do mercado, nao mencionar Samsung',
      '["feed","stories"]',
      '{"age_range":[20,35],"interests":["tecnologia"],"geography":["Brasil"]}',
      3, 25000, 'BRL', 25000, now(), now()
    )
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 10. Campanhas encerradas ──────────────────────────────────────────────
  await dataSource.query(`
    INSERT INTO campaign (
      id, account_id, created_by_user_id, name, state,
      message, deliverable_formats, audience_targeting,
      guaranteed_min_pool_size, budget_amount, budget_currency,
      locked_price, created_at, updated_at
    ) VALUES
    (
      '${D.campBellaQ4}', '${D.acctBella}', '${D.userBella}',
      'Hidratante Noturno Q4 2026', 'completed',
      'Lancamento do hidratante noturno Bella, formula com acido hialuronico, publico-alvo mulheres 25 a 40 anos, Reels mostrando rotina noturna, hashtag #BellaNight',
      '["reels"]',
      '{"age_range":[25,40],"interests":["beleza","skincare"],"gender":"Mulheres","geography":["Brasil"]}',
      3, 15000, 'BRL', 15000, '${past90d}', '${past30d}'
    ),
    (
      '${D.campNovaBF}', '${D.acctNovatech}', '${D.userNovatech}',
      'Black Friday NovaTech 2026', 'completed',
      'Campanha Black Friday para linha de smartphones NovaTech, destaque para descontos de ate 40 pct, formato feed com chamada para link na bio, nao citar concorrentes',
      '["feed"]',
      '{"age_range":[20,35],"interests":["tecnologia","ofertas"],"geography":["Brasil"]}',
      3, 25000, 'BRL', 25000, '${past90d}', '${past30d}'
    )
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 11. Campaign templates ────────────────────────────────────────────────
  await dataSource.query(`
    INSERT INTO campaign_template (
      id, account_id, source_campaign_id, name,
      audience_targeting, message, deliverable_formats, created_at, updated_at
    ) VALUES
    (
      '${D.templateBella}', '${D.acctBella}', '${D.campBellaQ4}',
      'Template Lancamento Linha Bella',
      '{"age_range":[18,35],"interests":["beleza","skincare"],"gender":"Mulheres","geography":["Brasil"]}',
      'Lancamento de novo produto da linha Bella Natural, produto vegano e sem crueldade animal, formato Reels 30 segundos, hashtag obrigatoria, nao comparar com concorrentes',
      '["reels"]', now(), now()
    ),
    (
      '${D.templateNovatech}', '${D.acctNovatech}', '${D.campNovaBF}',
      'Template Lancamento Produto Tech',
      '{"age_range":[20,35],"interests":["tecnologia","inovacao"],"geography":["Brasil"]}',
      'Lancamento de produto de tecnologia NovaTech, destaque para diferenciais tecnicos, formato feed + Stories, nao mencionar concorrentes pelo nome',
      '["feed","stories"]', now(), now()
    )
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 12. Shortlists — ativas ───────────────────────────────────────────────
  await dataSource.query(`
    INSERT INTO campaign_shortlist (
      id, campaign_id, status, failure_reason, below_guaranteed_minimum,
      locked, locked_reason, locked_at, resolved_at, created_at, updated_at
    ) VALUES
    ('${D.slBella}',    '${D.campBella}',    'ready', null, false, true, 'campaign_activated', now(), now(), now(), now()),
    ('${D.slNovatech}', '${D.campNovatech}', 'ready', null, false, true, 'campaign_activated', now(), now(), now(), now())
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 13. Shortlists — encerradas ───────────────────────────────────────────
  await dataSource.query(`
    INSERT INTO campaign_shortlist (
      id, campaign_id, status, failure_reason, below_guaranteed_minimum,
      locked, locked_reason, locked_at, resolved_at, created_at, updated_at
    ) VALUES
    ('${D.slBellaQ4}', '${D.campBellaQ4}', 'ready', null, false, true, 'campaign_activated', '${past90d}', '${past90d}', '${past90d}', '${past90d}'),
    ('${D.slNovaBF}',  '${D.campNovaBF}',  'ready', null, false, true, 'campaign_activated', '${past90d}', '${past90d}', '${past90d}', '${past90d}')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 14. Shortlist entries — Bella Verão (ativa) ───────────────────────────
  await dataSource.query(`
    INSERT INTO campaign_shortlist_entry (
      id, shortlist_id, campaign_id, creator_id, rank, fit_score, matched_attributes,
      origin, decision, decision_by_user_id, decision_at, included,
      fit_reason, fit_reason_unavailable, created_at, updated_at
    ) VALUES
    ('${D.sleBella1}','${D.slBella}','${D.campBella}','${D.crDuda}',    1, 0.8300,'["interests:beleza"]','system_ranked','approved','${D.userBella}',now(),true,
     'A taxa de engajamento de 8,3% de @dudamartins e seu nicho dedicado a beleza sustentavel estao diretamente alinhados com o publico-alvo de mulheres de 18 a 30 anos desta campanha de lancamento vegano.',
     false,now(),now()),
    ('${D.sleBella2}','${D.slBella}','${D.campBella}','${D.crNaty}',    2, 0.7500,'["interests:beleza"]','system_ranked','approved','${D.userBella}',now(),true,
     'A especializacao de @natybeauty em beleza e skincare, com pontuacao de autenticidade de 83, oferece credibilidade natural para a recomendacao de um novo protetor solar vegano.',
     false,now(),now()),
    ('${D.sleBella3}','${D.slBella}','${D.campBella}','${D.crMarina}',  3, 0.7100,'["interests:beleza"]','system_ranked','approved','${D.userBella}',now(),true,
     'A combinacao de saude e nutricao no conteudo de @marinasaude (10,1% de engajamento) ressoa com consumidoras que buscam produtos alinhados a um estilo de vida saudavel e consciente.',
     false,now(),now()),
    ('${D.sleBella4}','${D.slBella}','${D.campBella}','${D.crCarolina}',4, 0.6900,'["interests:beleza"]','system_ranked','approved','${D.userBella}',now(),true,
     'O publico feminino e ativo de @carolinafit (24.100 seguidores, 6,1% de engajamento) representa uma oportunidade de ampliar o alcance da campanha para mulheres que valorizam produtos saudaveis e sustentaveis.',
     false,now(),now())
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 15. Shortlist entries — NovaTech Pro (ativo) ──────────────────────────
  await dataSource.query(`
    INSERT INTO campaign_shortlist_entry (
      id, shortlist_id, campaign_id, creator_id, rank, fit_score, matched_attributes,
      origin, decision, decision_by_user_id, decision_at, included,
      fit_reason, fit_reason_unavailable, created_at, updated_at
    ) VALUES
    ('${D.sleNova1}','${D.slNovatech}','${D.campNovatech}','${D.crPedro}', 1,0.8700,'["interests:tecnologia"]','system_ranked','approved','${D.userNovatech}',now(),true,
     'Com 9,2% de engajamento e nicho focado em tecnologia e games, @pedrogeek atinge exatamente o publico-alvo de entusiastas de tecnologia entre 20 e 35 anos desta campanha de lancamento.',
     false,now(),now()),
    ('${D.sleNova2}','${D.slNovatech}','${D.campNovatech}','${D.crBruno}', 2,0.7600,'["interests:tecnologia"]','system_ranked','approved','${D.userNovatech}',now(),true,
     'O foco de @brunotech em gadgets e inovacao (5,3% de engajamento, 20.500 seguidores) garante relevancia direta para a audiencia de tecnologia da NovaTech Pro.',
     false,now(),now()),
    ('${D.sleNova3}','${D.slNovatech}','${D.campNovatech}','${D.crThiago}',3,0.4800,'[]','system_ranked','approved','${D.userNovatech}',now(),true,
     'O publico amplo de @thiagoviagem (42.000 seguidores) oferece alcance significativo, embora seu nicho de viagens tenha compatibilidade parcial com tecnologia de consumo.',
     false,now(),now())
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 16. Shortlist entries — Bella Q4 (encerrada) ─────────────────────────
  await dataSource.query(`
    INSERT INTO campaign_shortlist_entry (
      id, shortlist_id, campaign_id, creator_id, rank, fit_score, matched_attributes,
      origin, decision, decision_by_user_id, decision_at, included,
      fit_reason, fit_reason_unavailable, created_at, updated_at
    ) VALUES
    ('${D.sleBellaQ4a}','${D.slBellaQ4}','${D.campBellaQ4}','${D.crDuda}',  1,0.8500,'["interests:beleza"]','system_ranked','approved','${D.userBella}','${past90d}',true,
     '@dudamartins e sua audiencia de beleza sustentavel sao a escolha natural para apresentar o hidratante noturno — engajamento autentico de 8,3% garante conversao real.',
     false,'${past90d}','${past90d}'),
    ('${D.sleBellaQ4b}','${D.slBellaQ4}','${D.campBellaQ4}','${D.crNaty}',  2,0.8000,'["interests:beleza"]','system_ranked','approved','${D.userBella}','${past90d}',true,
     'O nicho de skincare de @natybeauty combina diretamente com o posicionamento do hidratante noturno — score de autenticidade 83 reforça credibilidade com o publico 25-40.',
     false,'${past90d}','${past90d}'),
    ('${D.sleBellaQ4c}','${D.slBellaQ4}','${D.campBellaQ4}','${D.crMarina}',3,0.7300,'["interests:beleza"]','system_ranked','approved','${D.userBella}','${past90d}',true,
     'A audiencia consciente de @marinasaude (saude e nutricao) tem alta afinidade com cosmeticos de ingredientes naturais e rotina de cuidados.',
     false,'${past90d}','${past90d}')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 17. Shortlist entries — BF NovaTech (encerrada) ──────────────────────
  await dataSource.query(`
    INSERT INTO campaign_shortlist_entry (
      id, shortlist_id, campaign_id, creator_id, rank, fit_score, matched_attributes,
      origin, decision, decision_by_user_id, decision_at, included,
      fit_reason, fit_reason_unavailable, created_at, updated_at
    ) VALUES
    ('${D.sleNovaBF1}','${D.slNovaBF}','${D.campNovaBF}','${D.crPedro}', 1,0.9100,'["interests:tecnologia"]','system_ranked','approved','${D.userNovatech}','${past90d}',true,
     '@pedrogeek e referencia em reviews de smartphones para o publico jovem — 9,2% de engajamento em posts de tecnologia garante visibilidade qualificada para a oferta de Black Friday.',
     false,'${past90d}','${past90d}'),
    ('${D.sleNovaBF2}','${D.slNovaBF}','${D.campNovaBF}','${D.crBruno}', 2,0.7800,'["interests:tecnologia"]','system_ranked','approved','${D.userNovatech}','${past90d}',true,
     'A base de 20.500 seguidores de @brunotech em gadgets e inovacao complementa o alcance da campanha com um publico ja predisposto a compras de tecnologia em datas especiais.',
     false,'${past90d}','${past90d}'),
    ('${D.sleNovaBF3}','${D.slNovaBF}','${D.campNovaBF}','${D.crThiago}',3,0.5200,'[]','system_ranked','approved','${D.userNovatech}','${past90d}',true,
     'O grande alcance de @thiagoviagem (42.000 seguidores) amplia a visibilidade da campanha de Black Friday alem do nicho de tecnologia — risco de menor intencao de compra compensado pelo volume.',
     false,'${past90d}','${past90d}')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 18. Pool members ──────────────────────────────────────────────────────
  // Status 'published' = oportunidade aceita e conteudo em andamento/entregue
  await dataSource.query(`
    INSERT INTO campaign_pool_member (id, campaign_id, creator_id, allocated_budget, original_budget, committed_budget, status, created_at, updated_at) VALUES
    ('${D.poolBellaDuda}',    '${D.campBella}',    '${D.crDuda}',    5000, 5000, 5000, 'published', now(), now()),
    ('${D.poolBellaCarolina}','${D.campBella}',    '${D.crCarolina}',5000, 5000, 5000, 'published', now(), now()),
    ('${D.poolBellaNaty}',    '${D.campBella}',    '${D.crNaty}',    5000, 5000, 5000, 'published', now(), now()),
    ('${D.poolBellaMarina}',  '${D.campBella}',    '${D.crMarina}',  5000, 5000, 5000, 'published', now(), now()),
    ('${D.poolNovaPedro}',    '${D.campNovatech}', '${D.crPedro}',   8333, 8333, 8333, 'published', now(), now()),
    ('${D.poolNovaBruno}',    '${D.campNovatech}', '${D.crBruno}',   8333, 8333, 8333, 'published', now(), now()),
    ('${D.poolNovaThiago}',   '${D.campNovatech}', '${D.crThiago}',  8333, 8333, 8333, 'published', now(), now()),
    ('${D.poolQ4Duda}',       '${D.campBellaQ4}',  '${D.crDuda}',    5000, 5000, 5000, 'published', '${past90d}', '${past30d}'),
    ('${D.poolQ4Naty}',       '${D.campBellaQ4}',  '${D.crNaty}',    5000, 5000, 5000, 'published', '${past90d}', '${past30d}'),
    ('${D.poolQ4Marina}',     '${D.campBellaQ4}',  '${D.crMarina}',  5000, 5000, 5000, 'published', '${past90d}', '${past30d}'),
    ('${D.poolBFPedro}',      '${D.campNovaBF}',   '${D.crPedro}',   8333, 8333, 8333, 'published', '${past90d}', '${past30d}'),
    ('${D.poolBFBruno}',      '${D.campNovaBF}',   '${D.crBruno}',   8333, 8333, 8333, 'published', '${past90d}', '${past30d}'),
    ('${D.poolBFThiago}',     '${D.campNovaBF}',   '${D.crThiago}',  8333, 8333, 8333, 'published', '${past90d}', '${past30d}')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 19. Opportunities — Bella Verão (ativa) ───────────────────────────────
  await dataSource.query(`
    INSERT INTO campaign_opportunity (
      id, campaign_id, creator_id, shortlist_entry_id,
      deliverable, payout_gross, payout_commission, payout_net,
      expires_at, status, responded_at, created_at
    ) VALUES
    ('${D.oppBellaDuda}',    '${D.campBella}','${D.crDuda}',    '${D.sleBella1}','{"format":"reels","quantity":1}',5000,750,4250,'${expiry30d}','accepted',now(),now()),
    ('${D.oppBellaCarolina}','${D.campBella}','${D.crCarolina}','${D.sleBella2}','{"format":"reels","quantity":1}',5000,750,4250,'${expiry30d}','accepted',now(),now()),
    ('${D.oppBellaNaty}',    '${D.campBella}','${D.crNaty}',    '${D.sleBella3}','{"format":"reels","quantity":1}',5000,750,4250,'${expiry30d}','accepted',now(),now()),
    ('${D.oppBellaMarina}',  '${D.campBella}','${D.crMarina}',  '${D.sleBella4}','{"format":"reels","quantity":1}',5000,750,4250,'${expiry30d}','accepted',now(),now())
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 20. Opportunities — NovaTech Pro (ativo) ──────────────────────────────
  await dataSource.query(`
    INSERT INTO campaign_opportunity (
      id, campaign_id, creator_id, shortlist_entry_id,
      deliverable, payout_gross, payout_commission, payout_net,
      expires_at, status, responded_at, created_at
    ) VALUES
    ('${D.oppNovaPedro}', '${D.campNovatech}','${D.crPedro}', '${D.sleNova1}','{"format":"feed","quantity":1}',8333,1250,7083,'${expiry30d}','accepted',now(),now()),
    ('${D.oppNovaBruno}', '${D.campNovatech}','${D.crBruno}', '${D.sleNova2}','{"format":"feed","quantity":1}',8333,1250,7083,'${expiry30d}','accepted',now(),now()),
    ('${D.oppNovaThiago}','${D.campNovatech}','${D.crThiago}','${D.sleNova3}','{"format":"feed","quantity":1}',8333,1250,7083,'${expiry30d}','accepted',now(),now())
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 21. Opportunities — Bella Q4 (encerrada) ─────────────────────────────
  await dataSource.query(`
    INSERT INTO campaign_opportunity (
      id, campaign_id, creator_id, shortlist_entry_id,
      deliverable, payout_gross, payout_commission, payout_net,
      expires_at, status, responded_at, created_at
    ) VALUES
    ('${D.oppQ4Duda}',  '${D.campBellaQ4}','${D.crDuda}',  '${D.sleBellaQ4a}','{"format":"reels","quantity":1}',5000,750,4250,'${past30d}','accepted','${past90d}','${past90d}'),
    ('${D.oppQ4Naty}',  '${D.campBellaQ4}','${D.crNaty}',  '${D.sleBellaQ4b}','{"format":"reels","quantity":1}',5000,750,4250,'${past30d}','accepted','${past90d}','${past90d}'),
    ('${D.oppQ4Marina}','${D.campBellaQ4}','${D.crMarina}','${D.sleBellaQ4c}','{"format":"reels","quantity":1}',5000,750,4250,'${past30d}','accepted','${past90d}','${past90d}')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 22. Opportunities — BF NovaTech (encerrada) ───────────────────────────
  await dataSource.query(`
    INSERT INTO campaign_opportunity (
      id, campaign_id, creator_id, shortlist_entry_id,
      deliverable, payout_gross, payout_commission, payout_net,
      expires_at, status, responded_at, created_at
    ) VALUES
    ('${D.oppBFPedro}', '${D.campNovaBF}','${D.crPedro}', '${D.sleNovaBF1}','{"format":"feed","quantity":1}',8333,1250,7083,'${past30d}','accepted','${past90d}','${past90d}'),
    ('${D.oppBFBruno}', '${D.campNovaBF}','${D.crBruno}', '${D.sleNovaBF2}','{"format":"feed","quantity":1}',8333,1250,7083,'${past30d}','accepted','${past90d}','${past90d}'),
    ('${D.oppBFThiago}','${D.campNovaBF}','${D.crThiago}','${D.sleNovaBF3}','{"format":"feed","quantity":1}',8333,1250,7083,'${past30d}','accepted','${past90d}','${past90d}')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 23. Briefings ─────────────────────────────────────────────────────────
  await dataSource.query(`
    INSERT INTO briefing (
      id, campaign_id, dos, donts, reference_examples, deliverable_spec, deadline,
      status, issued_at, issued_by_user_id, created_by_user_id, created_at, updated_at
    ) VALUES (
      '${D.briefingBella}', '${D.campBella}',
      '["Destacar que o produto e vegano e livre de crueldade animal","Usar a hashtag #BellaNatural em todos os posts","Mostrar o produto em uso no cotidiano","Mencionar a textura leve e o cheiro agradavel"]',
      '["Nao mencionar ingredientes quimicos pelo nome","Nao comparar diretamente com marcas concorrentes","Nao fazer afirmacoes medicas sobre o produto","Nao mostrar o produto sem demonstrar seu uso"]',
      '["https://instagram.com/p/exemplo1","https://instagram.com/p/exemplo2"]',
      '{"format":"Reels","quantity":1,"aspect_ratio":"9:16","caption_length_limit":2200,"mandatory_hashtags":["#BellaNatural","#VeganBeauty"],"notes":"Reels de no maximo 30 segundos. Primeira cena deve mostrar o produto."}',
      '${expiry45d}',
      'issued', now(), '${D.userBella}', '${D.userBella}', now(), now()
    )
    ON CONFLICT (id) DO NOTHING
  `);

  await dataSource.query(`
    INSERT INTO briefing (
      id, campaign_id, dos, donts, reference_examples, deliverable_spec, deadline,
      status, issued_at, issued_by_user_id, created_by_user_id, created_at, updated_at
    ) VALUES (
      '${D.briefingQ4}', '${D.campBellaQ4}',
      '["Mostrar aplicacao noturna do hidratante","Mencionar ingrediente acido hialuronico","Usar hashtag #BellaNight","Mostrar resultado ao acordar se possivel"]',
      '["Nao comparar com produtos concorrentes","Nao fazer claims medicos como cura ou trata","Nao mencionar preco"]',
      '[]',
      '{"format":"Reels","quantity":1,"aspect_ratio":"9:16","caption_length_limit":2200,"mandatory_hashtags":["#BellaNight","#SkincareBR"],"notes":"Reels de ate 30 segundos mostrando rotina noturna."}',
      '${past30d}',
      'issued', '${past90d}', '${D.userBella}', '${D.userBella}', '${past90d}', '${past90d}'
    )
    ON CONFLICT (id) DO NOTHING
  `);

  await dataSource.query(`
    INSERT INTO briefing (
      id, campaign_id, dos, donts, reference_examples, deliverable_spec, deadline,
      status, issued_at, issued_by_user_id, created_by_user_id, created_at, updated_at
    ) VALUES (
      '${D.briefingNovaBF}', '${D.campNovaBF}',
      '["Destacar o desconto de ate 40% da Black Friday","Mostrar o produto em uso real","Incluir link na bio na legenda","Mencionar que e por tempo limitado"]',
      '["Nao citar outros smartphones pelo nome","Nao usar o termo o melhor do mercado","Nao garantir disponibilidade de estoque"]',
      '[]',
      '{"format":"feed","quantity":1,"aspect_ratio":"1:1","caption_length_limit":2200,"mandatory_hashtags":["#NovaTechBF","#BlackFridayTech"],"notes":"Post feed com chamada clara para o link na bio."}',
      '${past30d}',
      'issued', '${past90d}', '${D.userNovatech}', '${D.userNovatech}', '${past90d}', '${past90d}'
    )
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 24. Submissões — Bella Verão (ativa) ─────────────────────────────────
  await dataSource.query(`
    INSERT INTO content_submission (
      id, campaign_id, creator_id, opportunity_id,
      caption_text, on_screen_text, audio_transcript,
      extraction_status, root_submission_id, version_number,
      created_at, updated_at
    ) VALUES
    ('${D.subNaty}','${D.campBella}','${D.crNaty}','${D.oppBellaNaty}',
     'Teste em animais? Nunca mais! Essa linha da Bella Natural e 100% vegana #BellaNatural',
     null,null,'not_required','${D.subNaty}',1,now(),now()),
    ('${D.subCarolina}','${D.campBella}','${D.crCarolina}','${D.oppBellaCarolina}',
     'To amando o novo protetor da Bella, parece que cura qualquer dano solar -- ja virei fa! #BellaNatural',
     null,null,'not_required','${D.subCarolina}',1,now(),now())
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 25. Submissão — NovaTech Pro: @pedrogeek pending safety ──────────────
  await dataSource.query(`
    INSERT INTO content_submission (
      id, campaign_id, creator_id, opportunity_id,
      caption_text, on_screen_text, audio_transcript,
      extraction_status, root_submission_id, version_number,
      created_at, updated_at
    ) VALUES (
      '${D.subNovaPedro}','${D.campNovatech}','${D.crPedro}','${D.oppNovaPedro}',
      'O NovaTech Pro chegou e e o melhor do mercado! Testei por uma semana e nao larguei mais. #NovaTechPro #tech',
      null,null,'not_required','${D.subNovaPedro}',1,now(),now()
    )
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 26. Submissões — Bella Q4 (encerradas, com published_at) ─────────────
  await dataSource.query(`
    INSERT INTO content_submission (
      id, campaign_id, creator_id, opportunity_id,
      caption_text, on_screen_text, audio_transcript,
      extraction_status, root_submission_id, version_number,
      published_url, published_at, created_at, updated_at
    ) VALUES
    ('${D.subQ4Duda}','${D.campBellaQ4}','${D.crDuda}','${D.oppQ4Duda}',
     'Minha rotina noturna ficou completa com o hidratante @BellaNatural! Acido hialuronico fazendo todo o trabalho enquanto durmo #BellaNight #SkincareBR',
     null,null,'not_required','${D.subQ4Duda}',1,
     'https://instagram.com/p/q4duda_demo','${past60d}','${past90d}','${past60d}'),
    ('${D.subQ4Naty}','${D.campBellaQ4}','${D.crNaty}','${D.oppQ4Naty}',
     'Testei o hidratante noturno Bella por 30 dias — resultado incrivel! Pele visivelmente mais hidratada #BellaNight #skincare',
     null,null,'not_required','${D.subQ4Naty}',1,
     'https://instagram.com/p/q4naty_demo','${past60d}','${past90d}','${past60d}'),
    ('${D.subQ4Marina}','${D.campBellaQ4}','${D.crMarina}','${D.oppQ4Marina}',
     'Como nutricionista, valorizo ingredientes de qualidade — e o hidratante noturno Bella usa acido hialuronico puro. Aprovado! #BellaNight #saude',
     null,null,'not_required','${D.subQ4Marina}',1,
     'https://instagram.com/p/q4marina_demo','${past60d}','${past90d}','${past60d}')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 27. Submissões — BF NovaTech (encerradas, com published_at) ──────────
  await dataSource.query(`
    INSERT INTO content_submission (
      id, campaign_id, creator_id, opportunity_id,
      caption_text, on_screen_text, audio_transcript,
      extraction_status, root_submission_id, version_number,
      published_url, published_at, created_at, updated_at
    ) VALUES
    ('${D.subBFPedro}','${D.campNovaBF}','${D.crPedro}','${D.oppBFPedro}',
     'Black Friday chegou e o NovaTech Pro com 40% off e imperdivel! Link na bio para garantir o seu antes que acabe. #NovaTechBF #BlackFridayTech',
     null,null,'not_required','${D.subBFPedro}',1,
     'https://instagram.com/p/bf_pedro_demo','${past60d}','${past90d}','${past60d}'),
    ('${D.subBFBruno}','${D.campNovaBF}','${D.crBruno}','${D.oppBFBruno}',
     'Essa Black Friday e diferente — 40% off no NovaTech Pro e oportunidade real. Testei e aprovei. Link na bio! #NovaTechBF #gadgets',
     null,null,'not_required','${D.subBFBruno}',1,
     'https://instagram.com/p/bf_bruno_demo','${past60d}','${past90d}','${past60d}'),
    ('${D.subBFThiago}','${D.campNovaBF}','${D.crThiago}','${D.oppBFThiago}',
     'Viajando com o NovaTech Pro na Black Friday — camera incrivel e bateria que dura o dia todo. 40% off no link da bio! #NovaTechBF #travel',
     null,null,'not_required','${D.subBFThiago}',1,
     'https://instagram.com/p/bf_thiago_demo','${past60d}','${past90d}','${past60d}')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 28. Safety checks — Bella Verão ──────────────────────────────────────
  const safetyTimeout = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await dataSource.query(`
    INSERT INTO safety_check (id, content_submission_id, campaign_id, ruleset_id, status, tier_reached, timeout_at, resolved_at, created_at)
    VALUES
    ('${D.checkNaty}',    '${D.subNaty}',    '${D.campBella}','${D.rulesetBella}','flagged','tier1',now(),now(),now()),
    ('${D.checkCarolina}','${D.subCarolina}','${D.campBella}','${D.rulesetBella}','pending',null,'${safetyTimeout}',null,now())
    ON CONFLICT (id) DO NOTHING
  `);

  await dataSource.query(`
    INSERT INTO safety_rule_trigger (id, safety_check_id, rule_id, channel, matched_excerpt, tier, created_at)
    VALUES ('${D.triggerNaty}','${D.checkNaty}','${D.ruleBella1}','caption','Teste em animais','tier1',now())
    ON CONFLICT (id) DO NOTHING
  `);

  await dataSource.query(`
    INSERT INTO safety_review_queue_item (
      id, safety_check_id, campaign_id, content_submission_id,
      reason_category, status, ai_safety_reason, decision_reason,
      decided_by_user_id, decided_at, created_at, updated_at
    ) VALUES (
      '${D.queueNaty}','${D.checkNaty}','${D.campBella}','${D.subNaty}',
      'rule_violation','pending',null,null,null,null,now(),now()
    )
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 29. Safety check — NovaTech Pro: @pedrogeek pending ──────────────────
  // Caption contém "o melhor do mercado" (ruleNova1) → flagged tier-1
  await dataSource.query(`
    INSERT INTO safety_check (id, content_submission_id, campaign_id, ruleset_id, status, tier_reached, timeout_at, resolved_at, created_at)
    VALUES ('${D.checkNovaPedro}','${D.subNovaPedro}','${D.campNovatech}','${D.rulesetNovatech}','flagged','tier1',now(),now(),now())
    ON CONFLICT (id) DO NOTHING
  `);

  await dataSource.query(`
    INSERT INTO safety_review_queue_item (
      id, safety_check_id, campaign_id, content_submission_id,
      reason_category, status, ai_safety_reason, decision_reason,
      decided_by_user_id, decided_at, created_at, updated_at
    ) VALUES (
      '${D.queueNovaPedro}','${D.checkNovaPedro}','${D.campNovatech}','${D.subNovaPedro}',
      'rule_violation','pending',null,null,null,null,now(),now()
    )
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 30. Safety checks — campanhas encerradas (all passed) ────────────────
  await dataSource.query(`
    INSERT INTO safety_check (id, content_submission_id, campaign_id, ruleset_id, status, tier_reached, timeout_at, resolved_at, created_at)
    VALUES
    ('${D.checkQ4Duda}',  '${D.subQ4Duda}',  '${D.campBellaQ4}','${D.rulesetBella}','passed','tier2','${past90d}','${past90d}','${past90d}'),
    ('${D.checkQ4Naty}',  '${D.subQ4Naty}',  '${D.campBellaQ4}','${D.rulesetBella}','passed','tier2','${past90d}','${past90d}','${past90d}'),
    ('${D.checkQ4Marina}','${D.subQ4Marina}', '${D.campBellaQ4}','${D.rulesetBella}','passed','tier2','${past90d}','${past90d}','${past90d}'),
    ('${D.checkBFPedro}', '${D.subBFPedro}',  '${D.campNovaBF}', '${D.rulesetNovatech}','passed','tier2','${past90d}','${past90d}','${past90d}'),
    ('${D.checkBFBruno}', '${D.subBFBruno}',  '${D.campNovaBF}', '${D.rulesetNovatech}','passed','tier2','${past90d}','${past90d}','${past90d}'),
    ('${D.checkBFThiago}','${D.subBFThiago}', '${D.campNovaBF}', '${D.rulesetNovatech}','passed','tier2','${past90d}','${past90d}','${past90d}')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 31. Metric snapshots — campanhas encerradas ───────────────────────────
  // Dados de alcance/engajamento usados no dashboard e performance aggregate
  await dataSource.query(`
    INSERT INTO content_submission_metric_snapshot (
      id, content_submission_id, campaign_id, creator_id,
      platform, reach, engagement, impressions,
      ingestion_status, last_successful_pull_at, last_attempted_pull_at,
      created_at, updated_at
    ) VALUES
    ('${D.snapQ4Duda}',  '${D.subQ4Duda}',  '${D.campBellaQ4}','${D.crDuda}',  'instagram',18400,1527,21000,'fresh','${past30d}','${past30d}','${past60d}','${past30d}'),
    ('${D.snapQ4Naty}',  '${D.subQ4Naty}',  '${D.campBellaQ4}','${D.crNaty}',  'instagram',13900,1057,15800,'fresh','${past30d}','${past30d}','${past60d}','${past30d}'),
    ('${D.snapQ4Marina}','${D.subQ4Marina}', '${D.campBellaQ4}','${D.crMarina}','instagram',16000,1286,18100,'fresh','${past30d}','${past30d}','${past60d}','${past30d}'),
    ('${D.snapBFPedro}', '${D.subBFPedro}',  '${D.campNovaBF}', '${D.crPedro}', 'instagram',31800,2926,36200,'fresh','${past30d}','${past30d}','${past60d}','${past30d}'),
    ('${D.snapBFBruno}', '${D.subBFBruno}',  '${D.campNovaBF}', '${D.crBruno}', 'instagram',26100,1384,29700,'fresh','${past30d}','${past30d}','${past60d}','${past30d}'),
    ('${D.snapBFThiago}','${D.subBFThiago}', '${D.campNovaBF}', '${D.crThiago}','instagram',20400, 900,23800,'fresh','${past30d}','${past30d}','${past60d}','${past30d}')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 32. Performance aggregates ────────────────────────────────────────────
  // Bella Q4: 48.300 alcance total, 3.870 engajamento
  await dataSource.query(`
    INSERT INTO campaign_performance_aggregate (
      campaign_id, delivered_creator_count, pending_delivery_creator_count,
      total_delivered_reach, total_delivered_engagement, total_delivered_impressions,
      any_stale, last_computed_at, created_at, updated_at
    ) VALUES
    ('${D.campBellaQ4}', 3, 0, 48300, 3870, 54900, false, '${past30d}', '${past60d}', '${past30d}'),
    ('${D.campNovaBF}',  3, 0, 78300, 5210, 89700, false, '${past30d}', '${past60d}', '${past30d}')
    ON CONFLICT (campaign_id) DO NOTHING
  `);

  // ── 33. Performance reports (ready, com PDF simulado) ─────────────────────
  // CPE Bella Q4 = 15000 / 3870 ≈ 3.88 | CPM = 15000 / (54900/1000) ≈ 273.2
  // CPE BF Nova  = 25000 / 5210 ≈ 4.80 | CPM = 25000 / (89700/1000) ≈ 278.7
  await dataSource.query(`
    INSERT INTO campaign_performance_report (
      id, campaign_id, status, has_deliveries,
      spend_amount, spend_source,
      total_delivered_reach, total_delivered_engagement,
      cost_per_engagement, cpm_equivalent,
      campaign_progress_label,
      pdf_document_url, csv_document_url,
      requested_by_user_id, requested_at, resolved_at
    ) VALUES
    (
      '${D.reportBellaQ4}', '${D.campBellaQ4}', 'ready', true,
      15000, 'invoice',
      48300, 3870,
      3.88, 273.2,
      'final',
      'https://aurora.internal/demo/reports/bella-q4-2026.pdf',
      'https://aurora.internal/demo/reports/bella-q4-2026.csv',
      '${D.userBella}', '${past30d}', '${past30d}'
    ),
    (
      '${D.reportNovaBF}', '${D.campNovaBF}', 'ready', true,
      25000, 'invoice',
      78300, 5210,
      4.80, 278.7,
      'final',
      'https://aurora.internal/demo/reports/bf-novatech-2026.pdf',
      'https://aurora.internal/demo/reports/bf-novatech-2026.csv',
      '${D.userNovatech}', '${past30d}', '${past30d}'
    )
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 34. Invoices ──────────────────────────────────────────────────────────
  await dataSource.query(`
    INSERT INTO invoice (id, campaign_id, total_amount, status, generated_by_user_id, issued_at, created_at) VALUES
    ('${D.invBellaQ4}','${D.campBellaQ4}',15000,'issued','${D.userBella}',   '${past30d}','${past30d}'),
    ('${D.invNovaBF}', '${D.campNovaBF}', 25000,'issued','${D.userNovatech}','${past30d}','${past30d}')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 35. Invoice line items ────────────────────────────────────────────────
  await dataSource.query(`
    INSERT INTO invoice_line_item (id, invoice_id, line_type, description, amount, created_at) VALUES
    ('${D.invLineQ4}',   '${D.invBellaQ4}','base_price','Campanha Hidratante Noturno Q4 2026 — 3 creators x R$ 5.000',15000,'${past30d}'),
    ('${D.invLineNovaBF}','${D.invNovaBF}','base_price','Campanha Black Friday NovaTech 2026 — 3 creators x R$ 8.333', 25000,'${past30d}')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 36. Payout obligations — campanhas encerradas (settled) ──────────────
  const payoutDeadline = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();

  await dataSource.query(`
    INSERT INTO payout_obligation (
      id, content_submission_id, campaign_id, creator_id, opportunity_id,
      payout_gross, payout_commission, payout_net,
      committed_deadline_at, status, settled_at, created_at, updated_at
    ) VALUES
    ('${D.payoutQ4Duda}',  '${D.subQ4Duda}',  '${D.campBellaQ4}','${D.crDuda}',  '${D.oppQ4Duda}',  5000,750,4250,'${payoutDeadline}','settled','${past30d}','${past60d}','${past30d}'),
    ('${D.payoutQ4Naty}',  '${D.subQ4Naty}',  '${D.campBellaQ4}','${D.crNaty}',  '${D.oppQ4Naty}',  5000,750,4250,'${payoutDeadline}','settled','${past30d}','${past60d}','${past30d}'),
    ('${D.payoutQ4Marina}','${D.subQ4Marina}', '${D.campBellaQ4}','${D.crMarina}','${D.oppQ4Marina}',5000,750,4250,'${payoutDeadline}','settled','${past30d}','${past60d}','${past30d}'),
    ('${D.payoutBFPedro}', '${D.subBFPedro}',  '${D.campNovaBF}', '${D.crPedro}', '${D.oppBFPedro}', 8333,1250,7083,'${payoutDeadline}','settled','${past30d}','${past60d}','${past30d}'),
    ('${D.payoutBFBruno}', '${D.subBFBruno}',  '${D.campNovaBF}', '${D.crBruno}', '${D.oppBFBruno}', 8333,1250,7083,'${payoutDeadline}','settled','${past30d}','${past60d}','${past30d}'),
    ('${D.payoutBFThiago}','${D.subBFThiago}', '${D.campNovaBF}', '${D.crThiago}','${D.oppBFThiago}',8333,1250,7083,'${payoutDeadline}','settled','${past30d}','${past60d}','${past30d}')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 37. Payout obligations — campanha ativa (owed, Duda e Carolina) ───────
  // Submissão Carolina pending safety — Duda ainda sem submission para demo ao vivo
  const payoutDueDate = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString();

  await dataSource.query(`
    INSERT INTO payout_obligation (
      id, content_submission_id, campaign_id, creator_id, opportunity_id,
      payout_gross, payout_commission, payout_net,
      committed_deadline_at, status, settled_at, created_at, updated_at
    ) VALUES
    ('${D.payoutActiveCarolina}','${D.subCarolina}','${D.campBella}','${D.crCarolina}','${D.oppBellaCarolina}',5000,750,4250,'${payoutDueDate}','owed',null,now(),now())
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 38. Q&A threads e mensagens ───────────────────────────────────────────
  // Thread 1 — Carolina, Bella Verão (existente)
  await dataSource.query(`
    INSERT INTO briefing_qa_thread (id, briefing_id, campaign_id, creator_id, created_at)
    VALUES ('${D.qaThread}','${D.briefingBella}','${D.campBella}','${D.crCarolina}',now() - interval '3 minutes')
    ON CONFLICT (id) DO NOTHING
  `);
  await dataSource.query(`
    INSERT INTO briefing_qa_message (id, thread_id, campaign_id, sender_type, sender_creator_id, sender_user_id, body, created_at)
    VALUES
    ('${D.qaMsg1}','${D.qaThread}','${D.campBella}','creator','${D.crCarolina}',null,
     'Posso mencionar que uso o produto no dia a dia ou precisa parecer uma primeira experiencia?',
     now() - interval '3 minutes'),
    ('${D.qaMsg2}','${D.qaThread}','${D.campBella}','creator','${D.crCarolina}',null,
     'O Reels pode ter musica de fundo ou precisa ser so a minha voz?',
     now() - interval '2 minutes')
    ON CONFLICT (id) DO NOTHING
  `);

  // Thread 2 — Duda, Bella Verão (novo)
  await dataSource.query(`
    INSERT INTO briefing_qa_thread (id, briefing_id, campaign_id, creator_id, created_at)
    VALUES ('${D.qaThreadDuda}','${D.briefingBella}','${D.campBella}','${D.crDuda}',now() - interval '1 minute')
    ON CONFLICT (id) DO NOTHING
  `);
  await dataSource.query(`
    INSERT INTO briefing_qa_message (id, thread_id, campaign_id, sender_type, sender_creator_id, sender_user_id, body, created_at)
    VALUES (
      '${D.qaMsg3}','${D.qaThreadDuda}','${D.campBella}','creator','${D.crDuda}',null,
      'A hashtag #BellaNatural precisa aparecer na legenda ou pode ser no primeiro comentario?',
      now() - interval '1 minute'
    )
    ON CONFLICT (id) DO NOTHING
  `);

  // Thread 3 — Pedro, NovaTech Pro (novo)
  // Briefing da campanha NovaTech Pro ainda não seeded separadamente —
  // usa o briefing da Bella só se houver um para NovaTech; como não há,
  // usamos briefingNovaBF que cobre a campanha ativa via campNovatech.
  // O thread precisa de um briefing_id — usa briefingQ4 como proxy de
  // campNovatech pois não existe briefing seeded para campNovatech ativa.
  // Para ser correto, criamos um briefing para NovaTech Pro também.
  const briefingNovaPro = dId('briefing:lancamento-novatech-pro');
  await dataSource.query(`
    INSERT INTO briefing (
      id, campaign_id, dos, donts, reference_examples, deliverable_spec, deadline,
      status, issued_at, issued_by_user_id, created_by_user_id, created_at, updated_at
    ) VALUES (
      '${briefingNovaPro}', '${D.campNovatech}',
      '["Mostrar o produto em uso real","Destacar diferenciais tecnicos como camera e bateria","Incluir link na bio na legenda","Usar hashtag #NovaTechPro"]',
      '["Nao usar o termo o melhor do mercado","Nao citar Samsung ou Apple pelo nome","Nao garantir disponibilidade ou preco especifico"]',
      '[]',
      '{"format":"feed","quantity":1,"aspect_ratio":"1:1","caption_length_limit":2200,"mandatory_hashtags":["#NovaTechPro"],"notes":"Post feed com chamada para link na bio."}',
      '${expiry45d}',
      'issued', now(), '${D.userNovatech}', '${D.userNovatech}', now(), now()
    )
    ON CONFLICT (id) DO NOTHING
  `);

  await dataSource.query(`
    INSERT INTO briefing_qa_thread (id, briefing_id, campaign_id, creator_id, created_at)
    VALUES ('${D.qaThreadPedro}','${briefingNovaPro}','${D.campNovatech}','${D.crPedro}',now() - interval '30 minutes')
    ON CONFLICT (id) DO NOTHING
  `);
  await dataSource.query(`
    INSERT INTO briefing_qa_message (id, thread_id, campaign_id, sender_type, sender_creator_id, sender_user_id, body, created_at)
    VALUES
    ('${D.qaMsg4}','${D.qaThreadPedro}','${D.campNovatech}','creator','${D.crPedro}',null,
     'Posso comparar com outros modelos da propria NovaTech dos anos anteriores?',
     now() - interval '30 minutes'),
    ('${D.qaMsg5}','${D.qaThreadPedro}','${D.campNovatech}','creator','${D.crPedro}',null,
     'O Stories precisa ter o link de swipe-up ou pode so citar o produto?',
     now() - interval '25 minutes')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 39. Agency client access — Pulso Digital gerencia NovaTech ───────────
  await dataSource.query(`
    INSERT INTO operator_client_access (id, membership_id, account_id, created_at) VALUES
    ('${D.operatorAccess}','${D.memAgency}','${D.acctNovatech}',now()),
    ('${D.operatorAccessBella}','${D.memAgency}','${D.acctBella}',now())
    ON CONFLICT (id) DO NOTHING
  `);

  // ── Relatório final ───────────────────────────────────────────────────────
  console.log('[seed:demo] Seed concluido com sucesso!');
  console.log('');
  console.log('  Usuarios (5):');
  console.log('    demo-bella@aurora.internal    Demo@2026 → Marca Bella');
  console.log('    demo-novatech@aurora.internal Demo@2026 → Marca NovaTech');
  console.log('    demo-agencia@aurora.internal  Demo@2026 → Agencia Pulso Digital');
  console.log('    demo-duda@aurora.internal     Demo@2026 → Creator @dudamartins');
  console.log('    demo-carolina@aurora.internal Demo@2026 → Creator @carolinafit');
  console.log('');
  console.log('  10 creators | 9 social accounts | 9 rate preferences');
  console.log('  2 rulesets + 6 regras | 2 agency client access (Bella + NovaTech)');
  console.log('  2 campanhas ativas  (Bella Verao 2027, NovaTech Pro)');
  console.log('  2 campanhas encerradas (Bella Q4 2026, BF NovaTech 2026)');
  console.log('  2 campaign templates');
  console.log('  13 pool members | 13 oportunidades | 4 briefings');
  console.log('  10 submissoes | 3 Q&A threads (5 perguntas sem resposta AI)');
  console.log('  Safety: 2 flagged (fila), 1 pending, 7 passed');
  console.log('  2 performance aggregates + 2 reports (ready, ROI completo)');
  console.log('  2 invoices + 2 line items');
  console.log('  8 payout obligations (6 settled + 2 owed para Duda e Carolina)');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  await dataSource.initialize();
  try {
    if (RESET_MODE) {
      await teardown();
      await seed();
    } else {
      const alreadySeeded = await checkAlreadySeeded();
      if (alreadySeeded) {
        console.error(
          "[seed:demo] Dados de seed ja existem. Execute 'npm run seed:demo:reset' para recriar.",
        );
        process.exitCode = 1;
        return;
      }
      await seed();
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error('[seed:demo] Erro durante o seed:', err);
  process.exit(1);
});
