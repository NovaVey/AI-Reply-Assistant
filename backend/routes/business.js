const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

// GET /api/business -> the single business_context row (id = 1)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM business_context WHERE id = 1'
    );
    res.status(200).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/business -> update the business_context row (id = 1)
router.put('/', async (req, res) => {
  try {
    const { business_name, description, services, tone, sign_off } = req.body;

    const result = await pool.query(
      `UPDATE business_context
       SET business_name = $1,
           description = $2,
           services = $3,
           tone = $4,
           sign_off = $5,
           updated_at = NOW()
       WHERE id = 1
       RETURNING *`,
      [business_name, description, services, tone, sign_off]
    );

    res.status(200).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
