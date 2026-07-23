'use strict';

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
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
  ANTHROPIC_HOST,
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

// Builds a minimal, realistic Messages API response for a mocked Claude call.
function mockClaudeResponse(text) {
  return {
    id: 'msg_test123',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 50, output_tokens: 80 },
  };
}

function interceptClaudeDraft(text) {
  return nock(ANTHROPIC_HOST)
    .post('/v1/messages')
    .reply(200, mockClaudeResponse(text));
}

async function createInquiry(overrides = {}) {
  const payload = {
    sender_name: 'Jane Customer',
    sender_email: 'jane@example.com',
    subject: 'Question about pricing',
    category: 'pricing',
    body: 'How much do your services cost?',
    ...overrides,
  };
  const res = await request(app).post('/api/inquiries').send(payload);
  return res;
}

describe('POST /api/inquiries', () => {
  test('creates an inquiry with all fields, status pending, given category', async () => {
    const res = await createInquiry({ category: 'pricing' });

    assert.equal(res.status, 201);
    assert.equal(res.body.sender_name, 'Jane Customer');
    assert.equal(res.body.sender_email, 'jane@example.com');
    assert.equal(res.body.subject, 'Question about pricing');
    assert.equal(res.body.category, 'pricing');
    assert.equal(res.body.body, 'How much do your services cost?');
    assert.equal(res.body.status, 'pending');
    assert.ok(res.body.id);
    assert.ok(res.body.created_at);
  });

  test('defaults category to "general" when not provided', async () => {
    const res = await request(app).post('/api/inquiries').send({
      sender_name: 'No Category',
      sender_email: 'nocat@example.com',
      subject: 'Hi',
      body: 'Just saying hello.',
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.category, 'general');
    assert.equal(res.body.status, 'pending');
  });

  test('400s when body is missing', async () => {
    const res = await request(app).post('/api/inquiries').send({
      sender_name: 'Missing Body',
      sender_email: 'missing@example.com',
      subject: 'No body here',
      category: 'general',
    });

    assert.equal(res.status, 400);
    assert.ok(res.body.error);

    const list = await request(app).get('/api/inquiries');
    assert.equal(list.body.length, 0);
  });
});

describe('GET /api/inquiries', () => {
  // Inserted directly against the DB (rather than through the API, which
  // doesn't accept created_at/status) so ordering and filtering can be
  // asserted deterministically instead of racing on NOW() precision.
  async function seedInquiry({ status, category, minutesAgo }) {
    const result = await pool.query(
      `INSERT INTO inquiries (sender_name, sender_email, subject, body, category, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW() - ($7 || ' minutes')::interval)
       RETURNING *`,
      [
        `Sender ${status}`,
        `${status}@example.com`,
        `Subject ${status}`,
        `Body for ${status}`,
        category || 'general',
        status,
        minutesAgo,
      ]
    );
    return result.rows[0];
  }

  test('returns inquiries newest first', async () => {
    const oldest = await seedInquiry({ status: 'pending', minutesAgo: 30 });
    const middle = await seedInquiry({ status: 'pending', minutesAgo: 15 });
    const newest = await seedInquiry({ status: 'pending', minutesAgo: 0 });

    const res = await request(app).get('/api/inquiries');

    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.map((row) => row.id),
      [newest.id, middle.id, oldest.id]
    );
  });

  test('?status= filters to pending, drafted, or approved', async () => {
    const pending = await seedInquiry({ status: 'pending', minutesAgo: 3 });
    const drafted = await seedInquiry({ status: 'drafted', minutesAgo: 2 });
    const approved = await seedInquiry({ status: 'approved', minutesAgo: 1 });

    const pendingRes = await request(app).get('/api/inquiries?status=pending');
    assert.deepEqual(
      pendingRes.body.map((r) => r.id),
      [pending.id]
    );

    const draftedRes = await request(app).get('/api/inquiries?status=drafted');
    assert.deepEqual(
      draftedRes.body.map((r) => r.id),
      [drafted.id]
    );

    const approvedRes = await request(app).get('/api/inquiries?status=approved');
    assert.deepEqual(
      approvedRes.body.map((r) => r.id),
      [approved.id]
    );
  });
});

