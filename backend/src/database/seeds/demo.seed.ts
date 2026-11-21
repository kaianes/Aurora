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
 */

import { createHash } from 'crypto';
import * as dotenv from 'dotenv';
dotenv.config();

// Production guard runs before any DB connection is opened.
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

// All seed record IDs are deterministic so re-runs hit ON CONFLICT and
// teardown deletes the exact same rows.
const IDS = {
  userBella:        dId('user:bella-manager'),
  userNovatech:     dId('user:novatech-manager'),
  userAgency:       dId('user:agency-operator'),

  wsBella:          dId('workspace:bella'),
  wsNovatech:       dId('workspace:novatech'),
  wsAgency:         dId('workspace:agencia-pulso'),

  acctBella:        dId('account:bella'),
  acctNovatech:     dId('account:novatech'),
  acctAgency:       dId('account:agencia-pulso'),

  memBella:         dId('membership:bella'),
  memNovatech:      dId('membership:novatech'),
  memAgency:        dId('membership:agencia'),

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

  rulesetBella:     dId('ruleset:bella-brand'),
  rulesetNovatech:  dId('ruleset:novatech-brand'),
  ruleBella1:       dId('rule:bella-testes-animais'),
  ruleBella2:       dId('rule:bella-parabenos'),
  ruleBella3:       dId('rule:bella-natura'),
  ruleNova1:        dId('rule:nova-melhor-mercado'),
  ruleNova2:        dId('rule:nova-garantia-vida'),
  ruleNova3:        dId('rule:nova-samsung'),

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

  qaThread:         dId('qa-thread:bella-carolina'),
  qaMsg1:           dId('qa-msg:bella-carolina-1'),
  qaMsg2:           dId('qa-msg:bella-carolina-2'),
};

async function checkAlreadySeeded(): Promise<boolean> {
  const rows = await dataSource.query(
    `SELECT id FROM creator WHERE id = $1 LIMIT 1`,
    [IDS.crDuda],
  );
  return rows.length > 0;
}

async function teardown(): Promise<void> {
  console.log('[seed:demo] Removendo dados de seed existentes...');
  const D = IDS;

  await dataSource.query(`DELETE FROM briefing_qa_message WHERE id IN ('${D.qaMsg1}','${D.qaMsg2}')`);
  await dataSource.query(`DELETE FROM briefing_qa_thread WHERE id = '${D.qaThread}'`);
  await dataSource.query(`DELETE FROM safety_review_queue_item WHERE id = '${D.queueNaty}'`);
  await dataSource.query(`DELETE FROM safety_rule_trigger WHERE id = '${D.triggerNaty}'`);
  await dataSource.query(`DELETE FROM safety_check WHERE id IN ('${D.checkDuda}','${D.checkNaty}','${D.checkCarolina}')`);
  await dataSource.query(`DELETE FROM content_submission WHERE id IN ('${D.subDuda}','${D.subNaty}','${D.subCarolina}')`);
  await dataSource.query(`DELETE FROM briefing WHERE id = '${D.briefingBella}'`);
  await dataSource.query(`DELETE FROM campaign_opportunity WHERE id IN ('${D.oppBellaDuda}','${D.oppBellaCarolina}','${D.oppBellaNaty}','${D.oppBellaMarina}','${D.oppNovaPedro}','${D.oppNovaBruno}','${D.oppNovaThiago}')`);
  await dataSource.query(`DELETE FROM campaign_shortlist_entry WHERE id IN ('${D.sleBella1}','${D.sleBella2}','${D.sleBella3}','${D.sleBella4}','${D.sleNova1}','${D.sleNova2}','${D.sleNova3}')`);
  await dataSource.query(`DELETE FROM campaign_shortlist WHERE id IN ('${D.slBella}','${D.slNovatech}')`);
  await dataSource.query(`DELETE FROM campaign WHERE id IN ('${D.campBella}','${D.campNovatech}')`);
  await dataSource.query(`DELETE FROM safety_rule WHERE id IN ('${D.ruleBella1}','${D.ruleBella2}','${D.ruleBella3}','${D.ruleNova1}','${D.ruleNova2}','${D.ruleNova3}')`);
  await dataSource.query(`DELETE FROM safety_ruleset WHERE id IN ('${D.rulesetBella}','${D.rulesetNovatech}')`);
  await dataSource.query(`DELETE FROM creator WHERE id IN ('${D.crDuda}','${D.crCarolina}','${D.crAna}','${D.crPedro}','${D.crLuana}','${D.crThiago}','${D.crNaty}','${D.crBruno}','${D.crMarina}','${D.crJessica}')`);
  await dataSource.query(`DELETE FROM membership WHERE id IN ('${D.memBella}','${D.memNovatech}','${D.memAgency}')`);
  await dataSource.query(`DELETE FROM account WHERE id IN ('${D.acctBella}','${D.acctNovatech}','${D.acctAgency}')`);
  await dataSource.query(`DELETE FROM workspace WHERE id IN ('${D.wsBella}','${D.wsNovatech}','${D.wsAgency}')`);
  await dataSource.query(`DELETE FROM "user" WHERE id IN ('${D.userBella}','${D.userNovatech}','${D.userAgency}')`);

  console.log('[seed:demo] Teardown concluido.');
}

