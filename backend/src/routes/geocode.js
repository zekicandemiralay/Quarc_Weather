const express = require('express');
const router = express.Router();
const { searchCities } = require('../services/openMeteo');

// GET /api/geocode/search?q=istanbul&lang=tr
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').toString();
  const language = (req.query.lang || 'en').toString().slice(0, 5);
  if (q.trim().length < 2) return res.json([]);
  try {
    res.json(await searchCities(q, { language }));
  } catch (err) {
    res.status(502).json({ error: 'City search unavailable', detail: err.message });
  }
});

module.exports = router;
