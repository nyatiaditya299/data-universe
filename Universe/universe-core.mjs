// Data Universe core: turns downloaded public datasets into searchable documents, ranks them with tunable BM25,
// tunes ("trains") the ranking on an 80/20 split of auto-generated questions, and checks the agent's ranked answers.
// Pure functions only (no DOM, no network) so they run the same in the page and in the test runner.
import { tokenize, cleanText, chunkText, splitSentences } from '../Beta/rag-core.mjs';

export { tokenize, cleanText, splitSentences };

const FREQ = { D: 'daily', W: 'weekly', M: 'monthly', Q: 'quarterly', A: 'annual' };
const round = (v, d = 2) => Number.isFinite(v) ? Number(v.toFixed(d)) : v;
const yearOf = (date) => Number(String(date).slice(0, 4));

/** Readable number: 2 decimals for small values, thousands separators for big ones. */
export function fmt(v) {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  return a >= 1e4 ? Math.round(v).toLocaleString('en-US') : a >= 100 ? v.toFixed(1) : v.toFixed(2);
}

export function fmtMoney(v) {
  const a = Math.abs(v);
  return a >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v).toLocaleString('en-US')}`;
}

// ---------------------------------------------------------------- parsing downloaded files into series

/** Plain CSV split (the public files used here have no quoted commas). */
export function parseCsv(text) {
  return String(text).replace(/^﻿/, '').trim().split(/\r?\n/).map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
}

/** FRED fredgraph.csv: "observation_date,ID" (or DATE,ID) with "." or blank for missing values. */
export function fredSeries(csv, meta) {
  const points = [];
  for (const [d, v] of parseCsv(csv).slice(1)) {
    const x = Number(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && v !== '' && v !== '.' && Number.isFinite(x)) points.push([d, x]);
  }
  return { ...meta, points };
}

/** Cboe VIX_History.csv: DATE (MM/DD/YYYY),OPEN,HIGH,LOW,CLOSE → closing level. */
export function vixSeries(csv, meta) {
  const points = [];
  for (const r of parseCsv(csv).slice(1)) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(r[0]);
    const x = Number(r[4]);
    if (m && Number.isFinite(x)) points.push([`${m[3]}-${m[1]}-${m[2]}`, x]);
  }
  return { ...meta, points };
}

const FF_TITLES = {
  'Mkt-RF': 'US stock market excess return over T-bills (Fama-French Mkt-RF)',
  SMB: 'Size factor return, small minus big stocks (Fama-French SMB)',
  HML: 'Value factor return, high minus low book-to-market (Fama-French HML)',
  RF: 'Risk-free rate, 1-month T-bill return (Fama-French RF)',
  Mom: 'Momentum factor return, winners minus losers (Fama-French Mom)'
};

/** Kenneth French CSV: notes, then ",Col1,Col2" and YYYYMM rows; the monthly block ends at the first non-YYYYMM line. */
export function famaFrenchSeries(text, base) {
  const lines = String(text).split(/\r?\n/);
  const h = lines.findIndex((l) => /^\s*,\s*[A-Za-z]/.test(l));
  if (h < 0) return [];
  const cols = lines[h].split(',').slice(1).map((c) => c.trim());
  const series = cols.map((c) => ({ ...base, id: `FF:${c}`, title: FF_TITLES[c] || `Fama-French ${c}`, units: '% per month', freq: 'M', kind: 'return', points: [] }));
  for (const l of lines.slice(h + 1)) {
    const m = /^\s*(\d{4})(\d{2})\s*,(.*)$/.exec(l);
    if (!m) break;
    m[3].split(',').forEach((v, i) => { const x = Number(v); if (series[i] && Number.isFinite(x) && x > -99) series[i].points.push([`${m[1]}-${m[2]}`, x]); });
  }
  return series;
}

/** Shiller "Data" sheet rows (array of arrays). Dates are decimals: 1871.01 = Jan, 1871.1 = Oct. */
export function shillerSeries(rows, base) {
  // The header row starts with "Date"; rows above it repeat words like "CAPE" from multi-line titles.
  const h = rows.findIndex((r) => String(r[0]).trim() === 'Date' && r.some((c) => String(c).trim() === 'CAPE'));
  if (h < 0) return [];
  const head = rows[h].map((c) => String(c ?? '').trim());
  const col = (re) => head.findIndex((c) => re.test(c));
  const defs = [
    { c: 1, id: 'SHILLER:P', title: 'S&P composite stock price, monthly average (Shiller)', units: 'index level' },
    { c: 3, id: 'SHILLER:E', title: 'S&P composite earnings per share (Shiller)', units: '$ per share' },
    { c: col(/GS10/), id: 'SHILLER:GS10', title: 'Long-term US interest rate, GS10 (Shiller)', units: '%' },
    { c: head.indexOf('CAPE'), id: 'SHILLER:CAPE', title: 'Shiller CAPE ratio, cyclically adjusted price/earnings', units: 'ratio' }
  ].filter((d) => d.c >= 0);
  const series = defs.map((d) => ({ ...base, id: d.id, title: d.title, units: d.units, freq: 'M', points: [] }));
  for (const r of rows.slice(h + 1)) {
    const t = Number(r[0]);
    if (!Number.isFinite(t) || t < 1800) continue;
    const y = Math.floor(t);
    const mo = Math.round((t - y) * 100);
    if (mo < 1 || mo > 12) continue;
    const date = `${y}-${String(mo).padStart(2, '0')}`;
    defs.forEach((d, i) => { const x = Number(r[d.c]); if (r[d.c] !== '' && r[d.c] != null && Number.isFinite(x)) series[i].points.push([date, x]); });
  }
  return series;
}

/** SPF median sheet: YEAR, QUARTER, VAR1..VAR6. VAR2 = forecast for the survey quarter, VAR6 = four quarters ahead. */
export function spfSeries(sheet, rows, title, base) {
  const head = (rows[0] || []).map((c) => String(c ?? '').trim().toUpperCase());
  const yi = head.indexOf('YEAR'), qi = head.indexOf('QUARTER');
  const pick = [[`${sheet}2`, 'current quarter'], [`${sheet}6`, 'four quarters ahead']].map(([c, label]) => ({ c: head.indexOf(c), label })).filter((p) => p.c >= 0);
  if (yi < 0 || qi < 0) return [];
  const series = pick.map((p) => ({ ...base, id: `SPF:${sheet}:${p.label === 'current quarter' ? 'Q0' : 'Q4'}`, title: `${title}, ${p.label}`, units: '%', freq: 'Q', points: [] }));
  for (const r of rows.slice(1)) {
    const y = Number(r[yi]), q = Number(r[qi]);
    if (!y || !q) continue;
    const date = `${y}-${String((q - 1) * 3 + 2).padStart(2, '0')}`; // survey month, mid-quarter
    pick.forEach((p, i) => { const x = Number(r[p.c]); if (r[p.c] !== '' && r[p.c] != null && Number.isFinite(x)) series[i].points.push([date, x]); });
  }
  return series.filter((s) => s.points.length);
}

/** World Bank API JSON ([meta, rows]) → one annual series per country, grouped by indicator ("panel"). */
export function worldBankSeries(json, ind, base) {
  const byCountry = new Map();
  for (const r of (Array.isArray(json) && json[1]) || []) {
    if (r.value == null) continue;
    const iso = r.countryiso3code || r.country?.id;
    if (!byCountry.has(iso)) byCountry.set(iso, { ...base, id: `WB:${ind.id}:${iso}`, title: `${ind.title}, ${r.country.value}`, country: r.country.value, panel: ind.id, panelTitle: ind.title, units: ind.units, freq: 'A', points: [] });
    byCountry.get(iso).points.push([String(r.date), Number(r.value)]);
  }
  return [...byCountry.values()].map((s) => ({ ...s, points: s.points.sort((a, b) => a[0].localeCompare(b[0])) }));
}

// ---------------------------------------------------------------- series → documents

const extreme = (pts, better) => pts.reduce((m, p) => (better(p[1], m[1]) ? p : m), pts[0]);

/** One overview document per series plus one per calendar year, each a plain-language fact sheet. */
export function seriesDocs(s) {
  const pts = s.points;
  if (!pts.length) return [];
  const u = s.units ? ` ${s.units}` : '';
  const hi = extreme(pts, (a, b) => a > b), lo = extreme(pts, (a, b) => a < b);
  const last = pts[pts.length - 1];
  const base = { dataset: s.dataset, seriesId: s.id, url: s.file, source: s.source };
  const overview = [
    `${s.title}. Series ${s.id} from ${s.publisher || s.dataset}.`,
    `Units: ${s.units || 'n/a'}. Frequency: ${FREQ[s.freq] || s.freq}. Coverage: ${pts[0][0]} to ${last[0]} (${pts.length} observations).`,
    `Latest value: ${fmt(last[1])}${u} on ${last[0]}. Highest: ${fmt(hi[1])}${u} on ${hi[0]}. Lowest: ${fmt(lo[1])}${u} on ${lo[0]}.`
  ];
  if (s.kind !== 'return' && s.units !== '0/1') {
    const avg = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const below = pts.filter((p) => p[1] < last[1]).length;
    overview.push(`Historical average ${fmt(avg)}${u}. The latest value is higher than ${Math.round((below / pts.length) * 100)}% of all observations since ${pts[0][0].slice(0, 4)}, so it is ${last[1] > avg ? 'above' : 'below'} its long-run average.`);
  }
  if (s.description) overview.push(s.description);
  const docs = [{ ...base, id: `S:${s.id}`, kind: 'series-summary', title: s.title, date: last[0], years: [], text: overview.join(' ') }];
  if (s.freq === 'A') return docs; // annual panels get cross-country year documents instead (panelDocs)
  const byYear = new Map();
  for (const p of pts) { const y = yearOf(p[0]); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(p); }
  for (const [y, yp] of byYear) {
    const first = yp[0], end = yp[yp.length - 1];
    const yhi = extreme(yp, (a, b) => a > b), ylo = extreme(yp, (a, b) => a < b);
    let text;
    if (s.kind === 'return') {
      const total = (yp.reduce((g, p) => g * (1 + p[1] / 100), 1) - 1) * 100;
      text = `${s.title} in ${y}: cumulative ${round(total, 1)}% over ${yp.length} months. Best month ${yhi[0]} (${fmt(yhi[1])}%), worst month ${ylo[0]} (${fmt(ylo[1])}%).`;
    } else if (s.units === '0/1') {
      const on = yp.filter((p) => p[1] >= 1).map((p) => p[0].slice(0, 7));
      text = `${s.title} in ${y}: ${on.length ? `recession in ${on.length} of ${yp.length} months (${on[0]} to ${on[on.length - 1]})` : 'no recession months'}.`;
    } else {
      const chg = end[1] - first[1];
      const pct = first[1] ? (chg / Math.abs(first[1])) * 100 : NaN;
      const avg = yp.reduce((a, p) => a + p[1], 0) / yp.length;
      const dir = Math.abs(chg) < 1e-9 ? 'unchanged' : chg > 0 ? 'rose' : 'fell';
      text = `${s.title} in ${y}: ${dir} from ${fmt(first[1])}${u} (${first[0]}) to ${fmt(end[1])}${u} (${end[0]}), a change of ${chg >= 0 ? '+' : ''}${fmt(chg)}${Number.isFinite(pct) ? ` (${pct >= 0 ? '+' : ''}${round(pct, 1)}%)` : ''}. Average ${fmt(avg)}${u}. High ${fmt(yhi[1])} on ${yhi[0]}; low ${fmt(ylo[1])} on ${ylo[0]}.`;
    }
    docs.push({ ...base, id: `S:${s.id}:${y}`, kind: 'series-year', title: `${s.title}, ${y}`, date: end[0], year: y, years: [y], text });
  }
  return docs;
}

/** Annual cross-country documents: "Real GDP growth in 2020: India -5.8 annual %, United States -2.2 ..." */
export function panelDocs(seriesList) {
  const panels = new Map();
  for (const s of seriesList) {
    if (!s.panel) continue;
    if (!panels.has(s.panel)) panels.set(s.panel, { title: s.panelTitle, units: s.units, dataset: s.dataset, source: s.source, url: s.file, years: new Map() });
    const p = panels.get(s.panel);
    for (const [d, v] of s.points) { const y = yearOf(d); if (!p.years.has(y)) p.years.set(y, []); p.years.get(y).push(`${s.country} ${fmt(v)}`); }
  }
  const docs = [];
  for (const [id, p] of panels) {
    for (const [y, vals] of p.years) {
      docs.push({ id: `P:${id}:${y}`, dataset: p.dataset, kind: 'panel-year', title: `${p.title} by country, ${y}`, date: `${y}`, year: y, years: [y], url: p.url, source: p.source,
        text: `${p.title} in ${y} (${p.units}): ${vals.join('; ')}.` });
    }
  }
  return docs;
}

// ---------------------------------------------------------------- 13F holdings → documents

function aggregate(holdings) {
  const m = new Map();
  for (const h of holdings) {
    const key = `${h.cusip}|${h.putCall || ''}`;
    const cur = m.get(key) || { name: h.name, cls: h.cls, cusip: h.cusip, putCall: h.putCall || '', value: 0, shares: 0 };
    cur.value += h.value || 0;
    cur.shares += h.shares || 0;
    m.set(key, cur);
  }
  return m;
}

// Share classes (e.g. Alphabet "CAP STK CL A" / "CL C") have separate CUSIPs under one name, so name the class.
const shareClass = (cls) => (cls.match(/\b(?:CL(?:ASS)?)\s*([A-Z])\b/i) || [])[1];
const label = (h) => `${h.name}${shareClass(h.cls || '') && !/CLASS [A-Z]\b|CL [A-Z]$/i.test(h.name) ? ` class ${shareClass(h.cls).toUpperCase()}` : ''}${h.putCall ? ` (${h.putCall.toLowerCase()} options)` : ''}`;

/** filings: [{manager, cik, reportDate, filingDate, url, holdings:[{name, cls, cusip, value, shares, putCall}]}] */
export function holdingsDocs(filings, { dataset = 'sec-13f', top = 25 } = {}) {
  const docs = [];
  const byManager = new Map();
  for (const f of filings) { if (!byManager.has(f.manager)) byManager.set(f.manager, []); byManager.get(f.manager).push(f); }
  for (const [manager, list] of byManager) {
    list.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
    let prev = null;
    for (const f of list) {
      const agg = aggregate(f.holdings);
      const rows = [...agg.values()].sort((a, b) => b.value - a.value);
      const total = rows.reduce((a, r) => a + r.value, 0);
      const y = yearOf(f.reportDate);
      const tops = rows.slice(0, top).map((r, i) => `${i + 1}. ${label(r)}: ${fmtMoney(r.value)}, ${round((r.value / total) * 100, 1)}% of reported value, ${Math.round(r.shares).toLocaleString('en-US')} shares`);
      docs.push({ id: `H:${f.cik}:${f.reportDate}`, dataset, kind: 'holdings', manager, title: `${manager} 13F holdings, quarter ended ${f.reportDate}`, date: f.filingDate || f.reportDate, year: y, years: [y], url: f.url,
        text: `${manager} 13F holdings report for the quarter ended ${f.reportDate} (filed ${f.filingDate}): ${rows.length} positions worth ${fmtMoney(total)} in total. Largest positions: ${tops.join('; ')}.` });
      if (prev) {
        const was = prev.agg;
        const added = rows.filter((r) => !was.has(`${r.cusip}|${r.putCall}`)).slice(0, 15).map((r) => `${label(r)} (${fmtMoney(r.value)})`);
        const exited = [...was.values()].filter((r) => !agg.has(`${r.cusip}|${r.putCall}`)).sort((a, b) => b.value - a.value).slice(0, 15).map((r) => `${label(r)} (was ${fmtMoney(r.value)})`);
        const moves = rows.filter((r) => was.has(`${r.cusip}|${r.putCall}`)).map((r) => { const o = was.get(`${r.cusip}|${r.putCall}`); return { r, pct: o.shares ? ((r.shares - o.shares) / o.shares) * 100 : 0, dv: r.value - o.value }; });
        const up = moves.filter((m) => m.pct >= 10).sort((a, b) => b.r.value - a.r.value).slice(0, 10).map((m) => `${label(m.r)} (+${round(m.pct, 0)}% shares, now ${fmtMoney(m.r.value)})`);
        const down = moves.filter((m) => m.pct <= -10).sort((a, b) => b.r.value - a.r.value).slice(0, 10).map((m) => `${label(m.r)} (${round(m.pct, 0)}% shares, now ${fmtMoney(m.r.value)})`);
        const list2 = (xs) => (xs.length ? xs.join('; ') : 'none');
        docs.push({ id: `C:${f.cik}:${f.reportDate}`, dataset, kind: 'holdings-change', manager, title: `${manager} buys and sells, ${prev.reportDate} to ${f.reportDate}`, date: f.filingDate || f.reportDate, year: y, years: [y], url: f.url,
          text: `${manager} portfolio changes between the 13F reports for quarters ended ${prev.reportDate} and ${f.reportDate}. New positions: ${list2(added)}. Sold out completely: ${list2(exited)}. Largest share increases: ${list2(up)}. Largest share reductions: ${list2(down)}. 13F reports are delayed quarter-end snapshots of US-listed long positions and do not state reasons.` });
      }
      prev = { reportDate: f.reportDate, agg };
    }
  }
  return docs;
}

// ---------------------------------------------------------------- index and tunable ranking

export const DEFAULT_PARAMS = Object.freeze({ k1: 1.2, b: 0.75, titleBoost: 0, yearBoost: 0 });
export const GRID = Object.freeze({ k1: [0.9, 1.2, 1.6, 2.0], b: [0.4, 0.6, 0.75, 0.9], titleBoost: [0, 0.5, 1, 2], yearBoost: [0, 1, 2, 4] });

export function docYears(doc) {
  if (Array.isArray(doc.years) && doc.years.length) return doc.years;
  if (doc.year) return [doc.year];
  return /^\d{4}/.test(doc.date || '') && doc.kind !== 'series-summary' ? [yearOf(doc.date)] : [];
}

// FOMC press-office tail ("For media inquiries... Implementation Note issued May 3, 2023"): no content, but its date
// token outranked the actual statement for dated questions, so it is cut before the text is split into passages.
const PRESS_TAIL = /\s*For media inquiries, please[\s\S]*$/;

/** docs → chunks with term frequencies and an inverted index (term → [chunk, tf] postings). */
export function buildUniverseIndex(docs, { maxChars = 900 } = {}) {
  const chunks = [], postings = new Map(), docMap = new Map(), titleTerms = new Map(), years = new Map();
  for (const doc of docs) {
    docMap.set(doc.id, doc);
    titleTerms.set(doc.id, new Set(tokenize(doc.title)));
    years.set(doc.id, new Set(docYears(doc)));
    const texts = doc.kind === 'text' ? chunkText(cleanText(doc.text).replace(PRESS_TAIL, ''), { maxChars }) : [doc.text];
    texts.forEach((text, n) => {
      const tokens = tokenize(text);
      if (!tokens.length) return;
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      const ci = chunks.length;
      for (const [t, f] of tf) { if (!postings.has(t)) postings.set(t, []); postings.get(t).push(ci, f); }
      chunks.push({ id: `${doc.id}#${n + 1}`, docId: doc.id, n: n + 1, text, len: tokens.length });
    });
  }
  const avgdl = chunks.reduce((s, c) => s + c.len, 0) / (chunks.length || 1);
  let maxYear = 0;
  for (const ys of years.values()) for (const y of ys) if (y > maxYear) maxYear = y;
  return { chunks, postings, avgdl, docs: docMap, titleTerms, years, maxYear, chunkById: new Map(chunks.map((c, i) => [c.id, i])) };
}