describe('GET /api/inquiries/:id', () => {
  test('404s for a nonexistent id', async () => {
    const res = await request(app).get('/api/inquiries/999999');
    assert.equal(res.status, 404);
    assert.ok(res.body.error);
  });

  test('returns the inquiry with reply: null before any draft exists', async () => {
    const created = await createInquiry();

    const res = await request(app).get(`/api/inquiries/${created.body.id}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.id, created.body.id);
    assert.equal(res.body.reply, null);
  });
});

describe('POST /api/inquiries/:id/draft', () => {
  test('404s for a nonexistent inquiry id', async () => {
    const scope = interceptClaudeDraft('should never be requested');

    const res = await request(app).post('/api/inquiries/999999/draft');

    assert.equal(res.status, 404);
    assert.ok(res.body.error);
    assert.equal(scope.isDone(), false);
  });

  test('drafts via the mocked Claude API, creates a reply, marks the inquiry drafted', async () => {
    const created = await createInquiry();
    const inquiryId = created.body.id;
    const draftText =
      'Thank you so much for reaching out about our pricing. ' +
      'We offer a range of options tailored to your needs. ' +
      "We'd love to talk through the details with you. Best regards.";

    const scope = interceptClaudeDraft(draftText);

    const res = await request(app).post(`/api/inquiries/${inquiryId}/draft`);

    assert.equal(res.status, 200);
    assert.equal(res.body.inquiry_id, inquiryId);
    assert.equal(res.body.draft, draftText);
    assert.equal(res.body.edited_draft, null);
    assert.equal(res.body.approved_at, null);
    assert.equal(scope.isDone(), true);

    const inquiryRes = await request(app).get(`/api/inquiries/${inquiryId}`);
    assert.equal(inquiryRes.body.status, 'drafted');
    assert.equal(inquiryRes.body.reply.draft, draftText);
  });

  test('calling draft again UPDATEs the existing reply row instead of creating a second one', async () => {
    const created = await createInquiry();
    const inquiryId = created.body.id;

    interceptClaudeDraft('First draft attempt. More words to fill it out. Best regards.');
    const firstRes = await request(app).post(`/api/inquiries/${inquiryId}/draft`);
    assert.equal(firstRes.status, 200);
    const firstReplyId = firstRes.body.id;

    const secondDraftText =
      'Second, regenerated draft attempt with different wording entirely. Best regards.';
    interceptClaudeDraft(secondDraftText);
    const secondRes = await request(app).post(`/api/inquiries/${inquiryId}/draft`);
    assert.equal(secondRes.status, 200);
    assert.equal(secondRes.body.id, firstReplyId);
    assert.equal(secondRes.body.draft, secondDraftText);

    const replyRows = await pool.query(
      'SELECT * FROM replies WHERE inquiry_id = $1',
      [inquiryId]
    );
    assert.equal(replyRows.rows.length, 1);
    assert.equal(replyRows.rows[0].draft, secondDraftText);
  });
});

describe('PATCH /api/inquiries/:id/approve', () => {
  test('400s when edited_draft is omitted', async () => {
    const created = await createInquiry();

    const res = await request(app)
      .patch(`/api/inquiries/${created.body.id}/approve`)
      .send({});

    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  test('404s when no reply exists yet for the inquiry', async () => {
    const created = await createInquiry();

    const res = await request(app)
      .patch(`/api/inquiries/${created.body.id}/approve`)
      .send({ edited_draft: 'Edited text' });

    assert.equal(res.status, 404);
    assert.ok(res.body.error);
  });

  test('sets edited_draft and approved_at, marks the inquiry approved', async () => {
    const created = await createInquiry();
    const inquiryId = created.body.id;

    interceptClaudeDraft('Original AI draft text goes here. Several sentences long. Best regards.');
    await request(app).post(`/api/inquiries/${inquiryId}/draft`);

    const editedText = 'Original AI draft text, lightly edited by a human before sending.';
    const approveRes = await request(app)
      .patch(`/api/inquiries/${inquiryId}/approve`)
      .send({ edited_draft: editedText });

    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.body.edited_draft, editedText);
    assert.ok(approveRes.body.approved_at);

    const inquiryRes = await request(app).get(`/api/inquiries/${inquiryId}`);
    assert.equal(inquiryRes.body.status, 'approved');
    assert.equal(inquiryRes.body.reply.edited_draft, editedText);
    assert.ok(inquiryRes.body.reply.approved_at);
  });
});

describe('DELETE /api/inquiries/:id', () => {
  test('404s for a nonexistent id', async () => {
    const res = await request(app).delete('/api/inquiries/999999');

    assert.equal(res.status, 404);
    assert.ok(res.body.error);
  });

  test('deletes an inquiry and returns { deleted: true, id }', async () => {
    const created = await createInquiry();
    const inquiryId = created.body.id;

    const res = await request(app).delete(`/api/inquiries/${inquiryId}`);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { deleted: true, id: inquiryId });

    const getRes = await request(app).get(`/api/inquiries/${inquiryId}`);
    assert.equal(getRes.status, 404);
  });

  test('deleting an inquiry that already has a reply cascades to remove the reply row too', async () => {
    const created = await createInquiry();
    const inquiryId = created.body.id;

    interceptClaudeDraft('A drafted reply that should be cascade-deleted with its inquiry.');
    const draftRes = await request(app).post(`/api/inquiries/${inquiryId}/draft`);
    assert.equal(draftRes.status, 200);

    // Prove the reply row exists before deletion.
    const beforeDelete = await pool.query(
      'SELECT * FROM replies WHERE inquiry_id = $1',
      [inquiryId]
    );
    assert.equal(beforeDelete.rows.length, 1);

    const deleteRes = await request(app).delete(`/api/inquiries/${inquiryId}`);
    assert.equal(deleteRes.status, 200);
    assert.deepEqual(deleteRes.body, { deleted: true, id: inquiryId });

    // The inquiry is gone...
    const getRes = await request(app).get(`/api/inquiries/${inquiryId}`);
    assert.equal(getRes.status, 404);

    // ...and its reply row was cascade-deleted along with it (ON DELETE CASCADE
    // on replies.inquiry_id in schema.sql), proven by querying the table
    // directly rather than only trusting the DELETE response.
    const afterDelete = await pool.query(
      'SELECT * FROM replies WHERE inquiry_id = $1',
      [inquiryId]
    );
    assert.equal(afterDelete.rows.length, 0);
  });
});
