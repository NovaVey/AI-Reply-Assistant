'use strict';

const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const nock = require('nock');
const request = require('supertest');

const {
  pool,
  applySchema,
  resetDatabase,
  acquireSuiteLock,
  releaseSuiteLock,
  lockDownNetwork,
  SEED_BUSINESS,
} = require('./helpers/testEnv');

const app = require('../backend/server');

before(async () => {
  await acquireSuiteLock();
  lockDownNetwork();
  await applySchema();
});

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  nock.cleanAll();
});

after(async () => {
  await releaseSuiteLock();
  await pool.end();
});

test('GET /api/business returns the seeded row', async () => {
  const res = await request(app).get('/api/business');

  assert.equal(res.status, 200);
  assert.equal(res.body.id, 1);
  assert.equal(res.body.business_name, SEED_BUSINESS.business_name);
  assert.equal(res.body.description, SEED_BUSINESS.description);
  assert.equal(res.body.services, SEED_BUSINESS.services);
  assert.equal(res.body.tone, SEED_BUSINESS.tone);
  assert.equal(res.body.sign_off, SEED_BUSINESS.sign_off);
  assert.ok(res.body.updated_at);
});

test('PUT /api/business updates and persists the row', async () => {
  const update = {
    business_name: 'Updated Business Name',
    description: 'An updated description.',
    services: 'Updated services list',
    tone: 'casual',
    sign_off: 'Cheers,\nThe Updated Team',
  };

  const putRes = await request(app).put('/api/business').send(update);

  assert.equal(putRes.status, 200);
  assert.equal(putRes.body.id, 1);
  assert.equal(putRes.body.business_name, update.business_name);
  assert.equal(putRes.body.description, update.description);
  assert.equal(putRes.body.services, update.services);
  assert.equal(putRes.body.tone, update.tone);
  assert.equal(putRes.body.sign_off, update.sign_off);

  // Confirm the update was actually persisted, not just echoed back.
  const getRes = await request(app).get('/api/business');
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.business_name, update.business_name);
  assert.equal(getRes.body.description, update.description);
  assert.equal(getRes.body.services, update.services);
  assert.equal(getRes.body.tone, update.tone);
  assert.equal(getRes.body.sign_off, update.sign_off);
});
