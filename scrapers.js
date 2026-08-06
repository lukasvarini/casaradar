/* scrapers.js — interrogazione reale dei portali nazionali con Playwright */
const { chromium } = require('playwright');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage']
    }).catch(e => { browserPromise = null; throw e; });
  }
  return browserPromise;
}

const q = o => {
  const s = Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return s ? '?' + s : '';
};

/* Deep-link di ricerca per ciascun portale */
const PORTALS = [
  { id: 'immobiliare', name: 'Immobiliare.it',
    url: f => `https://www.immobiliare.it/${f.contract === 'vendita' ? 'vendita' : 'affitto'}-case/${f.city}/` +
      q({ prezzoMinimo: f.priceMin, prezzoMassimo: f.priceMax, superficieMinima: f.surfaceMin, numeroLocaliMinimo: f.roomsMin > 1 ? f.roomsMin : null }) },
  { id: 'idealista', name: 'Idealista',
    url: f => { const seg = []; if (f.priceMax) seg.push(`con-prezzo-fino-a-${f.priceMax}`); if (f.surfaceMin) seg.push(`superficie-minima-${f.surfaceMin}`);
      return `https://www.idealista.it/${f.contract === 'vendita' ? 'vendita' : 'affitto'}/residenziali/${f.city}/` + (seg.length ? seg.join(',') + '/' : ''); } },
  { id: 'casa', name: 'Casa.it',
    url: f => `https://www.casa.it/${f.contract === 'vendita' ? 'vendita' : 'affitto'}/residenziale/${f.city}` +
      q({ priceMin: f.priceMin, priceMax: f.priceMax, surfaceMin: f.surfaceMin, roomsMin: f.roomsMin > 1 ? f.roomsMin : null }) },
  { id: 'wikicasa', name: 'Wikicasa',
    url: f => `https://www.wikicasa.it/${f.contract === 'vendita' ? 'vendita' : 'affitto'}/case/${f.city}/` +
      q({ prezzoMinimo: f.priceMin, prezzoMassimo: f.priceMax, superficieMinima: f.surfaceMin, localiMinimo: f.roomsMin > 1 ? f.roomsMin : null }) },
  { id: 'subito', name: 'Subito.it',
    url: f => `https://www.subito.it/annunci-${f.region || 'lombardia'}/${f.contract}/immobili/${f.city}/` +
      q({ price_min: f.priceMin, price_max: f.priceMax, surface_min: f.surfaceMin }) },
  { id: 'bakeca', name: 'Bakeca.it',
    url: f => `https://${f.city}.bakeca.it/immobili/` }
];

/* Parser generico eseguito DENTRO la pagina: robusto ai cambi di classi CSS.
   Cerca blocchi contenenti un prezzo in €, un link-annuncio, metratura e locali. */
function extractInPage({ origin, max }) {
  const SELS = ['li', 'article', '[class*="card" i]', '[class*="listing" i]', '[class*="item" i]', '[class*="result" i]', '[class*="announcement" i]'];
  let cands = [];
  for (const s of SELS) {
    const els = [...document.querySelectorAll(s)].filter(el => {
      const r = el.getBoundingClientRect();
      const t = el.innerText || '';
      return r.height > 100 && r.width > 170 && t.includes('€') && el.querySelector('a[href]');
    });
    if (els.length >= 3) { cands = els; break; }
    if (s === SELS[SELS.length - 1]) cands = els;
  }
  const seen = new Set(), out = [];
  for (const el of cands) {
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
    const pm = t.match(/€\s*([0-9][0-9.\s]{2,14})|([0-9][0-9.\s]{2,14})\s*€/);
    if (!pm) continue;
    const price = parseInt((pm[1] || pm[2]).replace(/\D/g, ''), 10);
    if (!(price >= 300 && price <= 30000000)) continue;
    const href = [...el.querySelectorAll('a[href]')].map(a => a.href)
      .find(h => h.startsWith(origin) && /(\d{4,}|annunci|immobile)/.test(h));
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const sm = t.match(/(\d{1,4})\s*(?:m²|mq)/i);
    const rm = t.match(/(\d{1,2})\s*(?:local[ie]|van[io]|stanz|camere)/i);
    const h = el.querySelector('h2,h3,h4,[class*="title" i]');
    let title = h ? h.innerText.trim() : '';
    if (title.length < 8) title = (t.split(/[-–|·•]/).find(x => x.trim().length > 16 && !x.includes('€')) || 'Annuncio immobiliare').trim();
    const img = el.querySelector('img[src],img[data-src]');
    const src = img ? (img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src')) : null;
    out.push({
      price, title: title.slice(0, 110),
      surface: sm ? Math.min(5000, +sm[1]) : null,
      rooms: rm ? Math.min(15, +rm[1]) : null,
      url: href, img: src && /^https?:/.test(src) ? src : null,
      raw: t.slice(0, 300)
    });
    if (out.length >= max) break;
  }
  return out;
}

async function scrapePortal(p, f, delay) {
  const t0 = Date.now();
  const base = { portal: p.id, name: p.name, ok: false, listings: [], error: null, ms: 0 };
  let ctx;
  try {
    const b = await getBrowser();
    ctx = await b.newContext({ userAgent: UA, locale: 'it-IT', viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    await new Promise(r => setTimeout(r, delay));                       // richieste sfalsate
    await page.goto(p.url(f), { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(1800 + Math.random() * 1500);             // ritmo umano
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2)).catch(() => {});
    await page.waitForTimeout(700);                                     // lazy-load immagini
    const origin = new URL(p.url(f)).origin;
    const items = await page.evaluate(extractInPage, { origin, max: 15 });
    base.ok = items.length > 0;
    base.listings = items.map(x => ({ ...x, portal: p.id }));
    if (!base.ok) base.error = 'nessun annuncio leggibile';
  } catch (e) {
    base.error = (e && e.message || 'errore').split('\n')[0].slice(0, 70);
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
  base.ms = Date.now() - t0;
  return base;
}

async function searchAll(f) {
  const t0 = Date.now();
  const res = await Promise.allSettled(PORTALS.map((p, i) => scrapePortal(p, f, i * 500)));
  const portals = [], listings = [];
  res.forEach((r, i) => {
    const d = r.status === 'fulfilled' ? r.value
      : { portal: PORTALS[i].id, name: PORTALS[i].name, ok: false, listings: [], error: 'crash', ms: 0 };
    portals.push({ id: d.portal, ok: d.ok, count: d.listings.length, error: d.error, ms: d.ms });
    listings.push(...d.listings);
  });
  return { city: f.city, contract: f.contract, ts: Date.now(), ms: Date.now() - t0, portals, listings };
}

module.exports = { searchAll };
