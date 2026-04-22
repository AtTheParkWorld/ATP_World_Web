const express = require('express');
const router = express.Router();
const { query } = require('../db');

// GET /api/cities
router.get('/', async (req, res, next) => {
  try {
    const { country } = req.query;
    let sql = 'SELECT id, name, country FROM cities ORDER BY country, name';
    const params = [];
    if (country) { sql = 'SELECT id, name, country FROM cities WHERE country=$1 ORDER BY name'; params.push(country); }
    const { rows } = await query(sql, params);
    res.json({ cities: rows });
  } catch (err) { next(err); }
});

// POST /api/cities (admin only)
router.post('/', async (req, res, next) => {
  try {
    const { name, country } = req.body;
    const { rows: existing } = await query('SELECT id FROM cities WHERE name=$1', [name]);
    if (existing.length) return res.json({ city: existing[0] });
    const { rows } = await query('INSERT INTO cities (name, country) VALUES ($1,$2) RETURNING *', [name, country || 'UAE']);
    res.json({ city: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
