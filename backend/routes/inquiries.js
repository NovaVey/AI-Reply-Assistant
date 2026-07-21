const express = require('express');
const pool = require('../db/pool');
const claudeService = require('../services/claudeService');

const router = express.Router();

const VALID_STATUSES = ['pending', 'drafted', 'approved'];

// GET /api/inquiries?status=pending|drafted|approved
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;

    let result;
    if (status && status !== 'all' && VALID_STATUSES.includes(status)) {
      result = await pool.query(
        'SELECT * FROM inquiries WHERE status = $1 ORDER BY created_at DESC',
        [status]
      );
    } else {
      result = await pool.query(
        'SELECT * FROM inquiries ORDER BY created_at DESC'
      );
    }

    res.status(200).json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inquiries/:id -> inquiry fields + reply (or null)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const inquiryResult = await pool.query(
      'SELECT * FROM inquiries WHERE id = $1',
      [id]
    );

    if (inquiryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Inquiry not found' });
    }

    const replyResult = await pool.query(
      'SELECT * FROM replies WHERE inquiry_id = $1',
      [id]
    );

    const reply = replyResult.rows.length > 0 ? replyResult.rows[0] : null;

    res.status(200).json({ ...inquiryResult.rows[0], reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inquiries -> create a new inquiry
router.post('/', async (req, res) => {
  try {
    const { sender_name, sender_email, subject, category, body } = req.body;

    if (!body) {
      return res.status(400).json({ error: 'body is required' });
    }

    const result = await pool.query(
      `INSERT INTO inquiries (sender_name, sender_email, subject, category, body)
       VALUES ($1, $2, $3, COALESCE($4, 'general'), $5)
       RETURNING *`,
      [sender_name, sender_email, subject, category, body]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inquiries/:id/draft -> generate (or regenerate) an AI draft reply
router.post('/:id/draft', async (req, res) => {
  try {
    const { id } = req.params;

    const inquiryResult = await pool.query(
      'SELECT * FROM inquiries WHERE id = $1',
      [id]
    );

    if (inquiryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Inquiry not found' });
    }

    const inquiry = inquiryResult.rows[0];

    const businessResult = await pool.query(
      'SELECT * FROM business_context WHERE id = 1'
    );
    const businessContext = businessResult.rows[0];

    const draftText = await claudeService.draftReply(inquiry, businessContext);

    const existingReply = await pool.query(
      'SELECT * FROM replies WHERE inquiry_id = $1',
      [id]
    );

    let replyRow;
    if (existingReply.rows.length > 0) {
      const updateResult = await pool.query(
        `UPDATE replies SET draft = $1 WHERE inquiry_id = $2 RETURNING *`,
        [draftText, id]
      );
      replyRow = updateResult.rows[0];
    } else {
      const insertResult = await pool.query(
        `INSERT INTO replies (inquiry_id, draft, edited_draft)
         VALUES ($1, $2, NULL)
         RETURNING *`,
        [id, draftText]
      );
      replyRow = insertResult.rows[0];
    }

    await pool.query('UPDATE inquiries SET status = $1 WHERE id = $2', [
      'drafted',
      id,
    ]);

    res.status(200).json(replyRow);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/inquiries/:id/approve -> approve (and optionally edit) the draft
router.patch('/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { edited_draft } = req.body;

    if (edited_draft === undefined) {
      return res.status(400).json({ error: 'edited_draft is required' });
    }

    const existingReply = await pool.query(
      'SELECT * FROM replies WHERE inquiry_id = $1',
      [id]
    );

    if (existingReply.rows.length === 0) {
      return res
        .status(404)
        .json({ error: 'No draft exists for this inquiry yet' });
    }

    const updateResult = await pool.query(
      `UPDATE replies
       SET edited_draft = $1, approved_at = NOW()
       WHERE inquiry_id = $2
       RETURNING *`,
      [edited_draft, id]
    );

    await pool.query('UPDATE inquiries SET status = $1 WHERE id = $2', [
      'approved',
      id,
    ]);

    res.status(200).json(updateResult.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
