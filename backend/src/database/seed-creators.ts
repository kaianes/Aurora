import { createHash } from 'crypto';
import dataSource from './data-source.js';
import { Creator, CreatorStatus, CreatorOnboardingStatus } from './entities/index.js';

// Tier 3 item (advisor feedback): a fresh install has zero creators, so
// generating a shortlist always comes back no_viable_pool -- not because
// anything is broken, just because there's nothing to match against. This
// seeds a plausible, varied pool of qualified creators so a fresh clone
// behaves the same as the already-seeded demo environment.
//
// Deliberately NOT wired into run-migrations.ts or Railway's deploy command:
// seeding is a dev/demo convenience, not a schema change, and re-running it
// should be a deliberate choice (e.g. after wiping a local DB), not an
// automatic side effect of every deploy.
const NICHES = [
  'beleza e skincare',
  'moda',
  'fitness',
  'gastronomia',
  'viagem',
  'tecnologia',
  'games',
  'maternidade',
];

const FIRST_NAMES = [
  'Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Felipe', 'Gabriela', 'Hugo',
  'Isabela', 'João', 'Karina', 'Lucas', 'Mariana', 'Nicolas', 'Olivia',
  'Pedro', 'Queila', 'Rafael', 'Sofia', 'Thiago', 'Ursula', 'Vinicius',
  'Wesley', 'Yasmin', 'Zeca', 'Beatriz', 'Caio', 'Daniela', 'Eduardo', 'Fernanda',
];
const LAST_NAMES = [
  'Silva', 'Souza', 'Oliveira', 'Santos', 'Pereira', 'Costa', 'Rodrigues',
  'Almeida', 'Nascimento', 'Lima', 'Araújo', 'Fernandes', 'Carvalho', 'Gomes', 'Martins',
];

const SEED_COUNT = 30;
const SEED_NAMESPACE = 'aurora-seed-creator';

// Not cryptographic, just a stable, repeatable UUID-shaped id per index so
// re-running this script updates the same rows instead of duplicating them.
function deterministicUuid(index: number): string {
  const hash = createHash('sha256').update(`${SEED_NAMESPACE}:${index}`).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16), // version 4
    ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20), // variant
    hash.slice(20, 32),
  ].join('-');
}

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

async function run() {
  await dataSource.initialize();
  const repo = dataSource.getRepository(Creator);

  console.log(`Seeding ${SEED_COUNT} creators...`);

  for (let i = 0; i < SEED_COUNT; i++) {
    const id = deterministicUuid(i);
    const niche = pick(NICHES, i);
    const displayName = `${pick(FIRST_NAMES, i)} ${pick(LAST_NAMES, i * 7 + 3)}`;

    const audienceSize = 800 + ((i * 1_327) % 45_000);
    const engagementRate = (0.8 + ((i * 53) % 55) / 10).toFixed(2); // 0.8 - 6.3
    const authenticityScore = (40 + ((i * 29) % 60)).toFixed(0); // 40 - 99
    const youngShare = 0.15 + ((i * 11) % 35) / 100;
    const midShare = 0.35 + ((i * 17) % 25) / 100;
    const olderShare = Math.max(0.05, 1 - youngShare - midShare);

    await repo.save(
      repo.create({
        id,
        displayName,
        status: CreatorStatus.ACTIVE,
        onboardingStatus: CreatorOnboardingStatus.QUALIFIED,
        contentNiche: niche,
        demographicComposition: {
          '18-24': Number(youngShare.toFixed(2)),
          '25-34': Number(midShare.toFixed(2)),
          '35+': Number(olderShare.toFixed(2)),
        },
        audienceSize,
        engagementRate,
        authenticityScore,
      }),
    );
  }

  console.log(`Seeded/updated ${SEED_COUNT} creators.`);
  await dataSource.destroy();
}

run().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
