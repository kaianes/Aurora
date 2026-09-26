import dataSource from './data-source.js';

async function run() {
  await dataSource.initialize();
  console.log('Running migrations...');
  await dataSource.runMigrations();
  console.log('Migrations completed.');
  await dataSource.destroy();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