export const queryYears = (q) => [...new Set((String(q).match(/\b(?:18|19|20)\d{2}\b/g) || []).map(Number))];

/** Parameter-independent part of a search: matched chunks and per-term frequencies. Reused across the tuning grid. */
export function prepareQuery(index, query) {
  const N = index.chunks.length;
  const terms = [...new Set(tokenize(query))].filter((t) => index.postings.has(t)).map((t) => {
    const n = index.postings.get(t).length / 2;
    return { t, idf: Math.log(1 + (N - n + 0.5) / (n + 0.5)) };
  });
  const rows = new Map();
  terms.forEach(({ t }, ti) => {
    const p = index.postings.get(t);
    for (let i = 0; i < p.length; i += 2) {
      let r = rows.get(p[i]);
      if (!r) rows.set(p[i], (r = new Float32Array(terms.length)));
      r[ti] = p[i + 1];
    }
  });
  return { terms, years: queryYears(query), recent: RECENT.test(query), rows };
}

const RECENT = /\b(recent|recently|latest|current|currently|now|today|lately|this year|so far)\b/i;
const RECENT_BONUS = 3;

/** Scores documents (best chunk per document) for one prepared query. */
export function scoreDocs(index, prep, params = DEFAULT_PARAMS, { dataset = '', focus = '' } = {}) {
  const { k1, b, titleBoost, yearBoost } = { ...DEFAULT_PARAMS, ...params };
  const best = new Map();
  for (const [ci, tfs] of prep.rows) {
    const c = index.chunks[ci];
    if (dataset && index.docs.get(c.docId).dataset !== dataset) continue;
    if (focus && focusKey(index.docs.get(c.docId)) !== focus) continue;
    let s = 0;
    const norm = k1 * (1 - b + (b * c.len) / index.avgdl);
    for (let i = 0; i < tfs.length; i++) { const f = tfs[i]; if (f) s += (prep.terms[i].idf * f * (k1 + 1)) / (f + norm); }
    const cur = best.get(c.docId);
    if (!cur || s > cur.score) best.set(c.docId, { docId: c.docId, chunkIdx: ci, score: s });
  }
  const out = [];
  for (const h of best.values()) {
    let s = h.score;
    if (titleBoost) { const tt = index.titleTerms.get(h.docId); for (const { t, idf } of prep.terms) if (tt.has(t)) s += titleBoost * idf; }
    if (yearBoost && prep.years.length) {
      const ys = index.years.get(h.docId);
      if (ys.size) s += prep.years.some((y) => ys.has(y)) ? yearBoost * 2.5 : -yearBoost;
    }
    // "recent", "latest", "now"…: favor documents from the last two years in the universe.
    if (prep.recent && !prep.years.length && [...index.years.get(h.docId)].some((y) => y >= index.maxYear - 1)) s += RECENT_BONUS;
    out.push({ ...h, score: s });
  }
  return out.sort((a, b2) => b2.score - a.score);
}

