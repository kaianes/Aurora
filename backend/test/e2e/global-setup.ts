import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { execFileSync } from 'child_process';

// vitest's globalSetup runs in a worker context where dotenv.config()'s
// default (process.cwd()) isn't reliably the backend/ directory -- resolve
// explicitly relative to this file instead of assuming the caller's cwd.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Tier 3 item (advisor feedback): no integration-test harness against a
// real Postgres instance existed anywhere. Every bug found and fixed
// 2026-11-02/06 that lived in a trigger or an RLS policy -- the
// BYPASSRLS gap itself, the SET LOCAL syntax error, the shortlist lock
// trigger rejecting decline, register()/login() breaking under real
// enforcement -- was invisible to the existing suite precisely because
// it's 100% mocked. This global setup gives *.e2e-spec.ts files a real,
// disposable Postgres database, connected through the same non-
// superuser role (aurora_app) the app actually runs as in production,
// so these tests can catch what a mock never could again.
//
// Runs once before the whole e2e suite (vitest's globalSetup hook).
const TEST_DB = 'aurora_test';

function adminConfig(database: string) {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_MIGRATION_USERNAME || 'aurora',
    password: process.env.DB_MIGRATION_PASSWORD || 'aurora',
    database,
  };
}

export async function setup() {
  // 1. Recreate aurora_test from scratch, every run -- a known-clean
  // slate matters more here than speed for a from-scratch e2e harness.
  const maintenance = new Client(adminConfig('postgres'));
  await maintenance.connect();
  await maintenance.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [TEST_DB],
  );
  await maintenance.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await maintenance.query(`CREATE DATABASE ${TEST_DB}`);
  await maintenance.end();

  // 2. Run every migration against it, as the admin role. Shelling out to
  // the real run-migrations.ts (the exact script Railway's deploy command
  // and the local setup instructions both already use) rather than
  // instantiating a second DataSource in-process: TypeORM's own glob-based
  // entity/migration loading uses plain require() under the hood, which
  // can't parse these .ts files inside vitest's module context (no tsx
  // register hook there) -- running it as its own tsx-executed process
  // sidesteps that entirely, and means there's only one implementation of
  // "how migrations run" to keep correct, not two.
  execFileSync('npx', ['tsx', 'src/database/run-migrations.ts'], {
    cwd: path.resolve(__dirname, '../..'),
    env: {
      ...process.env,
      DB_HOST: adminConfig(TEST_DB).host,
      DB_PORT: String(adminConfig(TEST_DB).port),
      DB_MIGRATION_USERNAME: adminConfig(TEST_DB).user,
      DB_MIGRATION_PASSWORD: adminConfig(TEST_DB).password,
      DB_DATABASE: TEST_DB,
    },
    stdio: 'inherit',
  });

  // 3. aurora_app: same non-superuser, non-owner role the real app
  // connects as (2026-11-02's BYPASSRLS fix) -- NOBYPASSRLS is the whole
  // point, it's what makes RLS policies actually apply in these tests.
  // Postgres roles are cluster-wide, not per-database, so this may
  // already exist locally (from the dev aurora_app setup) or not yet
  // (a fresh CI runner) -- CREATE only if missing, then grant access to
  // this test database specifically either way.
  const admin = new Client(adminConfig(TEST_DB));
  await admin.connect();

  const roleExists = await admin.query(`SELECT 1 FROM pg_roles WHERE rolname = 'aurora_app'`);
  if (roleExists.rowCount === 0) {
    await admin.query(
      `CREATE ROLE aurora_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'aurora_app_test_only'`,
    );
  } else {
    // Already exists cluster-wide (e.g. a developer's own aurora_app from
    // the local dev database, a different password entirely) -- always
    // reset it to the known test password so appDataSource() in
    // test-db.ts can rely on it regardless of local history.
    await admin.query(`ALTER ROLE aurora_app WITH PASSWORD 'aurora_app_test_only'`);
  }

  await admin.query(`GRANT CONNECT ON DATABASE ${TEST_DB} TO aurora_app`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO aurora_app`);
  await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO aurora_app`);
  await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO aurora_app`);
  await admin.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${adminConfig(TEST_DB).user} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aurora_app`,
  );
  await admin.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${adminConfig(TEST_DB).user} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO aurora_app`,
  );
  await admin.end();
}
