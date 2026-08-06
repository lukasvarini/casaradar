/* scrapers.js — interrogazione portali con Playwright + screenshot fallback */
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

const PORTALS = [
  { id: 'immobiliare', name: 'Immobiliare.it',
    url: f => `https://www.immobiliare.it/${f.contract === 'vendita' ? 'vendita' : 'affitto'}-case/${f.city}/` +
      q({ prezzoMinimo: f.priceMin, prezzoMassimo: f.priceMax, superficieMinima: f.surfaceMin,
          numeroLocaliMinimo: f.roomsMin > 1 ? f.roomsMin : null, numeroBagniMinimo: f.bathsMin > 1 ? f.bathsMin : null }) },
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

/* Parser robusto: forza scroll per attivare lazy-load, cattura immagini + screenshot fallback */
function extractInPage({ origin, max }) {
  // Forza lazy-load scrollando
  window.scrollTo(0, document.body.scrollHeight / 3);
  window.scrollTo(0, (document.body.scrollHeight * 2) / 3);
  window.scrollTo(0, document.body.scrollHeight);

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
    const bm = t.match(/(\d{1,2})\s*(?:bagn[io])/i);
    const fm = t.match(/piano\s*([tT1-9]|terra|rialzato|sotterraneo|seminterrato|attico|ultimo)/i);
    const em = t.match(/classe\s+energetic[ae]\s*