// Documents that are the same thing at different dates: one manager's quarterly 13F reports, one series' yearly sheets.
function dateFamily(doc) {
  if (doc.kind === 'holdings' || doc.kind === 'holdings-change') return `${doc.kind}:${doc.manager}`;
  if (doc.kind === 'series-year') return `Y:${doc.seriesId}`;
  return '';
}

/**
 * When the question names no year, the latest data matters most (older data is already reflected in prices).
 * Within each date family, members swap into the family's ranking slots newest first; other documents
 * keep their places, and each slot keeps its score so relevance still reads in descending order.
 */
export function latestFirst(index, hits, prep) {
  if (prep.years.length) return hits;
  const slots = new Map();
  hits.forEach((h, i) => {
    const fam = dateFamily(index.docs.get(h.docId));
    if (fam) { if (!slots.has(fam)) slots.set(fam, []); slots.get(fam).push(i); }
  });
  const out = hits.slice();
  for (const idx of slots.values()) {
    if (idx.length < 2) continue;
    const newest = idx.map((i) => hits[i]).sort((a, b) => String(index.docs.get(b.docId).date).localeCompare(String(index.docs.get(a.docId).date)));
    idx.forEach((slot, j) => { out[slot] = { ...newest[j], score: hits[slot].score }; });
  }
  return out;
}

