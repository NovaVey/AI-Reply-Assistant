'use strict';

// Shared setup/teardown helpers for the integration test suite.
//
// Every test file in tests/ requires this module FIRST (before requiring the
// Express app or anything that touches the database), so that:
//   - DATABASE_URL is validated to be present before anything tries to connect
//   - ANTHROPIC_API_KEY is defaulted to a harmless fake value (the Anthropic SDK
//     client constructor requires *some* non-empty string, but every actual HTTP
//     call in these tests is intercepted by nock, so no real key is ever used)
//   - nock is configured to block all real network access except to localhost/
//     127.0.0.1 (where supertest binds its own ephemeral port for the app under
//     test), so tests can never silently make a real call to api.anthropic.com

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. The test suite needs a real PostgreSQL database ' +
      'to run against, e.g.:\n\n' +
      '  createdb ai_reply_assistant_test\n' +
      '  DATABASE_URL=postgresql://postgres@localhost:5432/ai_reply_assistant_test npm test\n'
  );
}

if (!process.env.ANTHROPIC_API_KEY) {
  // Never used for a real request in tests - claudeService's HTTP call is always
  // intercepted by nock - but the @anthropic-ai/sdk Client constructor throws if
  // apiKey is empty/undefined, so it needs *a* value.
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-fake-key';
}

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const nock = require('nock');

// Requiring backend/db/pool here (rather than each test file requiring it
// separately) guarantees every test file shares the exact same Pool module
// instance/connection settings built from the DATABASE_URL validated above.
const pool = require('../../backend/db/pool');

const SCHEMA_PATH = path.join(__dirname, '..', '..', 'backend', 'db', 'schema.sql');

// Fixed, known business_context fixture re-seeded before every test.
const SEED_BUSINESS = {
  business_name: 'Test Business',
  description: 'A test business fixture used by the integration test suite.',
  services: 'Testing services',
  tone: 'friendly',
  sign_off: 'Thanks,\nThe Test Team',
};

// node's built-in test runner executes each matched test *file* in its own
// child process, in parallel by default. Every file in this suite calls
// resetDatabase() (TRUNCATE ... RESTART IDENTITY CASCADE) between tests, so two
// files running at the same time would stomp on each other's data. A Postgres
// session-level advisory lock, held for the lifetime of a whole test file (see
// acquireSuiteLock/releaseSuiteLock below), serializes the files against each
// other without requiring any special node --test flags.
const SUITE_LOCK_KEY = 727001;
let lockClient = null;

async function acquireSuiteLock() {
  lockClient = new Client({ connectionString: process.env.DATABASE_URL });
  await lockClient.connect();
  await lockClient.query('SELECT pg_advisory_lock($1)', [SUITE_LOCK_KEY]);
}

async function releaseSuiteLock() {
  if (!lockClient) return;
  await lockClient.query('SELECT pg_advisory_unlock($1)', [SUITE_LOCK_KEY]);
  await lockClient.end();
  lockClient = null;
}

// Applies backend/db/schema.sql verbatim. Safe to run every time: the schema
// uses CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS and an idempotent
// seed INSERT with ON CONFLICT DO NOTHING.
async function applySchema() {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  await pool.query(sql);
}

// Wipes all app tables and re-seeds a single, known business_context row, so
// each test starts from an identical, independent baseline.
async function resetDatabase() {
  await pool.query(
    'TRUNCATE TABLE replies, inquiries, business_context RESTART IDENTITY CASCADE'
  );
  await pool.query(
    `INSERT INTO business_context (id, business_name, description, services, tone, sign_off)
     VALUES (1, $1, $2, $3, $4, $5)`,
    [
      SEED_BUSINESS.business_name,
      SEED_BUSINESS.description,
      SEED_BUSINESS.services,
      SEED_BUSINESS.tone,
      SEED_BUSINESS.sign_off,
    ]
  );
}

// Blocks all real outbound network access except to localhost/127.0.0.1, which
// is where supertest binds the Express app under test. Any request to
// api.anthropic.com (or anywhere else) that isn't matched by a nock interceptor
// will throw instead of silently going out over the network.
function lockDownNetwork() {
  nock.disableNetConnect();
  nock.enableNetConnect(/^(127\.0\.0\.1|\[?::1\]?|localhost)/);
}

const ANTHROPIC_HOST = 'https://api.anthropic.com';

module.exports = {
  pool,
  applySchema,
  resetDatabase,
  acquireSuiteLock,
  releaseSuiteLock,
  lockDownNetwork,
  SEED_BUSINESS,
  ANTHROPIC_HOST,
};
