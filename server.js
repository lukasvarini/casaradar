// Modifica solo la route /api/search in server.js
app.get('/api/search', async (req, res) => {
  try {
    const f = {
      q: String(req.query.q || 'milano').trim(), // Ora supporta indirizzi!
      contract: req.query.contract === 'affitto' ? 'affitto' : 'vendita',
      priceMin: num(req.query.priceMin),
      priceMax: num(req.query.priceMax),
      surfaceMin: num(req.query.surfaceMin),
      surfaceMax: num(req.query.surfaceMax),
      rooms: num(req.query.rooms) || 0
    };
    
    // Cache key deve includere tutti i parametri ora
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