/** Top-k documents for a question, each with its best passage. With a trained `params.ranker`, BM25's top candidates are re-ranked by it. */
export function search(index, query, params = DEFAULT_PARAMS, { k = 5, dataset = '', focus = '' } = {}) {
  const prep = prepareQuery(index, query);
  const hits = rerankHits(index, prep, scoreDocs(index, prep, params, { dataset, focus }), params.ranker);
  return latestFirst(index, hits, prep).slice(0, k).map((h) => {
    const chunk = index.chunks[h.chunkIdx];
    return { ...h, chunk, doc: index.docs.get(h.docId) };
  });
}

/** The sentences of a passage that share the most (rarest) words with the question, in reading order. */
export function bestSentences(text, query, n = 2) {
  const q = new Set(tokenize(query));
  const sents = splitSentences(text).filter((s) => s.length > 20);
  if (sents.length <= n) return sents.join(' ') || text.slice(0, 400);
  const scored = sents.map((s, i) => ({ s, i, score: tokenize(s).filter((t) => q.has(t)).length + (i === 0 ? 0.5 : 0) }));
  return scored.sort((a, b) => b.score - a.score).slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.s).join(' ');
}

/**
 * Retrieval-only answer: the top documents as ranked options, relevance relative to the best match.
 * At most `perSeries` options come from one time series, so the options cover different angles.
 */
export function rankedOptions(index, query, params = DEFAULT_PARAMS, { k = 5, dataset = '', focus = '', perSeries = 2 } = {}) {
  const per = new Map();
  // Once the analyst has picked one measure, the per-series cap would leave fewer than 3 options, so it lifts.
  const cap = focus ? k : perSeries;
  const hits = search(index, query, params, { k: 400, dataset, focus }).filter((h) => {
    const key = h.doc.seriesId || h.doc.id;
    per.set(key, (per.get(key) || 0) + 1);
    return per.get(key) <= cap;
  }).slice(0, k);
  const top = hits[0]?.score || 1;
  return hits.map((h, i) => ({
    rank: i + 1, docId: h.docId, title: h.doc.title, dataset: h.doc.dataset, date: h.doc.date || '',
    relevance: Math.max(1, Math.round((100 * h.score) / top)), answer: bestSentences(h.chunk.text, query, 2), why: '', sources: [h.chunk.id], origin: 'search'
  }));
}

// ---------------------------------------------------------------- clarifying questions (narrow the scope before answering)

/** What a document measures: one series, one 13F manager or one World Bank indicator. Letters and statements have none. */
export function focusKey(doc) {
  if (doc.seriesId) return `S:${doc.seriesId}`;
  if (doc.manager) return `M:${doc.manager}`;
  if (doc.kind === 'panel-year') return `P:${doc.id.split(':')[1]}`;
  return '';
}

function focusLabel(doc) {
  if (doc.manager) return `${doc.manager} (13F)`;
  return plain(doc.title);
}

/** The question with the chosen period folded in, so the year boost and "recent" rule apply. "*" means the analyst chose "any". */
export function scopedQuery(question, scope = {}) {
  const p = scope.period;
  return p === 'recent' ? `${question} recent` : p && p !== '*' ? `${question} in ${p}` : question;
}

const realScope = (v) => (v && v !== '*' ? v : '');

/**
 * Clarifying questions for a broad question, built from where its top matches spread out:
 * across sources (datasets), across measures (series, managers, indicators) and across years.
 * A facet is asked only when at least two choices each carry a real share of the match score,
 * and never when the scope (or the question itself, for years) already fixes it.
 * Each option narrows the search with a filter, so the answer comes from fewer, closer documents.
 */
export function clarifyQuestions(index, question, allParams = DEFAULT_PARAMS, { scope = {}, datasetNames = {}, k = 30, minShare = 0.12, dominant = 0.75, confident = 1.1, max = 3 } = {}) {
  // Score shares and the "clear winner" threshold were calibrated on BM25 scores, so the re-ranker is left out here.
  const { ranker, ...params } = allParams;
  const prep = prepareQuery(index, scopedQuery(question, scope));
  if (!prep.terms.length) return [];
  // At most 2 documents per measure, as in the ranked options, so one series' yearly sheets can't crowd out the others.
  const per = new Map();
  const hits = search(index, scopedQuery(question, scope), params, { k: 400, dataset: realScope(scope.dataset), focus: realScope(scope.focus) }).filter((h) => {
    const key = focusKey(h.doc) || h.doc.id;
    per.set(key, (per.get(key) || 0) + 1);
    return per.get(key) <= 2;
  }).slice(0, k);
  // A clear winner means the question is already specific enough: answer it without asking.
  if (hits.length > 1 && hits[0].score >= confident * hits[1].score) return [];
  const total = hits.reduce((s, h) => s + h.score, 0) || 1;
  const facet = (keyOf, labelOf) => {
    const agg = new Map();
    for (const h of hits) {
      const key = keyOf(h.doc);
      if (!key) continue;
      const a = agg.get(key) || { value: key, label: labelOf(h.doc), share: 0, n: 0 };
      a.share += h.score / total; a.n++;
      agg.set(key, a);
    }
    const opts = [...agg.values()].filter((a) => a.share >= minShare).sort((a, b) => b.share - a.share).slice(0, 4);
    // Worth asking only when the matches really split: two or more choices and no single one dominating.
    return opts.length >= 2 && opts[0].share < dominant ? opts : [];
  };
  const out = [];
  if (!scope.dataset) {
    const opts = facet((d) => d.dataset, (d) => datasetNames[d.dataset] || d.dataset);
    if (opts.length) out.push({ id: 'dataset', question: 'Which source should the answer focus on?', options: opts });
  }
  if (!scope.focus) {
    const opts = facet(focusKey, focusLabel);
    if (opts.length) out.push({ id: 'focus', question: 'Which measure do you mean?', options: opts });
  }
  if (!scope.period && !prep.years.length && !prep.recent) {
    const byYear = new Map();
    let dated = 0;
    for (const h of hits) {
      const ys = h.doc.kind === 'series-summary' ? [] : docYears(h.doc);
      if (!ys.length) continue;
      dated += h.score / total;
      byYear.set(ys[0], (byYear.get(ys[0]) || 0) + h.score / total);
    }
    if (byYear.size >= 3 && dated >= 0.4) {
      const years = [...byYear.entries()].sort((a, b) => b[1] - a[1]).map(([y]) => y).filter((y) => y < index.maxYear - 1).slice(0, 3).sort((a, b) => b - a);
      if (years.length) out.push({ id: 'period', question: 'Which period?', options: [
        { value: 'recent', label: `Latest (${index.maxYear - 1}–${index.maxYear})` },
        ...years.map((y) => ({ value: String(y), label: String(y) }))
      ] });
    }
  }
  return out.slice(0, max);
}

// ---------------------------------------------------------------- 80/20 training: question set, split, grid search

/** Small seeded PRNG so the question set and split are reproducible. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function shuffle(items, rand) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const plain = (title) => title.replace(/\s*\([^)]*\)/g, '').replace(/,\s*\d{4}$/, '').trim();

const TEMPLATES = {
  'series-year': ['What happened to the {t} in {y}?', 'How did {t} move during {y}?', '{t}: high and low in {y}', 'Was {t} rising or falling in {y}?'],
  'series-summary': ['Where can I find long-run history of {t}?', 'Which dataset covers {t}?', '{t} all-time high and latest value'],
  'panel-year': ['Compare {t} across countries in {y}', 'Which countries had the highest {t} in {y}?'],
  holdings: ['What were {m}\'s largest holdings in the quarter ended {d}?', '{m} top positions {d}'],
  'holdings-change': ['What did {m} buy and sell in the quarter ended {d}?', 'New positions and exits for {m} as of {d}']
};

/**
 * Auto-generates question → answer-document pairs from the universe itself.
 * Structured documents get templated analyst questions; text documents get a "pseudo-question":
 * the 4 most distinctive words of one random passage (title words excluded), so the ranker must find the source by content.
 */
