/* server.js — API di meta-ricerca + hosting del front-end */
const express = require('express');
const path = require('path');
const { searchAll } = require('./scrapers');

const app = express();
const cache = new Map();
const TTL = 10 * 60 * 1000; // cache 10 min: evita di martellare i portali

const num = v => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true, mode: 'live' }));

app.get('/api/search', async (req, res) => {
  try {
    const f = {
      city: String(req.query.city || 'milano').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'milano',
      region: String(req.query.region || '').toLowerCase().replace(/[^a-z0-9-]/g, ''),
      contract: req.query.contract === 'affitto' ? 'affitto' : 'vendita',
      priceMin: num(req.query.priceMin),
      priceMax: num(req.query.priceMax),
      surfaceMin: num(req.query.surfaceMin),
      roomsMin: num(req.query.roomsMin) || 1
    };
    const key = JSON.stringify(f);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < TTL) return res.json(hit.data);

    const data = await searchAll(f);
    cache.set(key, { t: Date.now(), data });
    if (cache.size > 60) cache.delete(cache.keys().next().value);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🏠 CASARADAR LIVE → http://localhost:${PORT}`));
