import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const TEST_DB = 'aurora_test';

function baseConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: TEST_DB,
  };
}

// No `entities` glob on either DataSource below -- both are used through
// raw .query() only (never the Repository API), and TypeORM's glob-based
// entity loading calls require() on the matched .ts files directly, which
// fails inside vitest's own module context (no tsx register hook there).
// Deliberately kept that way rather than worked around: these are
// integration tests for RLS/trigger behavior at the SQL level, not for
// TypeORM's own entity mapping.

// The role under test: same non-superuser, non-owner aurora_app the real
// app connects as. Every e2e spec should query through this, never
// appDataSource/adminDataSource, unless the test is explicitly about
// migration-role behavior (which neither of the current specs are).
export function appDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    ...baseConfig(),
    username: 'aurora_app',
    password: 'aurora_app_test_only',
  });
}

// For seeding fixtures directly (bypassing RLS deliberately, as the
// production migration role would) when a test needs rows to exist before
// it exercises the real, RLS-respecting path through appDataSource.
export function adminDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    ...baseConfig(),
    username: process.env.DB_MIGRATION_USERNAME || 'aurora',
    password: process.env.DB_MIGRATION_PASSWORD || 'aurora',
  });
}