export function makeQuestionSet(index, { seed = 2026, perKind = 120 } = {}) {
  const rand = rng(seed);
  const N = index.chunks.length;
  const idf = (t) => { const n = (index.postings.get(t)?.length || 0) / 2; return Math.log(1 + (N - n + 0.5) / (n + 0.5)); };
  const byKind = new Map();
  for (const doc of index.docs.values()) { if (!byKind.has(doc.kind)) byKind.set(doc.kind, []); byKind.get(doc.kind).push(doc); }
  const chunksOf = new Map();
  index.chunks.forEach((c) => { if (!chunksOf.has(c.docId)) chunksOf.set(c.docId, []); chunksOf.get(c.docId).push(c); });
  const out = [];
  for (const [kind, docs] of byKind) {
    for (const doc of shuffle(docs, rand).slice(0, perKind)) {
      let q;
      if (kind === 'text') {
        const cs = chunksOf.get(doc.id) || [];
        if (!cs.length) continue;
        const c = cs[Math.floor(rand() * cs.length)];
        const title = index.titleTerms.get(doc.id);
        const tf = new Map();
        for (const t of tokenize(c.text)) if (!title.has(t) && !/^\d+(\.\d+)?%?$/.test(t)) tf.set(t, (tf.get(t) || 0) + 1);
        const words = [...tf].map(([t, f]) => [t, f * idf(t)]).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t);
        if (words.length < 3) continue;
        q = words.join(' ');
      } else {
        const tpl = TEMPLATES[kind];
        if (!tpl) continue;
        q = tpl[Math.floor(rand() * tpl.length)].replace('{t}', plain(kind === 'panel-year' ? doc.title.replace(/ by country.*$/, '') : doc.title).toLowerCase())
          .replace('{y}', doc.year ?? '').replace('{m}', doc.manager || '').replace('{d}', String(doc.title.match(/\d{4}-\d{2}-\d{2}$/)?.[0] || doc.date || ''));
      }
      out.push({ q, gold: doc.id, kind });
    }
  }
  return out;
}

/** Seeded 80/20 split: 80% to tune the ranking, 20% held back to measure it. */
export function split8020(items, seed = 2026) {
  const a = shuffle(items, rng(seed + 1));
  const cut = Math.round(a.length * 0.8);
  return { train: a.slice(0, cut), test: a.slice(cut) };
}

/** Hit@1, Hit@3 (the right source among the 3 options shown) and MRR@10. */
export function evaluate(index, prepared, params) {
  let h1 = 0, h3 = 0, mrr = 0;
  for (const { prep, gold } of prepared) {
    const rank = scoreDocs(index, prep, params).slice(0, 10).findIndex((h) => h.docId === gold);
    if (rank === 0) h1++;
    if (rank >= 0 && rank < 3) h3++;
    if (rank >= 0) mrr += 1 / (rank + 1);
  }
  const n = prepared.length || 1;
  return { n: prepared.length, hit1: round(h1 / n, 3), hit3: round(h3 / n, 3), mrr: round(mrr / n, 3) };
}

export function prepareSet(index, items) {
  return items.map((it) => ({ ...it, prep: prepareQuery(index, it.q) }));
}

/** Grid search on the training set (objective: MRR, ties broken by Hit@3). Yields to the caller between steps. */
export async function tune(index, trainPrepared, { grid = GRID, onProgress = () => {} } = {}) {
  const combos = [];
  for (const k1 of grid.k1) for (const b of grid.b) for (const titleBoost of grid.titleBoost) for (const yearBoost of grid.yearBoost) combos.push({ k1, b, titleBoost, yearBoost });
  let best = null;
  for (let i = 0; i < combos.length; i++) {
    const m = evaluate(index, trainPrepared, combos[i]);
    const obj = m.mrr + m.hit3 / 1000;
    if (!best || obj > best.obj) best = { params: combos[i], metrics: m, obj };
    if (i % 8 === 7 || i === combos.length - 1) { onProgress(i + 1, combos.length, best); await new Promise((r) => setTimeout(r, 0)); }
  }
  return { params: best.params, train: best.metrics, combos: combos.length };
}

// ---------------------------------------------------------------- learned re-ranker (a small neural network, trained 80/20)

/**
 * Stage 2 of the search. BM25 (stage 1) proposes the top candidates; this network scores each (question, candidate)
 * pair from the features below and re-orders them. Features are generic signals, not the wording of the generated
 * questions, so the model cannot simply memorise the question templates. Two question-shape features ("names a year",
 * "question length") were tried and dropped: the generated text questions never contain a year, so the network learned
 * that a dated question never wants a letter or FOMC statement, which pushed FOMC statements out of "What did the FOMC
 * say about inflation in 2023?".
 */
export const RANKER_FEATURES = Object.freeze([
  'bm25 score / best', 'log bm25 score', '1 / BM25 rank', 'question weight in passage', 'share of question words in passage',
  'question weight in title', 'year matches', 'year differs', 'document undated', 'recent and asked for recent', 'years before latest',
  'log passage length',
  'kind: text', 'kind: yearly fact sheet', 'kind: series summary', 'kind: country table', 'kind: 13F holdings', 'kind: 13F changes'
]);
const KINDS = ['text', 'series-year', 'series-summary', 'panel-year', 'holdings', 'holdings-change'];
export const RANKER_DEFAULTS = Object.freeze({ candidates: 30, hidden: 12, maxEpochs: 400, checkEvery: 20, lr: 0.01, l2: 1e-4 });

/** Feature vector for one candidate hit (rank i in the BM25 list whose best score is `top`). */
export function rankerFeatures(index, prep, h, i, top) {
  const doc = index.docs.get(h.docId), c = index.chunks[h.chunkIdx];
  const row = prep.rows.get(h.chunkIdx);
  const idfSum = prep.terms.reduce((s, t) => s + t.idf, 0) || 1;
  let inPassage = 0, inPassageN = 0, inTitle = 0;
  const title = index.titleTerms.get(h.docId);
  prep.terms.forEach((t, k) => {
    if (row && row[k]) { inPassage += t.idf; inPassageN++; }
    if (title.has(t.t)) inTitle += t.idf;
  });
  const ys = index.years.get(h.docId);
  const qy = prep.years.length > 0, hasYears = ys.size > 0;
  const match = qy && prep.years.some((y) => ys.has(y));
  const newest = hasYears ? Math.max(...ys) : 0;
  return [
    h.score / (top || 1), Math.log1p(Math.max(0, h.score)), 1 / (i + 1), inPassage / idfSum, inPassageN / (prep.terms.length || 1),
    inTitle / idfSum, match ? 1 : 0, qy && hasYears && !match ? 1 : 0, hasYears ? 0 : 1,
    prep.recent && hasYears && newest >= index.maxYear - 1 ? 1 : 0, hasYears ? Math.min(3, (index.maxYear - newest) / 10) : 0,
    Math.log1p(c.len) / 6,
    ...KINDS.map((k) => (doc.kind === k ? 1 : 0))
  ];
}

/** BM25 candidates for one question, with their feature vectors. */
function candidateSet(index, prep, params, n) {
  const hits = scoreDocs(index, prep, params);
  const cands = hits.slice(0, n), top = hits[0]?.score || 1;
  return { hits, cands, X: cands.map((h, i) => rankerFeatures(index, prep, h, i, top)) };
}

/** Network output for one feature vector: a linear part plus one tanh hidden layer ("wide and deep"). */
function netScore(m, x, hBuf) {
  const F = x.length, H = m.hidden;
  let s = m.b2;
  for (let f = 0; f < F; f++) s += m.v[f] * ((x[f] - m.mean[f]) / m.std[f]);
  for (let j = 0; j < H; j++) {
    let z = m.b1[j];
    for (let f = 0; f < F; f++) z += m.W1[j * F + f] * ((x[f] - m.mean[f]) / m.std[f]);
    const a = Math.tanh(z);
    if (hBuf) hBuf[j] = a;
    s += m.w2[j] * a;
  }
  return s;
}

/**
 * Re-orders BM25 hits with the trained network. The re-ranked candidates carry the model's score rescaled to 0.01–1
 * (best = 1, weakest candidate = 0.01) as their score: softmax probabilities are too peaked to read as relevance bars.
 */
