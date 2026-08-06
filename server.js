/* server.js — API di meta-ricerca + hosting del front-end */
const express = require('express');
const path = require('path');
const { searchAll } = require('./scrapers');

const app = express();
const cache = new Map();
const geoCache = new Map();
const TTL = 10 * 60 * 1000; // cache 10 min

const num = v => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };
const slug = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true, mode: 'live' }));

/* ===== AUTOCOMPLETE "STILE MAPPE" (OpenStreetMap Nominatim) ===== */
async function resolveGeo(q) {
  const hit = geoCache.get(q);
  if (hit && Date.now() - hit.t < TTL) return hit.data;
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&accept-language=it&q=' + encodeURIComponent(q);
    const r = await fetch(url, { headers: { 'User-Agent': 'CASARADAR/2.1 (meta-ricerca immobiliare)' } });
    const rows = await r.json();
    const data = rows.map(row => {
      const a = row.address || {};
      const city = a.city || a.town || a.village || a.municipality || '';
      const region = a.state || a.region || '';
      return {
        label: row.display_name || q,
        city, region,
        citySlug: slug(city || row.name || q),
        regionSlug: slug(region),
        type: row.type || row.addresstype || 'place'
      };
    });
    geoCache.set(q, { t: Date.now(), data });
    if (geoCache.size > 200) geoCache.delete(geoCache.keys().next().value);
    return data;
  } catch (e) { return []; }
}

app.get('/api/geo', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  res.json(await resolveGeo(q));
});

/* ===== RICERCA SUI PORTALI ===== */
app.get('/api/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    let city = slug(req.query.city);
    let region = slug(req.query.region);

    // Se il front-end non ha passato slug già risolti, risolviamo l'indirizzo lato server
    if (!city && q) {
      const geo = await resolveGeo(q);
      if (geo[0]) { city = geo[0].citySlug; region = geo[0].regionSlug || region; }
    }
    if (!city) city = 'milano';

    const f = {
      city, region, q,
      contract: req.query.contract === 'affitto' ? 'affitto' : 'vendita',
      priceMin: num(req.query.priceMin),
      priceMax: num(req.query.priceMax),
      surfaceMin: num(req.query.surfaceMin),
      surfaceMax: num(req.query.surfaceMax),
      rooms: num(req.query.rooms) || 0
    };

    const key = JSON.stringify(f);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < TTL) return res.json(hit.data);

    const data = await searchAll(f);
    cache.set(key, { t: Date.now(), data });
    if (cache.size > 60) cache.delete(cache.keys().next().value);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🏠 CASARADAR LIVE → http://localhost:${PORT}`));