async function seed(): Promise<void> {
  console.log('[seed:demo] Iniciando seed de dados de demonstracao E10...');
  const D = IDS;

  // All UUIDs are deterministic from SEED_NS so they carry no user data.
  // Using string interpolation here is safe -- these are hex strings only.

  // Users (demo-only, placeholder password_hash that cannot log in)
  await dataSource.query(`
    INSERT INTO "user" (id, email, password_hash, name, email_verified, created_at, updated_at) VALUES
    ('${D.userBella}',    'demo-bella@aurora.internal',    '$2b$10$demoHashBellaXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',    'Marina Bella Demo',           true, now(), now()),
    ('${D.userNovatech}', 'demo-novatech@aurora.internal', '$2b$10$demoHashNovatechXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', 'Marina NovaTech Demo',        true, now(), now()),
    ('${D.userAgency}',   'demo-agencia@aurora.internal',  '$2b$10$demoHashAgenciaXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',  'Operador Agencia Pulso Demo', true, now(), now())
    ON CONFLICT (id) DO NOTHING
  `);

  // Workspaces
  await dataSource.query(`
    INSERT INTO workspace (id, type, name, created_at, updated_at) VALUES
    ('${D.wsBella}',    'brand',  'Bella Natural Cosmeticos', now(), now()),
    ('${D.wsNovatech}', 'brand',  'NovaTech Eletronicos',     now(), now()),
    ('${D.wsAgency}',   'agency', 'Agencia Pulso Digital',    now(), now())
    ON CONFLICT (id) DO NOTHING
  `);

  // Accounts
  await dataSource.query(`
    INSERT INTO account (id, workspace_id, name, status, created_at, updated_at) VALUES
    ('${D.acctBella}',    '${D.wsBella}',    'Bella Natural Cosmeticos', 'active', now(), now()),
    ('${D.acctNovatech}', '${D.wsNovatech}', 'NovaTech Eletronicos',     'active', now(), now()),
    ('${D.acctAgency}',   '${D.wsAgency}',   'Agencia Pulso Digital',    'active', now(), now())
    ON CONFLICT (id) DO NOTHING
  `);

  // Memberships
  await dataSource.query(`
    INSERT INTO membership (id, user_id, account_id, role, created_at, updated_at) VALUES
    ('${D.memBella}',    '${D.userBella}',    '${D.acctBella}',    'brand_manager',   now(), now()),
    ('${D.memNovatech}', '${D.userNovatech}', '${D.acctNovatech}', 'brand_manager',   now(), now()),
    ('${D.memAgency}',   '${D.userAgency}',   '${D.acctAgency}',   'agency_operator', now(), now())
    ON CONFLICT (id) DO NOTHING
  `);

  // Creators (10 total -- section 10.4 of the E10 architecture doc)
  await dataSource.query(`
    INSERT INTO creator (
      id, display_name, status, onboarding_status, content_niche,
      audience_size, engagement_rate, authenticity_score, authenticity_status,
      demographic_composition, created_at, updated_at
    ) VALUES
    ('${D.crDuda}',    '@dudamartins',  'active', 'qualified', 'beleza sustentavel',  18400, 8.3,  87, 'scored',  '{"18-24":0.45,"25-34":0.35,"35+":0.20}', now(), now()),
    ('${D.crCarolina}','@carolinafit',  'active', 'qualified', 'fitness e bem-estar', 24100, 6.1,  79, 'scored',  '{"18-24":0.38,"25-34":0.42,"35+":0.20}', now(), now()),
    ('${D.crAna}',     '@anafashionbr', 'active', 'qualified', 'moda feminina',       31200, 4.7,  72, 'scored',  '{"18-24":0.50,"25-34":0.33,"35+":0.17}', now(), now()),
    ('${D.crPedro}',   '@pedrogeek',    'active', 'qualified', 'tecnologia e games',  15800, 9.2,  91, 'scored',  '{"18-24":0.42,"25-34":0.40,"35+":0.18}', now(), now()),
    ('${D.crLuana}',   '@luanacook',    'active', 'qualified', 'culinaria saudavel',  12600, 11.4, 94, 'scored',  '{"18-24":0.30,"25-34":0.45,"35+":0.25}', now(), now()),
    ('${D.crThiago}',  '@thiagoviagem', 'active', 'qualified', 'viagens e lifestyle', 42000, 3.8,  61, 'scored',  '{"18-24":0.25,"25-34":0.48,"35+":0.27}', now(), now()),
    ('${D.crNaty}',    '@natybeauty',   'active', 'qualified', 'beleza e skincare',    9700, 7.6,  83, 'scored',  '{"18-24":0.48,"25-34":0.36,"35+":0.16}', now(), now()),
    ('${D.crBruno}',   '@brunotech',    'active', 'qualified', 'gadgets e inovacao',  20500, 5.3,  76, 'scored',  '{"18-24":0.40,"25-34":0.43,"35+":0.17}', now(), now()),
    ('${D.crMarina}',  '@marinasaude',  'active', 'qualified', 'saude e nutricao',     8200, 10.1, 88, 'scored',  '{"18-24":0.35,"25-34":0.44,"35+":0.21}', now(), now()),
    ('${D.crJessica}', '@jessicaarte',  'active', 'pending',   'arte e ilustracao',    6400, 13.2, 95, 'pending', '{"18-24":0.52,"25-34":0.33,"35+":0.15}', now(), now())
    ON CONFLICT (id) DO NOTHING
  `);

  // Safety rulesets (brand scope)
  await dataSource.query(`
    INSERT INTO safety_ruleset (id, account_id, scope, campaign_id, created_by_user_id, created_at, updated_at) VALUES
    ('${D.rulesetBella}',    '${D.acctBella}',    'brand', null, '${D.userBella}',    now(), now()),
    ('${D.rulesetNovatech}', '${D.acctNovatech}', 'brand', null, '${D.userNovatech}', now(), now())
    ON CONFLICT (id) DO NOTHING
  `);

  // Safety rules -- Bella Natural Cosmeticos
  await dataSource.query(`
    INSERT INTO safety_rule (id, ruleset_id, rule_type, definition, action, supersedes_rule_id, created_by_user_id, created_at, updated_at) VALUES
    ('${D.ruleBella1}', '${D.rulesetBella}', 'prohibited_topic',   '{"topic":"testes em animais"}',                           'add', null, '${D.userBella}', now(), now()),
    ('${D.ruleBella2}', '${D.rulesetBella}', 'prohibited_topic',   '{"topic":"parabenos"}',                                   'add', null, '${D.userBella}', now(), now()),
    ('${D.ruleBella3}', '${D.rulesetBella}', 'competitor_mention', '{"competitor_name":"Natura Cosmeticos"}',                 'add', null, '${D.userBella}', now(), now())
    ON CONFLICT (id) DO NOTHING
  `);

  // Safety rules -- NovaTech Eletronicos
  await dataSource.query(`
    INSERT INTO safety_rule (id, ruleset_id, rule_type, definition, action, supersedes_rule_id, created_by_user_id, created_at, updated_at) VALUES
    ('${D.ruleNova1}', '${D.rulesetNovatech}', 'restricted_language', '{"pattern":"o melhor do mercado","pattern_type":"keyword"}',  'add', null, '${D.userNovatech}', now(), now()),
    ('${D.ruleNova2}', '${D.rulesetNovatech}', 'restricted_language', '{"pattern":"garantia de vida util","pattern_type":"keyword"}','add', null, '${D.userNovatech}', now(), now()),
    ('${D.ruleNova3}', '${D.rulesetNovatech}', 'competitor_mention',  '{"competitor_name":"Samsung Brasil"}',                       'add', null, '${D.userNovatech}', now(), now())
    ON CONFLICT (id) DO NOTHING
  `);

  // Campaigns (state=active, budget >= 2000 BRL per check constraint)
  await dataSource.query(`
    INSERT INTO campaign (
      id, account_id, created_by_user_id, name, state,
      message, deliverable_formats, audience_targeting,
      guaranteed_min_pool_size, budget_amount, budget_currency,
      created_at, updated_at
    ) VALUES
    (
      '${D.campBella}', '${D.acctBella}', '${D.userBella}',
      'Campanha Verao Bella 2027', 'active',
      'Lancamento de linha de protetor solar vegano, publico-alvo mulheres 18 a 30 anos, formato Reels 30 segundos, hashtag obrigatoria #BellaNatural, nao mencionar ingredientes quimicos, nao fazer comparacoes com concorrentes',
      '["reels"]',
      '{"age_range":[18,30],"interests":["beleza"],"gender":"Mulheres","geography":["Brasil"]}',
      4, 20000, 'BRL', now(), now()
    ),
    (
      '${D.campNovatech}', '${D.acctNovatech}', '${D.userNovatech}',
      'Lancamento NovaTech Pro', 'active',
      'Apresentacao do novo smartphone NovaTech Pro, publico-alvo homens e mulheres de 20 a 35 anos interessados em tecnologia, formato feed + Stories, nao usar o termo o melhor do mercado, nao mencionar Samsung',
      '["feed","stories"]',
      '{"age_range":[20,35],"interests":["tecnologia"],"geography":["Brasil"]}',
      3, 25000, 'BRL', now(), now()
    )
    ON CONFLICT (id) DO NOTHING
  `);

  // Shortlists (locked, ready)
  await dataSource.query(`
    INSERT INTO campaign_shortlist (
      id, campaign_id, status, failure_reason, below_guaranteed_minimum,
      locked, locked_reason, locked_at, resolved_at, created_at, updated_at
    ) VALUES
    ('${D.slBella}',    '${D.campBella}',    'ready', null, false, true, 'campaign_activated', now(), now(), now(), now()),
    ('${D.slNovatech}', '${D.campNovatech}', 'ready', null, false, true, 'campaign_activated', now(), now(), now(), now())
    ON CONFLICT (id) DO NOTHING
  `);

  // Shortlist entries -- Bella (4 creators, all approved, with pre-written fit_reason)
  await dataSource.query(`
    INSERT INTO campaign_shortlist_entry (
      id, shortlist_id, campaign_id, creator_id, rank, fit_score, matched_attributes,
      origin, decision, decision_by_user_id, decision_at, included,
      fit_reason, fit_reason_unavailable, created_at, updated_at
    ) VALUES
    (
      '${D.sleBella1}', '${D.slBella}', '${D.campBella}', '${D.crDuda}',
      1, 0.8300, '["interests:beleza"]', 'system_ranked', 'approved', '${D.userBella}', now(), true,
      'A taxa de engajamento de 8,3% de @dudamartins e seu nicho dedicado a beleza sustentavel estao diretamente alinhados com o publico-alvo de mulheres de 18 a 30 anos desta campanha de lancamento vegano.',
      false, now(), now()
    ),
    (
      '${D.sleBella2}', '${D.slBella}', '${D.campBella}', '${D.crCarolina}',
      2, 0.6900, '["interests:beleza"]', 'system_ranked', 'approved', '${D.userBella}', now(), true,
      'O publico feminino e ativo de @carolinafit (24.100 seguidores, 6,1% de engajamento) representa uma oportunidade de ampliar o alcance da campanha para mulheres que valorizam produtos saudaveis e sustentaveis.',
      false, now(), now()
    ),
    (
      '${D.sleBella3}', '${D.slBella}', '${D.campBella}', '${D.crNaty}',
      3, 0.7500, '["interests:beleza"]', 'system_ranked', 'approved', '${D.userBella}', now(), true,
      'A especializacao de @natybeauty em beleza e skincare, com uma pontuacao de autenticidade de 83, oferece credibilidade natural para a recomendacao de um novo protetor solar vegano.',
      false, now(), now()
    ),
    (
      '${D.sleBella4}', '${D.slBella}', '${D.campBella}', '${D.crMarina}',
      4, 0.7100, '["interests:beleza"]', 'system_ranked', 'approved', '${D.userBella}', now(), true,
      'A combinacao de saude e nutricao no conteudo de @marinasaude (10,1% de engajamento) ressoa com consumidoras que buscam produtos alinhados a um estilo de vida saudavel e consciente.',
      false, now(), now()
    )
    ON CONFLICT (id) DO NOTHING
  `);

  // Shortlist entries -- NovaTech (3 creators, all approved, with pre-written fit_reason)
  await dataSource.query(`
    INSERT INTO campaign_shortlist_entry (
      id, shortlist_id, campaign_id, creator_id, rank, fit_score, matched_attributes,
      origin, decision, decision_by_user_id, decision_at, included,
      fit_reason, fit_reason_unavailable, created_at, updated_at
    ) VALUES
    (
      '${D.sleNova1}', '${D.slNovatech}', '${D.campNovatech}', '${D.crPedro}',
      1, 0.8700, '["interests:tecnologia"]', 'system_ranked', 'approved', '${D.userNovatech}', now(), true,
      'Com 9,2% de engajamento e um nicho focado em tecnologia e games, @pedrogeek atinge exatamente o publico-alvo de entusiastas de tecnologia entre 20 e 35 anos desta campanha de lancamento.',
      false, now(), now()
    ),
    (
      '${D.sleNova2}', '${D.slNovatech}', '${D.campNovatech}', '${D.crBruno}',
      2, 0.7600, '["interests:tecnologia"]', 'system_ranked', 'approved', '${D.userNovatech}', now(), true,
      'O foco de @brunotech em gadgets e inovacao (5,3% de engajamento, 20.500 seguidores) garante relevancia direta para a audiencia de tecnologia da NovaTech Pro.',
      false, now(), now()
    ),
    (
      '${D.sleNova3}', '${D.slNovatech}', '${D.campNovatech}', '${D.crThiago}',
      3, 0.4800, '[]', 'system_ranked', 'approved', '${D.userNovatech}', now(), true,
      'O publico amplo de @thiagoviagem (42.000 seguidores) oferece alcance significativo, embora seu nicho de viagens tenha compatibilidade parcial com tecnologia de consumo.',
      false, now(), now()
    )
    ON CONFLICT (id) DO NOTHING
  `);

  // Opportunities (accepted, one per shortlist entry that is included)
  const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // Bella opportunities
  await dataSource.query(`
    INSERT INTO campaign_opportunity (
      id, campaign_id, creator_id, shortlist_entry_id,
      deliverable, payout_gross, payout_commission, payout_net,
      expires_at, status, responded_at, created_at
    ) VALUES
    ('${D.oppBellaDuda}',     '${D.campBella}', '${D.crDuda}',    '${D.sleBella1}', '{"format":"reels","quantity":1}', 5000, 750, 4250, '${expiry}', 'accepted', now(), now()),
    ('${D.oppBellaCarolina}', '${D.campBella}', '${D.crCarolina}','${D.sleBella2}', '{"format":"reels","quantity":1}', 5000, 750, 4250, '${expiry}', 'accepted', now(), now()),
    ('${D.oppBellaNaty}',     '${D.campBella}', '${D.crNaty}',    '${D.sleBella3}', '{"format":"reels","quantity":1}', 5000, 750, 4250, '${expiry}', 'accepted', now(), now()),
    ('${D.oppBellaMarina}',   '${D.campBella}', '${D.crMarina}',  '${D.sleBella4}', '{"format":"reels","quantity":1}', 5000, 750, 4250, '${expiry}', 'accepted', now(), now())
    ON CONFLICT (id) DO NOTHING
  `);

  // NovaTech opportunities
  await dataSource.query(`
    INSERT INTO campaign_opportunity (
      id, campaign_id, creator_id, shortlist_entry_id,
      deliverable, payout_gross, payout_commission, payout_net,
      expires_at, status, responded_at, created_at
    ) VALUES
    ('${D.oppNovaPedro}',  '${D.campNovatech}', '${D.crPedro}',  '${D.sleNova1}', '{"format":"feed","quantity":1}', 8333, 1250, 7083, '${expiry}', 'accepted', now(), now()),
    ('${D.oppNovaBruno}',  '${D.campNovatech}', '${D.crBruno}',  '${D.sleNova2}', '{"format":"feed","quantity":1}', 8333, 1250, 7083, '${expiry}', 'accepted', now(), now()),
    ('${D.oppNovaThiago}', '${D.campNovatech}', '${D.crThiago}', '${D.sleNova3}', '{"format":"feed","quantity":1}', 8333, 1250, 7083, '${expiry}', 'accepted', now(), now())
    ON CONFLICT (id) DO NOTHING
  `);

  // Briefing for Bella campaign (issued)
  const deadline = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString();
  await dataSource.query(`
    INSERT INTO briefing (
      id, campaign_id,
      dos, donts, reference_examples, deliverable_spec, deadline,
      status, issued_at, issued_by_user_id, created_by_user_id,
      created_at, updated_at
    ) VALUES (
      '${D.briefingBella}', '${D.campBella}',
      '["Destacar que o produto e vegano e livre de crueldade animal","Usar a hashtag #BellaNatural em todos os posts","Mostrar o produto em uso no cotidiano","Mencionar a textura leve e o cheiro agradavel"]',
      '["Nao mencionar ingredientes quimicos pelo nome","Nao comparar diretamente com marcas concorrentes","Nao fazer afirmacoes medicas sobre o produto","Nao mostrar o produto sem demonstrar seu uso"]',
      '["https://instagram.com/p/exemplo1","https://instagram.com/p/exemplo2"]',
      '{"format":"Reels","quantity":1,"aspect_ratio":"9:16","caption_length_limit":2200,"mandatory_hashtags":["#BellaNatural","#VeganBeauty"],"notes":"Reels de no maximo 30 segundos. Primeira cena deve mostrar o produto."}',
      '${deadline}',
      'issued', now(), '${D.userBella}', '${D.userBella}',
      now(), now()
    )
    ON CONFLICT (id) DO NOTHING
  `);

  // Content submissions (3 total, for Bella campaign)
  await dataSource.query(`
    INSERT INTO content_submission (
      id, campaign_id, creator_id, opportunity_id,
      caption_text, on_screen_text, audio_transcript,
      extraction_status, root_submission_id, version_number,
      created_at, updated_at
    ) VALUES
    (
      '${D.subDuda}', '${D.campBella}', '${D.crDuda}', '${D.oppBellaDuda}',
      'Amei esse protetor solar da @BellaNatural! Leve, vegano e cheiroso. #BellaNatural #VeganBeauty',
      null, null, 'not_required', '${D.subDuda}', 1, now(), now()
    ),
    (
      '${D.subNaty}', '${D.campBella}', '${D.crNaty}', '${D.oppBellaNaty}',
      'Teste em animais? Nunca mais! Essa linha da Bella Natural e 100% vegana #BellaNatural',
      null, null, 'not_required', '${D.subNaty}', 1, now(), now()
    ),
    (
      '${D.subCarolina}', '${D.campBella}', '${D.crCarolina}', '${D.oppBellaCarolina}',
      'To amando o novo protetor da Bella, parece que cura qualquer dano solar -- ja virei fa! #BellaNatural',
      null, null, 'not_required', '${D.subCarolina}', 1, now(), now()
    )
    ON CONFLICT (id) DO NOTHING
  `);

  // Safety checks
  const safetyTimeout = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  // @dudamartins: passed tier-2
  await dataSource.query(`
    INSERT INTO safety_check (id, content_submission_id, campaign_id, ruleset_id, status, tier_reached, timeout_at, resolved_at, created_at)
    VALUES ('${D.checkDuda}', '${D.subDuda}', '${D.campBella}', '${D.rulesetBella}', 'passed', 'tier2', now(), now(), now())
    ON CONFLICT (id) DO NOTHING
  `);

  // @natybeauty: flagged tier-1 (keyword "testes em animais" hit)
  await dataSource.query(`
    INSERT INTO safety_check (id, content_submission_id, campaign_id, ruleset_id, status, tier_reached, timeout_at, resolved_at, created_at)
    VALUES ('${D.checkNaty}', '${D.subNaty}', '${D.campBella}', '${D.rulesetBella}', 'flagged', 'tier1', now(), now(), now())
    ON CONFLICT (id) DO NOTHING
  `);

  // @carolinafit: pending (tier-2 not yet run, ready for live demo trigger)
  await dataSource.query(`
    INSERT INTO safety_check (id, content_submission_id, campaign_id, ruleset_id, status, tier_reached, timeout_at, created_at)
    VALUES ('${D.checkCarolina}', '${D.subCarolina}', '${D.campBella}', '${D.rulesetBella}', 'pending', null, '${safetyTimeout}', now())
    ON CONFLICT (id) DO NOTHING
  `);

  // Safety rule trigger for Naty (tier-1 exact match)
  await dataSource.query(`
    INSERT INTO safety_rule_trigger (id, safety_check_id, rule_id, channel, matched_excerpt, tier, created_at)
    VALUES ('${D.triggerNaty}', '${D.checkNaty}', '${D.ruleBella1}', 'caption', 'Teste em animais', 'tier1', now())
    ON CONFLICT (id) DO NOTHING
  `);

  // Safety review queue item for Naty (rule_violation, tier-1)
  await dataSource.query(`
    INSERT INTO safety_review_queue_item (
      id, safety_check_id, campaign_id, content_submission_id,
      reason_category, status, ai_safety_reason, decision_reason,
      decided_by_user_id, decided_at, created_at, updated_at
    ) VALUES (
      '${D.queueNaty}', '${D.checkNaty}', '${D.campBella}', '${D.subNaty}',
      'rule_violation', 'pending', null, null, null, null, now(), now()
    )
    ON CONFLICT (id) DO NOTHING
  `);

  // Briefing Q&A thread for @carolinafit on Bella campaign
  await dataSource.query(`
    INSERT INTO briefing_qa_thread (id, briefing_id, campaign_id, creator_id, created_at)
    VALUES ('${D.qaThread}', '${D.briefingBella}', '${D.campBella}', '${D.crCarolina}', now())
    ON CONFLICT (id) DO NOTHING
  `);

  // Q&A messages (2 creator messages, no AI replies -- ready for live demo)
  // sender_type = 'creator' satisfies the existing chk_message_sender constraint
  // (sender_creator_id NOT NULL, sender_user_id NULL).
  await dataSource.query(`
    INSERT INTO briefing_qa_message (id, thread_id, campaign_id, sender_type, sender_creator_id, sender_user_id, body, created_at)
    VALUES
    (
      '${D.qaMsg1}', '${D.qaThread}', '${D.campBella}', 'creator', '${D.crCarolina}', null,
      'Posso mencionar que uso o produto no dia a dia ou precisa parecer uma primeira experiencia?',
      now() - interval '2 minutes'
    ),
    (
      '${D.qaMsg2}', '${D.qaThread}', '${D.campBella}', 'creator', '${D.crCarolina}', null,
      'O Reels pode ter musica de fundo ou precisa ser so a minha voz?',
      now() - interval '1 minute'
    )
    ON CONFLICT (id) DO NOTHING
  `);

  console.log('[seed:demo] Seed concluido com sucesso!');
  console.log('[seed:demo] Registros criados:');
  console.log('  3 usuarios demo | 2 workspaces marca + 1 agencia | 3 contas');
  console.log('  10 criadores | 2 rulesets + 6 regras | 2 campanhas');
  console.log('  2 shortlists + 7 entradas com fit_reason | 7 oportunidades aceitas');
  console.log('  1 briefing emitido | 3 submissoes (passed-t2, flagged-t1, pending)');
  console.log('  1 thread Q&A com 2 perguntas (pronto para demo ao vivo)');
}

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