export function rerankHits(index, prep, hits, ranker) {
  if (!ranker || !hits.length) return hits;
  const n = Math.min(ranker.candidates, hits.length), top = hits[0].score || 1;
  const scored = hits.slice(0, n).map((h, i) => ({ h, s: netScore(ranker, rankerFeatures(index, prep, h, i, top)) }));
  const max = Math.max(...scored.map((x) => x.s)), min = Math.min(...scored.map((x) => x.s));
  const head = scored.sort((a, b) => b.s - a.s).map((x) => ({ ...x.h, bm25: x.h.score, model: x.s, score: 0.01 + (0.99 * (x.s - min)) / (max - min || 1) }));
  return [...head, ...hits.slice(n).map((h) => ({ ...h, bm25: h.score, score: 0 }))];
}

/** Hit@1, Hit@3 and MRR@10 of the re-ranked list, on prepared questions. */
export function evaluateRanker(index, prepared, params, ranker) {
  let h1 = 0, h3 = 0, mrr = 0;
  for (const { prep, gold } of prepared) {
    const rank = rerankHits(index, prep, scoreDocs(index, prep, params), ranker).slice(0, 10).findIndex((h) => h.docId === gold);
    if (rank === 0) h1++;
    if (rank >= 0 && rank < 3) h3++;
    if (rank >= 0) mrr += 1 / (rank + 1);
  }
  const n = prepared.length || 1;
  return { n: prepared.length, hit1: round(h1 / n, 3), hit3: round(h3 / n, 3), mrr: round(mrr / n, 3) };
}

function initNet(F, H, seed) {
  const rand = rng(seed);
  const u = (s) => (rand() * 2 - 1) * s;
  // Training runs on already-standardised features, so the net's own scaling starts as the identity.
  return { hidden: H, mean: Array(F).fill(0), std: Array(F).fill(1), v: Array.from({ length: F }, () => 0), W1: Array.from({ length: F * H }, () => u(1 / Math.sqrt(F))), b1: Array.from({ length: H }, () => 0), w2: Array.from({ length: H }, () => u(0.1)), b2: 0 };
}

/**
 * Trains the network for `epochs` full passes with Adam. Loss per question: softmax cross-entropy over its candidates
 * with the right source as the target (listwise). Questions whose right source is not among the candidates are skipped.
 */
async function fitNet(sets, net, { epochs, lr, l2, onEpoch = () => {} }) {
  const params = ['v', 'W1', 'b1', 'w2'];
  const mom = {}, vel = {};
  for (const p of params) { mom[p] = new Float64Array(net[p].length); vel[p] = new Float64Array(net[p].length); }
  const F = net.v.length, H = net.hidden, hBuf = new Float64Array(H);
  const usable = sets.filter((s) => s.goldIdx >= 0 && s.Xn.length > 1);
  for (let ep = 1; ep <= epochs; ep++) {
    const g = { v: new Float64Array(F), W1: new Float64Array(F * H), b1: new Float64Array(H), w2: new Float64Array(H) };
    for (const s of usable) {
      const acts = s.Xn.map(() => new Float64Array(H));
      const sc = s.Xn.map((x, i) => { const out = netScore(net, x, hBuf); acts[i].set(hBuf); return out; });
      const max = Math.max(...sc), ex = sc.map((v) => Math.exp(v - max)), z = ex.reduce((a, b) => a + b, 0);
      s.Xn.forEach((x, i) => {
        const d = ex[i] / z - (i === s.goldIdx ? 1 : 0);
        if (!d) return;
        for (let f = 0; f < F; f++) g.v[f] += d * x[f];
        for (let j = 0; j < H; j++) {
          const a = acts[i][j];
          g.w2[j] += d * a;
          const dz = d * net.w2[j] * (1 - a * a);
          g.b1[j] += dz;
          for (let f = 0; f < F; f++) g.W1[j * F + f] += dz * x[f];
        }
      });
    }
    for (const p of params) {
      const w = net[p], gp = g[p];
      for (let k = 0; k < w.length; k++) {
        const grad = gp[k] / (usable.length || 1) + (p === 'b1' ? 0 : l2 * w[k]);
        mom[p][k] = 0.9 * mom[p][k] + 0.1 * grad;
        vel[p][k] = 0.999 * vel[p][k] + 0.001 * grad * grad;
        w[k] -= (lr * (mom[p][k] / (1 - 0.9 ** ep))) / (Math.sqrt(vel[p][k] / (1 - 0.999 ** ep)) + 1e-8);
      }
    }
    if (await onEpoch(ep) === false) break;
  }
  return net;
}

/**
 * Trains the re-ranker on the training questions only. A seeded 20% of them is set aside as a validation set to choose
 * how many epochs to train (early stopping); the network is then retrained on all training questions for that many.
 * The held-out test questions are never seen here.
 */
export async function trainRanker(index, trainPrepared, params, { seed = 2026, onProgress = () => {}, ...opt } = {}) {
  const o = { ...RANKER_DEFAULTS, ...opt };
  const raw = trainPrepared.map((it) => {
    const { cands, X } = candidateSet(index, it.prep, params, o.candidates);
    return { X, goldIdx: cands.findIndex((h) => h.docId === it.gold) };
  });
  // Standardise each feature with the training mean and spread (stored with the model).
  const F = RANKER_FEATURES.length, all = raw.flatMap((r) => r.X);
  const mean = Array.from({ length: F }, (_, f) => all.reduce((s, x) => s + x[f], 0) / (all.length || 1));
  const std = mean.map((m, f) => Math.sqrt(all.reduce((s, x) => s + (x[f] - m) ** 2, 0) / (all.length || 1)) || 1);
  const norm = (r) => ({ ...r, Xn: r.X.map((x) => x.map((v, f) => (v - mean[f]) / std[f])) });
  const sets = raw.map(norm);
  const evalSets = (net, ss) => {
    let mrr = 0;
    for (const s of ss) {
      if (s.goldIdx < 0) continue;
      const sc = s.Xn.map((x) => netScore(net, x));
      const g = sc[s.goldIdx];
      const rank = sc.filter((v, i) => v > g || (v === g && i < s.goldIdx)).length;
      if (rank < 10) mrr += 1 / (rank + 1);
    }
    return mrr / (ss.length || 1);
  };
  // 1) choose the epoch count on a validation slice of the training questions
  const shuffled = shuffle(sets, rng(seed + 7)), cut = Math.round(shuffled.length * 0.8);
  const inner = shuffled.slice(0, cut), val = shuffled.slice(cut);
  let best = { epochs: o.checkEvery, mrr: -1 };
  const probe = initNet(F, o.hidden, seed);
  await fitNet(inner, probe, { ...o, epochs: o.maxEpochs, onEpoch: async (ep) => {
    if (ep % o.checkEvery) return;
    const mrr = evalSets(probe, val);
    if (mrr > best.mrr + 1e-9) best = { epochs: ep, mrr };
    onProgress('validate', ep, o.maxEpochs, round(best.mrr, 3));
    await new Promise((r) => setTimeout(r, 0));
  } });
  // 2) retrain on all training questions for the chosen number of epochs
  const net = initNet(F, o.hidden, seed);
  await fitNet(sets, net, { ...o, epochs: best.epochs, onEpoch: async (ep) => {
    if (ep % o.checkEvery === 0 || ep === best.epochs) { onProgress('fit', ep, best.epochs); await new Promise((r) => setTimeout(r, 0)); }
  } });
  const r5 = (a) => Array.from(a, (v) => round(v, 5));
  return {
    type: 'neural re-ranker', features: [...RANKER_FEATURES], candidates: o.candidates, hidden: o.hidden,
    mean: r5(mean), std: r5(std), v: r5(net.v), W1: r5(net.W1), b1: r5(net.b1), w2: r5(net.w2), b2: 0,
    epochs: best.epochs, validationMrr: round(best.mrr, 3), validation: val.length, trainedOn: sets.length,
    weights: net.v.length + net.W1.length + net.b1.length + net.w2.length
  };
}

/** Full training run: question set → 80/20 split → grid search and neural re-ranker on train → score all three on the held-out 20%. */
export async function train(index, { seed = 2026, perKind = 120, grid = GRID, onProgress, onModelProgress, ranker: rankerOpts = {} } = {}) {
  const items = makeQuestionSet(index, { seed, perKind });
  const { train: tr, test: te } = split8020(items, seed);
  const trP = prepareSet(index, tr), teP = prepareSet(index, te);
  const tuned = await tune(index, trP, { grid, onProgress });
  const ranker = await trainRanker(index, trP, tuned.params, { seed, onProgress: onModelProgress, ...rankerOpts });
  const byKind = {};
  for (const kind of [...new Set(te.map((t) => t.kind))]) {
    const sub = teP.filter((t) => t.kind === kind);
    byKind[kind] = { n: sub.length, default: evaluate(index, sub, DEFAULT_PARAMS), tuned: evaluate(index, sub, tuned.params), ml: evaluateRanker(index, sub, tuned.params, ranker) };
  }
  return {
    params: tuned.params, defaults: { ...DEFAULT_PARAMS }, seed, grid, combos: tuned.combos, ranker,
    sizes: { total: items.length, train: tr.length, test: te.length, docs: index.docs.size, chunks: index.chunks.length },
    metrics: {
      train: { default: evaluate(index, trP, DEFAULT_PARAMS), tuned: tuned.train, ml: evaluateRanker(index, trP, tuned.params, ranker) },
      test: { default: evaluate(index, teP, DEFAULT_PARAMS), tuned: evaluate(index, teP, tuned.params), ml: evaluateRanker(index, teP, tuned.params, ranker) }
    },
    byKind, examples: te.slice(0, 12)
  };
}

/**
 * How much clarifying questions help, on a question set with known sources. A simulated analyst who knows what they
 * want answers each clarifying question with the choice that matches the right document, or "any" when it isn't offered.
 * This is an upper bound: a real analyst can pick a wrong choice.
 */
export function evaluateClarify(index, items, params = DEFAULT_PARAMS, opts = {}) {
  let asked = 0, questions = 0, offered = 0, answered = 0;
  const base = { h1: 0, h3: 0, mrr: 0 }, clar = { h1: 0, h3: 0, mrr: 0 };
  const score = (acc, rank) => { if (rank === 0) acc.h1++; if (rank >= 0 && rank < 3) acc.h3++; if (rank >= 0) acc.mrr += 1 / (rank + 1); };
  for (const { q, gold } of items) {
    const doc = index.docs.get(gold);
    const truth = { dataset: doc.dataset, focus: focusKey(doc), period: String(docYears(doc)[0] ?? '') };
    const scope = {};
    for (let round = 0; round < 3; round++) {
      const next = clarifyQuestions(index, q, params, { ...opts, scope })[0];
      if (!next) break;
      if (!round) asked++;
      questions++;
      const pick = next.options.find((o) => o.value === truth[next.id] || (o.value === 'recent' && Number(truth.period) >= index.maxYear - 1));
      if (pick) offered++;
      scope[next.id] = pick ? pick.value : '*';
    }
    if (Object.keys(scope).length) answered++;
    score(base, scoreDocs(index, prepareQuery(index, q), params).slice(0, 10).findIndex((h) => h.docId === gold));
    score(clar, scoreDocs(index, prepareQuery(index, scopedQuery(q, scope)), params, { dataset: realScope(scope.dataset), focus: realScope(scope.focus) }).slice(0, 10).findIndex((h) => h.docId === gold));
  }
  const n = items.length || 1;
  const fin = (a) => ({ hit1: round(a.h1 / n, 3), hit3: round(a.h3 / n, 3), mrr: round(a.mrr / n, 3) });
  return { n: items.length, askedShare: round(asked / n, 3), avgQuestions: round(questions / (asked || 1), 2), rightChoiceOffered: round(offered / (questions || 1), 3), without: fin(base), with: fin(clar) };
}

// ---------------------------------------------------------------- agent: tools, prompt, and answer checks

export const MIN_OPTIONS = 3;

export const AGENT_TOOLS = [
  {
    name: 'search_universe',
    description: 'Ranked search over the local data universe (downloaded public datasets only). Returns passages, each with a citation id in square brackets. Use several focused searches rather than one broad one.',
    input_schema: { type: 'object', properties: {
      query: { type: 'string', description: 'Keywords or a question, e.g. "10-year Treasury yield 2022" or "Buffett share repurchases".' },
      dataset: { type: 'string', description: 'Optional dataset id to restrict the search (see list_datasets).' },
      max_results: { type: 'integer', description: 'Passages to return, 1-12 (default 8).' }
    }, required: ['query'] }
  },
  {
    name: 'get_series',
    description: 'Exact values of one time series from the universe between two dates (downsampled to at most 150 points). Use for precise numbers; ids look like FEDFUNDS, DGS10, FF:HML, SHILLER:CAPE, WB:FP.CPI.TOTL.ZG:IND.',
    input_schema: { type: 'object', properties: {
      series_id: { type: 'string' }, start: { type: 'string', description: 'YYYY or YYYY-MM-DD (optional)' }, end: { type: 'string', description: 'YYYY or YYYY-MM-DD (optional)' }
    }, required: ['series_id'] }
  },
  { name: 'list_datasets', description: 'Lists the datasets in the universe with ids, coverage and example series ids.', input_schema: { type: 'object', properties: {} } }
];

export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    options: { type: 'array', items: { type: 'object', properties: {
      answer: { type: 'string' }, relevance: { type: 'integer' }, why: { type: 'string' }, sources: { type: 'array', items: { type: 'string' } }
    }, required: ['answer', 'relevance', 'why', 'sources'], additionalProperties: false } },
    conclusion: { type: 'string' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    coverage_note: { type: 'string' }
  },
  required: ['conclusion', 'confidence', 'options', 'coverage_note'],
  additionalProperties: false
};

export function systemPrompt(datasetLines) {
  return `You are a data-discovery assistant for wealth-management analysts building a market outlook.
You can see ONLY the local data universe below, through your tools. It is a closed world: never use outside knowledge, recent news, or memory of markets to state facts. If the universe does not contain something, say so in coverage_note.

Datasets in the universe:
${datasetLines}

How to work:
- Gather every entry that bears on the question before answering: run several focused searches (the direct measure, related indicators, forecasts vs actuals, dated commentary such as FOMC statements or letters, other countries) and use get_series when exact numbers or trends matter.
- conclusion: your own answer to the question, drawn from ALL the relevant entries together, not a quote. 4-8 sentences: lead with the direct answer, then the evidence that supports it, then what points the other way or limits it. Connect the sources (e.g. what forecasters expected vs what happened, what the Fed said vs what rates did). Cite the entries behind each claim inline with their ids in square brackets, e.g. "yields rose 2.25 points [S:DGS10:2022#1]".
- confidence: high when several independent entries agree, medium when the evidence is partial, low when it is thin or conflicting.
- Then give AT LEAST ${MIN_OPTIONS} distinct options, sorted from most to least relevant to the question. An option is one answer or interpretation, backed by a different source, dataset, period or angle (for example: the direct number, the related indicator, the dated commentary).
- relevance is 0-100: how directly the option answers the question. Never give two options the same wording.
- sources lists the citation ids exactly as shown in square brackets in tool results, e.g. "S:FEDFUNDS:2008#1". Every option needs at least one.
- If the question gives no date, lead with the most recent data (latest quarter or year) and order dated options from latest to earliest; past data is already reflected in prices.
- Numbers must come from the tool results. Describe what the data shows; do not give investment advice or recommendations.
- Reply with only the JSON object (conclusion, confidence, options, coverage_note).`;
}

export function formatHits(hits) {
  return hits.map((h) => `[${h.chunk.id}] ${h.doc.title} | dataset: ${h.doc.dataset} | ${h.doc.date || 'undated'}\n${h.chunk.text.slice(0, 1200)}`).join('\n\n');
}

/** Runs one agent tool against the local universe. `seen` collects every citation id shown to the model. */
export function runTool(ctx, name, input, seen) {
  const { index, series, params, datasets } = ctx;
  if (name === 'search_universe') {
    const k = Math.min(12, Math.max(1, Number(input.max_results) || 8));
    const hits = search(index, String(input.query || ''), params, { k, dataset: input.dataset || '' });
    hits.forEach((h) => seen.add(h.chunk.id));
    return hits.length ? formatHits(hits) : 'No matching passages in the universe.';
  }
  if (name === 'get_series') {
    const id = String(input.series_id || '').trim();
    const s = series.find((x) => x.id.toLowerCase() === id.toLowerCase()) || series.find((x) => x.id.toLowerCase().endsWith(':' + id.toLowerCase()));
    if (!s) return `No series "${id}". Some available ids: ${series.slice(0, 40).map((x) => x.id).join(', ')}`;
    const lo = input.start ? String(input.start) : '', hi = input.end ? String(input.end) + '￿' : '￿';
    let pts = s.points.filter((p) => p[0] >= lo && p[0] <= hi);
    const n = pts.length;
    if (n > 150) { const step = Math.ceil(n / 150); pts = pts.filter((_, i) => i % step === 0 || i === n - 1); }
    const cite = `S:${s.id}#1`;
    seen.add(cite);
    return `Series ${s.id}: ${s.title} (${s.units}, ${FREQ[s.freq] || s.freq}). Cite as [${cite}]. ${n} observations in range${n > 150 ? `, showing every ${Math.ceil(n / 150)}th` : ''}:\n${pts.map((p) => `${p[0]} ${p[1]}`).join('\n')}`;
  }
  if (name === 'list_datasets') return datasets;
  return `Unknown tool ${name}.`;
}

// ---------------------------------------------------------------- open-model conclusions (one call, no tools)

/**
 * Collects the entries an open model reads before concluding: the trained ranking's top documents
 * (at most 2 per series), plus the best passages from letters/statements so commentary sits beside the numbers.
 */
export function gatherEntries(index, query, params = DEFAULT_PARAMS, { k = 10, dataset = '', focus = '' } = {}) {
  const per = new Map();
  const all = search(index, query, params, { k: 400, dataset, focus });
  const picked = all.filter((h) => {
    const key = h.doc.seriesId || h.doc.id;
    per.set(key, (per.get(key) || 0) + 1);
    return per.get(key) <= (focus ? k : 2);
  }).slice(0, k - 2);
  const have = new Set(picked.map((h) => h.docId));
  const text = all.filter((h) => h.doc.kind === 'text' && !have.has(h.docId)).slice(0, 2);
  return [...picked, ...text];
}

/** Chat messages asking an open model for a cited conclusion. Sources are numbered [1]..[n] because small ids are easier for it to copy. */
export function conclusionMessages(question, entries) {
  const sources = entries.map((h, i) => `[${i + 1}] ${h.doc.title} | dataset: ${h.doc.dataset} | ${h.doc.date || 'undated'}\n${h.chunk.text.slice(0, 1500)}`).join('\n\n');
  return [
    { role: 'system', content: `You help wealth-management analysts build a market outlook. You may use ONLY the numbered sources the user gives you: a closed world. Never add facts, numbers, dates or events from your own knowledge. Do not give investment advice or recommendations.` },
    { role: 'user', content: `QUESTION: ${question}

SOURCES:
${sources}

Write your own conclusion that answers the question by combining ALL the relevant sources, not by quoting one.
- 4-8 sentences. Lead with the direct answer, then the evidence, then what points the other way or limits the conclusion.
- Connect the sources where you can (what forecasters expected vs what happened, what the Fed said vs what rates did, one country vs another).
- After every claim, cite the source numbers in square brackets, e.g. "the 10-year yield rose 2.25 points [1]" or "[2, 5]".
- If the sources do not answer the question, say so plainly.
- confidence: "high" if several sources agree, "medium" if the evidence is partial, "low" if it is thin or conflicting.

Reply with only this JSON:
{"conclusion": "...", "confidence": "low|medium|high", "coverage_note": "what the sources do not cover"}` }
  ];
}

/** Turns "[1]" / "[2, 5]" source numbers into the "[chunk-id]" form checkConclusion validates. Out-of-range numbers become ids no tool returned, so they count as dropped. */
export function numbersToIds(text, entries) {
  return String(text || '').replace(/\[(\s*\d+(?:\s*[,;]\s*\d+)*\s*)\]/g, (_, nums) =>
    `[${nums.split(/[,;]/).map((n) => { const h = entries[Number(n.trim()) - 1]; return h ? h.chunk.id : `missing-${n.trim()}#0`; }).join(', ')}]`);
}

/** Pulls the JSON object out of the model's final text (tolerates surrounding prose or code fences). */
export function parseAnswer(text) {
  const s = String(text || '');
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

/**
 * Splits the agent's conclusion into text and numbered references. Inline "[id]" or "[id1, id2]" citations
 * become refs when the id was shown by a tool; any other bracketed id is removed and counted.
 */
export function checkConclusion(text, seen, index) {
  const seenIds = seen instanceof Set ? seen : new Set(seen);
  const refs = [], parts = [];
  let dropped = 0, last = 0;
  const s = String(text || '');
  for (const m of s.matchAll(/\[([^\[\]]+)\]/g)) {
    const ids = m[1].split(/[,;]\s*/).map((x) => x.trim()).filter(Boolean);
    if (!ids.some((id) => /#\d+$/.test(id))) continue; // ordinary brackets, not a citation
    parts.push({ text: s.slice(last, m.index).replace(/\s+$/, '') });
    for (const id of ids) {
      if (seenIds.has(id) && index.chunkById.has(id)) {
        if (!refs.includes(id)) refs.push(id);
        parts.push({ ref: refs.indexOf(id) + 1, id });
      } else dropped++;
    }
    last = m.index + m[0].length;
  }
  parts.push({ text: s.slice(last) });
  return { parts: parts.filter((p) => p.ref || p.text), refs, dropped };
}

/**
 * Checks the agent's options: citations must be ids the tools actually returned (others are dropped),
 * options are sorted by relevance, and the list is padded from the search ranking up to MIN_OPTIONS.
 */
export function finalizeOptions(raw, seen, index, fallback = [], min = MIN_OPTIONS) {
  const seenIds = seen instanceof Set ? seen : new Set(seen);
  let dropped = 0;
  const opts = (Array.isArray(raw?.options) ? raw.options : []).filter((o) => o && String(o.answer || '').trim()).map((o) => {
    const cited = (Array.isArray(o.sources) ? o.sources : []).map((x) => String(x).replace(/^\[|\]$/g, '').trim());
    const valid = cited.filter((id) => seenIds.has(id) && index.chunkById.has(id));
    dropped += cited.length - valid.length;
    const first = valid.length ? index.docs.get(index.chunks[index.chunkById.get(valid[0])].docId) : null;
    return { answer: String(o.answer).trim(), why: String(o.why || ''), relevance: Math.max(0, Math.min(100, Math.round(Number(o.relevance) || 0))), sources: valid,
      docId: first?.id || '', title: first?.title || '', dataset: first?.dataset || '', date: first?.date || '', origin: 'agent', status: valid.length ? 'cited' : 'uncited' };
  });
  // An option without a valid citation can't outrank a cited one: cap it just below the weakest cited option.
  const citedFloor = Math.min(101, ...opts.filter((o) => o.status === 'cited').map((o) => o.relevance));
  for (const o of opts) if (o.status === 'uncited') o.relevance = Math.max(0, Math.min(o.relevance, citedFloor - 1));
  opts.sort((a, b) => b.relevance - a.relevance);
  const usedDocs = new Set(opts.map((o) => o.docId).filter(Boolean));
  const floor = opts.length ? Math.min(...opts.map((o) => o.relevance)) : 101;
  for (const f of fallback) {
    if (opts.length >= min) break;
    if (usedDocs.has(f.docId)) continue;
    usedDocs.add(f.docId);
    opts.push({ ...f, relevance: Math.min(f.relevance, Math.max(0, floor - 1)), status: 'cited', origin: 'search' });
  }
  const conclusion = raw?.conclusion ? checkConclusion(raw.conclusion, seenIds, index) : null;
  return {
    options: opts.map((o, i) => ({ ...o, rank: i + 1 })), coverage: String(raw?.coverage_note || ''),
    // A conclusion that cites nothing cannot be checked against the entries, so it never reads as confident.
    conclusion, confidence: conclusion && !conclusion.refs.length ? 'low' : ['low', 'medium', 'high'].includes(raw?.confidence) ? raw.confidence : 'low',
    droppedCitations: dropped + (conclusion?.dropped || 0)
  };
}
