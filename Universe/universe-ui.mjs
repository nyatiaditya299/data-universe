// Data Universe dashboard: download public datasets, build the local universe, train the ranking 80/20, and ask questions.
import {
  fredSeries, vixSeries, famaFrenchSeries, shillerSeries, spfSeries, worldBankSeries, seriesDocs, panelDocs, holdingsDocs,
  buildUniverseIndex, rankedOptions, search, train, DEFAULT_PARAMS, GRID, AGENT_TOOLS, ANSWER_SCHEMA, MIN_OPTIONS,
  systemPrompt, formatHits, runTool, parseAnswer, finalizeOptions, fmt, gatherEntries, conclusionMessages, numbersToIds,
  clarifyQuestions, scopedQuery
} from './universe-core.mjs';
import { startNebula } from './nebula.mjs';

const OPEN_PRESETS = {
  // Free anonymous tier serving the open-weight GPT-OSS 20B: no key, one reply every 30 seconds per IP.
  pollinations: { base: 'https://text.pollinations.ai/openai', model: 'openai-fast', keys: 'https://enter.pollinations.ai', keyless: true },
  groq: { base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keys: 'https://console.groq.com/keys' },
  openrouter: { base: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', keys: 'https://openrouter.ai/settings/keys' }
};

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const MAX_AGENT_TURNS = 8;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const state = { catalog: null, status: null, docs: [], series: [], index: null, model: null, params: { ...DEFAULT_PARAMS }, stale: false, busy: false, abort: null, last: null, concl: { status: 'idle' }, indexBytes: 0, evalProg: null, expanded: new Set(), asked: false, trace: null, treeShown: new Set() };
let nebula = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body) {
  const init = body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) };
  const r = await fetch(path, init);
  const t = await r.text();
  let json;
  try { json = JSON.parse(t); } catch { json = { raw: t }; }
  return { ok: r.ok, status: r.status, json };
}

async function getText(path) { const r = await fetch(path, { cache: 'no-store' }); if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`); return r.text(); }
async function getBytes(path) { const r = await fetch(path, { cache: 'no-store' }); if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`); return r.arrayBuffer(); }

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`Could not load ${src} (needs internet once)`));
    document.head.append(s);
  });
}
let pdfReady = null, xlsxReady = null;
async function pdfText(buf) {
  // Both scripts load as plain <script> tags; with pdfjsWorker defined, pdf.js parses on the main thread (no Worker needed).
  pdfReady ||= loadScript(PDFJS + 'pdf.min.js').then(() => loadScript(PDFJS + 'pdf.worker.min.js')).then(() => { globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; });
  await pdfReady;
  const pdf = await globalThis.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    let line = '', out = '';
    for (const item of content.items) { line += item.str; if (item.hasEOL) { out += line + '\n'; line = ''; } else line += ' '; }
    pages.push((out + line).replace(/[ \t]+/g, ' '));
  }
  return pages.join('\n\n');
}
async function workbook(buf) {
  xlsxReady ||= loadScript(XLSX_URL);
  await xlsxReady;
  return globalThis.XLSX.read(new Uint8Array(buf), { type: 'array' });
}
const sheetRows = (wb, name) => globalThis.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });

function htmlText(raw, selector) {
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  doc.querySelectorAll('script,style,nav,header,footer,aside,form,noscript,svg').forEach((n) => n.remove());
  const root = (selector && doc.querySelector(selector)) || doc.querySelector('article') || doc.querySelector('main') || doc.body;
  const blocks = [...root.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,td')].map((n) => n.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t.length > 1);
  return { text: blocks.length ? blocks.join('\n') : root.textContent, title: (doc.querySelector('h3.title, h1')?.textContent || doc.title || '').replace(/\s+/g, ' ').trim() };
}

// ---------------------------------------------------------------- building the universe from downloaded files

const okFiles = (ds) => (state.status?.datasets?.[ds.id]?.files || []).filter((f) => f.ok);
const dataPath = (ds, name) => `data/${ds.id}/${name}`;

async function parseDataset(ds, log) {
  const series = [], docs = [], filings = [];
  const base = { dataset: ds.id, publisher: ds.publisher };
  const files = okFiles(ds);
  if (ds.type === 'fred') {
    for (const f of files) {
      const meta = ds.series.find((s) => s.id === f.series);
      if (meta) series.push(fredSeries(await getText(dataPath(ds, f.name)), { ...base, ...meta, file: dataPath(ds, f.name), source: `https://fred.stlouisfed.org/series/${meta.id}` }));
    }
  } else if (ds.type === 'files' && ds.parse === 'cboe-vix') {
    series.push(vixSeries(await getText(dataPath(ds, files[0].name)), { ...base, id: 'VIX', title: 'Cboe VIX volatility index, daily close', units: 'index points', freq: 'D', file: dataPath(ds, files[0].name), source: ds.homepage }));
  } else if (ds.type === 'files' && ds.parse === 'ff-factors') {
    for (const f of files) for (const x of f.extracted || []) series.push(...famaFrenchSeries(await getText(dataPath(ds, x)), { ...base, file: dataPath(ds, x), source: ds.homepage }));
  } else if (ds.type === 'files' && ds.parse === 'shiller') {
    const wb = await workbook(await getBytes(dataPath(ds, files[0].name)));
    series.push(...shillerSeries(sheetRows(wb, wb.SheetNames.includes('Data') ? 'Data' : wb.SheetNames[0]), { ...base, file: dataPath(ds, files[0].name), source: ds.homepage }));
  } else if (ds.type === 'files' && ds.parse === 'spf') {
    const wb = await workbook(await getBytes(dataPath(ds, files[0].name)));
    for (const [sheet, title] of Object.entries(ds.sheets)) if (wb.Sheets[sheet]) series.push(...spfSeries(sheet, sheetRows(wb, sheet), title, { ...base, file: dataPath(ds, files[0].name), source: ds.homepage }));
  } else if (ds.type === 'files' && ds.parse === 'berkshire') {
    for (const f of files) {
      const y = Number(f.name.slice(0, 4));
      log(`Reading Berkshire letter ${y}…`);
      docs.push({ id: `T:berkshire:${y}`, dataset: ds.id, kind: 'text', title: `Berkshire Hathaway shareholder letter for ${y}`, date: `${y + 1}-02`, years: [y, y + 1], url: dataPath(ds, f.name), source: f.url, text: await pdfText(await getBytes(dataPath(ds, f.name))) });
    }
  } else if (ds.type === 'fomc') {
    for (const f of files) {
      const h = htmlText(await getText(dataPath(ds, f.name)), '#article');
      // Drop the press-release header lines (date, "Federal Reserve issues…", "For release at…", "Share").
      const text = h.text.split('\n').filter((l) => !/^(\w+ \d{1,2}, \d{4}|Federal Reserve issues .*|For release at .*|Share)$/i.test(l.trim())).join('\n');
      docs.push({ id: `T:fomc:${f.date}`, dataset: ds.id, kind: 'text', title: `FOMC statement, ${f.date}`, date: f.date, url: dataPath(ds, f.name), source: f.url, text });
    }
  } else if (ds.type === 'worldbank') {
    for (const f of files) {
      const ind = ds.indicators.find((i) => i.id === f.indicator);
      series.push(...worldBankSeries(JSON.parse(await getText(dataPath(ds, f.name))), ind, { ...base, file: dataPath(ds, f.name), source: `https://data.worldbank.org/indicator/${ind.id}` }));
    }
  } else if (ds.type === 'sec13f') {
    for (const f of files.filter((x) => x.reportDate)) {
      const xml = new DOMParser().parseFromString(await getText(dataPath(ds, f.name)), 'application/xml');
      const val = (el, tag) => el.getElementsByTagNameNS('*', tag)[0]?.textContent.trim() || '';
      const holdings = [...xml.getElementsByTagNameNS('*', 'infoTable')].map((el) => ({ name: val(el, 'nameOfIssuer'), cls: val(el, 'titleOfClass'), cusip: val(el, 'cusip'), value: Number(val(el, 'value')) || 0, shares: Number(val(el, 'sshPrnamt')) || 0, putCall: val(el, 'putCall') }));
      filings.push({ manager: f.manager, cik: f.cik, reportDate: f.reportDate, filingDate: f.filingDate, url: `https://www.sec.gov/Archives/edgar/data/${f.cik}/${String(f.accession).replace(/-/g, '')}/`, holdings });
    }
    docs.push(...holdingsDocs(filings, { dataset: ds.id }));
  } else if (ds.type === 'local') {
    for (const f of files) {
      const path = f.path, ext = path.split('.').pop().toLowerCase();
      const date = (f.name.match(/^(\d{4}-\d{2}(?:-\d{2})?)/) || [])[1] || '';
      let text = '', title = f.name.replace(/\.[^.]+$/, '').replace(/^\d{4}-\d{2}(-\d{2})?[ _-]*/, '').replace(/[_-]+/g, ' ');
      if (ext === 'pdf') text = await pdfText(await getBytes(path));
      else if (ext === 'html' || ext === 'htm') { const h = htmlText(await getText(path)); text = h.text; title = h.title || title; }
      else text = await getText(path);
      docs.push({ id: `T:my-docs:${f.name}`, dataset: ds.id, kind: 'text', title, date, url: path, source: '', text });
    }
  }
  return { series, docs };
}

async function buildUniverse() {
  const log = (m) => { $('#buildLog').textContent = m; };
  state.busy = true; renderTrain();
  try {
    const series = [], docs = [];
    for (const ds of state.catalog.datasets) {
      if (!okFiles(ds).length) continue;
      log(`Parsing ${ds.name}…`);
      try {
        const r = await parseDataset(ds, log);
        series.push(...r.series); docs.push(...r.docs);
      } catch (e) { console.error(e); log(`Skipped ${ds.name}: ${e.message}`); await new Promise((r) => setTimeout(r, 1200)); }
    }
    for (const s of series) docs.push(...seriesDocs(s));
    docs.push(...panelDocs(series));
    log('Saving the universe…');
    const seriesJson = JSON.stringify(series), docsJson = JSON.stringify(docs);
    await api('/api/save?name=series.json', seriesJson);
    await api('/api/save?name=docs.json', docsJson);
    state.indexBytes = seriesJson.length + docsJson.length;
    state.series = series; state.docs = docs;
    state.index = buildUniverseIndex(docs);
    state.stale = false;
    await refreshStatus();
    log(`Built: ${docs.length.toLocaleString()} documents, ${state.index.chunks.length.toLocaleString()} passages, ${series.length} time series.`);
  } finally { state.busy = false; renderAll(); }
}

async function loadUniverse() {
  const [docsText, seriesText] = await Promise.all([getText('data/_index/docs.json'), getText('data/_index/series.json')]);
  const docs = JSON.parse(docsText), series = JSON.parse(seriesText);
  state.indexBytes = docsText.length + seriesText.length;
  state.docs = docs; state.series = series;
  state.index = buildUniverseIndex(docs);
  if (state.status.index['model.json']) {
    state.model = JSON.parse(await getText('data/_index/model.json'));
    state.params = { ...DEFAULT_PARAMS, ...state.model.params };
  }
}

async function runTraining() {
  state.busy = true; state.evalProg = { i: 0, n: combosN }; renderTrain();
  try {
    const r = await train(state.index, { onProgress: (i, n, best) => {
      state.evalProg = { i, n };
      $('#evalText').textContent = `${i}/${n} evaluated`; $('#evalFill').style.width = `${(i / n) * 100}%`;
      $('#buildLog').textContent = `Grid search ${i}/${n} · best training MRR so far ${best.metrics.mrr}`;
    } });
    r.trainedAt = new Date().toISOString();
    state.model = r; state.params = { ...r.params };
    await api('/api/save?name=model.json', JSON.stringify(r));
    await refreshStatus();
    $('#buildLog').textContent = `Trained on ${r.sizes.train} questions, tested on ${r.sizes.test} held-out questions.`;
  } finally { state.busy = false; state.evalProg = null; renderAll(); }
}

// ---------------------------------------------------------------- rendering: datasets and settings

async function refreshStatus() { state.status = (await api('/api/status')).json; }

function datasetDocCount(id) { return state.docs.filter((d) => d.dataset === id).length; }

function renderDatasets() {
  const q = $('#catalogFilter').value.trim().toLowerCase();
  const groups = new Map();
  for (const ds of state.catalog.datasets) {
    const hay = [ds.name, ds.group, ds.publisher, ds.description, ...(ds.series || []).map((s) => `${s.id} ${s.title}`), ...(ds.indicators || []).map((s) => s.title)].join(' ').toLowerCase();
    if (q && !q.split(/\s+/).every((w) => hay.includes(w))) continue;
    if (!groups.has(ds.group)) groups.set(ds.group, []);
    groups.get(ds.group).push(ds);
  }
  const ua = state.status.settings.secUserAgent;
  $('#catalog').innerHTML = groups.size ? [...groups].map(([g, list]) => `<section class="group"><h3 class="eyebrow">${esc(g)}</h3>${list.map((ds) => {
    const m = state.status.datasets[ds.id];
    const bytes = (m?.files || []).reduce((a, f) => a + (f.bytes || 0), 0);
    const failed = (m?.files || []).filter((f) => !f.ok);
    const n = datasetDocCount(ds.id);
    const blocked = ds.type === 'sec13f' && !ua;
    const status = !m ? '<span class="pill">Not downloaded</span>'
      : m.okCount ? `<span class="pill ok">Downloaded ${esc(m.downloadedAt.replace('T', ' ').slice(0, 16))}</span> <span class="muted">${m.okCount} file${m.okCount > 1 ? 's' : ''} · ${kb(bytes)}${n ? ` · ${n.toLocaleString()} docs in universe` : ''}</span>`
      : '<span class="pill warn">Nothing downloaded</span>';
    const items = ds.series || ds.indicators || ds.managers;
    return `<article class="ds" data-id="${ds.id}">
      <div class="ds-top"><div><strong>${esc(ds.name)}</strong><div class="muted">${esc(ds.publisher)}${ds.homepage ? ` · <a href="${esc(ds.homepage)}" target="_blank" rel="noopener">source</a>` : ''}</div></div>
      <button class="secondary small" data-download="${ds.id}" ${state.busy || blocked ? 'disabled' : ''}>${ds.type === 'local' ? 'Scan folder' : m ? 'Update' : 'Download'}</button></div>
      <p>${esc(ds.description)}</p>
      ${items ? `<p class="series">${items.map((s) => `<span title="${esc(s.title || s.name)}">${esc(s.id || s.cik)}${s.title ? '' : ` ${esc(s.name)}`}</span>`).join('')}</p>` : ''}
      <div class="ds-status">${status}</div>
      ${blocked ? '<p class="note">The SEC needs a User-Agent with your name and email first (Settings).</p>' : ''}
      ${m?.error ? `<p class="note">${esc(m.error)}</p>` : ''}
      ${failed.length ? `<p class="note">${failed.length} file${failed.length > 1 ? 's' : ''} failed: ${failed.slice(0, 4).map((f) => `${esc(f.name)} (HTTP ${esc(f.status || '?')})`).join(', ')}</p>` : ''}
      ${m?.okCount ? `<details><summary>Files on your computer</summary><ul class="files">${m.files.filter((f) => f.ok).map((f) => `<li><a href="${esc(f.path || dataPath(ds, f.name))}" target="_blank">${esc(f.name)}</a> <span class="muted">${kb(f.bytes)}</span></li>`).join('')}</ul><p class="muted small-text">Folder: Universe\\data\\${esc(ds.id)}</p></details>` : ''}
      <p class="muted small-text">${esc(ds.license)}</p>
    </article>`;
  }).join('')}</section>`).join('') : '<p class="muted">No dataset matches that filter.</p>';
  const downloaded = state.catalog.datasets.filter((d) => state.status.datasets[d.id]?.okCount).length;
  $('#catalogSummary').textContent = `${downloaded} / ${state.catalog.datasets.length} datasets`;
  $('#downloadAll').disabled = state.busy;
}

async function download(id) {
  state.busy = true; renderDatasets();
  const ds = state.catalog.datasets.find((d) => d.id === id);
  const card = document.querySelector(`.ds[data-id="${id}"] .ds-status`);
  if (card) card.innerHTML = `<span class="pill">Downloading… (large sets take a minute)</span>`;
  try {
    const r = await api('/api/download', { id });
    if (!r.ok) throw new Error(r.json.error || `HTTP ${r.status}`);
    await refreshStatus();
    state.stale = true;
  } catch (e) { alert(`${ds.name}: ${e.message}`); }
  finally { state.busy = false; renderAll(); }
}

async function downloadAll() {
  const ua = state.status.settings.secUserAgent;
  for (const ds of state.catalog.datasets) {
    if (ds.type === 'local' || (ds.type === 'sec13f' && !ua)) continue;
    await download(ds.id);
  }
}

const presetFor = (base) => Object.keys(OPEN_PRESETS).find((k) => OPEN_PRESETS[k].base === base) || 'custom';
const keyLinkHtml = (p) => !p ? '' : p.keyless
  ? `No key needed: free tier allows one conclusion every 30 seconds. An optional key at <a href="${p.keys}" target="_blank" rel="noopener">${new URL(p.keys).host}</a> removes the limit (use Custom).`
  : `Get a free key at <a href="${p.keys}" target="_blank" rel="noopener">${new URL(p.keys).host}</a>.`;
/** An open model can write conclusions: either a key is saved or the endpoint is keyless. */
const llmReady = (s) => s.llmKeySet || s.llmKeyless;
/** Human name for the open model, e.g. "GPT-OSS 20B · Pollinations". */
const llmLabel = (s) => (s.llmKeyless && /^(openai|openai-fast|gpt-oss(-20b)?)$/.test(s.llmModel) ? 'GPT-OSS 20B · Pollinations' : `${s.llmModel} · ${new URL(s.llmBaseUrl).host}`);

function renderSettings() {
  const s = state.status.settings;
  $('#secUa').value = s.secUserAgent || '';
  $('#modelSel').value = s.model || 'claude-opus-5-5';
  $('#engineSel').value = s.engine || 'open';
  $('#llmPreset').value = presetFor(s.llmBaseUrl);
  $('#llmBase').value = s.llmBaseUrl || '';
  $('#llmModel').value = s.llmModel || '';
  $('#llmKeyLink').innerHTML = keyLinkHtml(OPEN_PRESETS[$('#llmPreset').value]);
  $('#llmKeyState').textContent = s.llmKeySet ? 'Key saved.' : s.llmKeyless ? '' : 'No key yet.';
  $('#clearLlmKey').classList.toggle('hidden', !s.llmKeySet);
  $('#keyState').textContent = s.apiKeySet ? `Key set (from ${s.apiKeySource}).` : 'No key.';
  $('#clearKey').classList.toggle('hidden', s.apiKeySource !== 'settings file');
}

async function saveSettings(extra = {}) {
  const body = { secUserAgent: $('#secUa').value, model: $('#modelSel').value, engine: $('#engineSel').value, llmBaseUrl: $('#llmBase').value, llmModel: $('#llmModel').value, ...extra };
  const key = $('#apiKey').value.trim();
  if (key) body.anthropicApiKey = key;
  const llmKey = $('#llmKey').value.trim();
  if (llmKey) body.llmApiKey = llmKey;
  const r = await api('/api/settings', body);
  if (r.ok) { state.status = r.json; $('#apiKey').value = ''; $('#llmKey').value = ''; $('#settingsMsg').textContent = 'Saved.'; setTimeout(() => { $('#settingsMsg').textContent = ''; }, 2500); renderAll(); }
}

async function loadModels() {
  await saveSettings();
  $('#modelsMsg').textContent = 'Loading…';
  const r = await api('/api/llm-models');
  if (!r.ok) { $('#modelsMsg').textContent = `Could not load models: ${r.json?.error?.message || r.json?.raw?.slice(0, 120) || `HTTP ${r.status}`}`; return; }
  const ids = (r.json.data || []).map((m) => m.id).sort();
  $('#llmModels').innerHTML = ids.map((id) => `<option value="${esc(id)}">`).join('');
  $('#modelsMsg').textContent = `${ids.length} models available. Click the Model box to pick one${ids.some((i) => i.endsWith(':free')) ? ' (":free" ones cost nothing)' : ''}.`;
}

/** Which engine writes the conclusion: an open model, Claude, or none (ranked search only). */
function currentEngine() {
  const s = state.status.settings;
  if (!$('#useAgent').checked) return 'search';
  if (s.engine === 'claude' && s.apiKeySet) return 'claude';
  if (llmReady(s)) return 'open';
  return s.apiKeySet ? 'claude' : 'search';
}

// ---------------------------------------------------------------- rendering: build & train

const combosN = Object.values(GRID).reduce((n, v) => n * v.length, 1);
const showVal = (v, isPct) => (isPct ? `${Math.round(v * 100)}%` : v.toFixed(2));

const METRICS = [
  { key: 'hit1', name: 'Recall@1', sub: 'Right source ranked #1', pct: true },
  { key: 'hit3', name: 'Recall@3', sub: 'Right source in top 3 options', pct: true },
  { key: 'mrr', name: 'MRR', sub: 'Mean reciprocal rank', pct: false }
];
// The three kinds of corpus the held-out questions cover, as an analyst thinks of them.
const DOC_GROUPS = [
  { label: 'Macro & market fact sheets', kinds: ['series-year', 'series-summary', 'panel-year'] },
  { label: 'Letters & statements', kinds: ['text'] },
  { label: '13F filings', kinds: ['holdings', 'holdings-change'] }
];
const PARAM_INFO = [
  { key: 'k1', name: 'BM25 k₁', desc: 'Term saturation' },
  { key: 'b', name: 'BM25 b', desc: 'Document-length normalisation' },
  { key: 'titleBoost', name: 'Title boost', desc: 'Weight for query words found in the title' },
  { key: 'yearBoost', name: 'Year-match boost', desc: 'Weight for an exact year match' }
];

/** Question-weighted accuracy of one document group on the held-out questions; null when it has none. */
function groupStat(byKind, kinds, key) {
  let n = 0, before = 0, after = 0;
  for (const k of kinds) { const v = byKind[k]; if (v) { n += v.n; before += v.n * v.default[key]; after += v.n * v.tuned[key]; } }
  return n ? { n, before: before / n, after: after / n } : null;
}

/** A before/after bar: the pin marks the untrained score, the fill the trained one, the badge the lift in points. */
function deltaBar(before, after, isPct, label) {
  const lift = isPct ? Math.round(after * 100) - Math.round(before * 100) : Math.round((after - before) * 100) / 100;
  const sign = lift > 0 ? '+' : lift < 0 ? '−' : '±';
  const text = isPct ? `${sign}${Math.abs(lift)} pts` : `${sign}${Math.abs(lift).toFixed(2)}`;
  const w = (v) => Math.min(100, Math.max(0, v * 100)).toFixed(1);
  return `<div class="delta" role="img" aria-label="${esc(label)}: ${showVal(before, isPct)} before, ${showVal(after, isPct)} after training">
    <div class="track"><i class="fill" style="width:${w(after)}%"></i><i class="pin" style="left:${w(before)}%" title="Before training: ${showVal(before, isPct)}"></i></div>
    <b class="num">${showVal(after, isPct)}</b><span class="lift${lift > 0 ? '' : lift < 0 ? ' neg' : ' flat'}">${text}</span></div>`;
}

function paramGridHtml(m) {
  return PARAM_INFO.map((p) => {
    const vals = GRID[p.key];
    return `<div class="param"><span class="pn">${p.name}</span><span class="pd">${p.desc}</span>
      <div class="pr"><span>${Math.min(...vals)} – ${Math.max(...vals)} · ${vals.length} steps</span>${m ? `<span class="win" title="Winning value from the grid search">${m.params[p.key]}</span>` : ''}</div></div>`;
  }).join('');
}

function resultsHtml(m) {
  const t = m.metrics.test, top1 = t.tuned.hit1;
  const lift1 = Math.round(top1 * 100) - Math.round(t.default.hit1 * 100);
  const rows = METRICS.map((mt) => {
    const open = state.expanded.has(mt.key);
    const drill = DOC_GROUPS.map((g) => {
      const s = groupStat(m.byKind, g.kinds, mt.key);
      return s ? `<div class="drill-row"><div>${esc(g.label)}<small>n=${s.n}${s.n < 10 ? ' · indicative only' : ''}</small></div><span class="num muted">${showVal(s.before, mt.pct)}</span>${deltaBar(s.before, s.after, mt.pct, `${mt.name}, ${g.label}`)}</div>` : '';
    }).join('');
    return `<tr><td><button class="row-toggle" type="button" data-row="${mt.key}" aria-expanded="${open}" aria-controls="drill-${mt.key}"><span class="chev" aria-hidden="true">▸</span><span><b>${mt.name}</b><small>${mt.sub}</small></span></button></td>
        <td class="r num muted">${showVal(t.default[mt.key], mt.pct)}</td><td>${deltaBar(t.default[mt.key], t.tuned[mt.key], mt.pct, mt.name)}</td><td class="r num muted col-train">${showVal(m.metrics.train.tuned[mt.key], mt.pct)}</td></tr>
      <tr class="drill${open ? '' : ' hidden'}" id="drill-${mt.key}"><td colspan="4"><div class="drill-in">${drill}</div></td></tr>`;
  }).join('');
  return `<div class="res-head"><div>
      <div class="res-title"><span class="label">Results · Hold-Out Benchmark</span><span class="badge ${lift1 > 0 ? 'pos' : ''}">${lift1 > 0 ? '+' : ''}${lift1} pts Recall@1 lift</span></div>
      <p class="mono-line">Trained ${esc(new Date(m.trainedAt).toLocaleString())} · ${m.sizes.total} auto-generated questions → <b>${m.sizes.train} train (80%)</b> / <b>${m.sizes.test} test (20%)</b> · ${m.combos} settings tried.</p></div>
      ${top1 >= 0.75 ? '<button class="secondary small" type="button" data-go="ask">Test in 3 · Ask →</button>' : ''}</div>
    <div class="best"><span class="label">Winning weights</span>${PARAM_INFO.map((p) => `<span class="cfg" title="${esc(p.desc)}">${p.key === 'k1' ? 'k1' : p.key === 'b' ? 'b' : p.key === 'titleBoost' ? 'title_boost' : 'year_boost'}=${m.params[p.key]}</span>`).join('')}</div>
    <div class="res-wrap"><table class="res-table"><thead><tr><th>Held-out test (20%)</th><th class="r">Before</th><th>After training</th><th class="r col-train">Train (80%)</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted small-text">Pin = score before training. Click a metric to see it by document type; groups with fewer than 10 held-out questions are indicative only.</p>
    <div class="res-foot"><p>The tuned weights are saved and used by Step 3. Scores come from auto-generated questions, so they measure finding the right source, not answer quality.</p><button class="primary" type="button" data-go="ask">Proceed to 3 · Ask with Tuned Weights →</button></div>
    <details><summary>Sample held-out questions</summary><ul class="files">${m.examples.map((e) => `<li>${esc(e.q)} <span class="muted">→ ${esc(e.gold)}</span></li>`).join('')}</ul></details>`;
}

function renderTrain() {
  const has = !!state.index, m = state.model, ev = state.evalProg;
  const downloaded = state.catalog.datasets.some((d) => okFiles(d).length);
  $('#buildBtn').disabled = state.busy || !downloaded;
  $('#trainBtn').disabled = state.busy || !has;
  $('#staleNote').classList.toggle('hidden', !(state.stale && has));
  document.querySelectorAll('.combos-n').forEach((e) => { e.textContent = combosN; });
  // Header status
  const [status, tone] = !downloaded ? ['No data yet', 'warn'] : !has ? ['Not built', 'warn'] : state.stale ? ['Stale · rebuild', 'warn'] : m ? ['✓ Indexed & tuned', 'pos'] : ['Indexed · untrained', 'warn'];
  $('#idxStatus').textContent = status; $('#idxStatus').className = `sp-v ${tone}`;
  $('#lastTrained').textContent = m ? new Date(m.trainedAt).toLocaleString() : '—';
  // Card A: corpus telemetry
  const count = (kinds) => (has ? state.docs.filter((d) => kinds.includes(d.kind)).length.toLocaleString() : '—');
  $('#kpiDocs').textContent = has ? state.docs.length.toLocaleString() : '—';
  $('#kpiPassages').textContent = has ? state.index.chunks.length.toLocaleString() : '—';
  $('#kpiSeries').textContent = has ? state.series.length.toLocaleString() : '—';
  $('#pipeTs').textContent = count(['series-year', 'series-summary']);
  $('#pipeWb').textContent = count(['panel-year']);
  $('#pipeTx').textContent = count(['text']);
  $('#pipeHd').textContent = count(['holdings', 'holdings-change']);
  const indexed = state.catalog.datasets.filter((d) => datasetDocCount(d.id)).length;
  $('#parserBadge').textContent = `${indexed} dataset${indexed === 1 ? '' : 's'} indexed`;
  $('#parserBadge').className = `badge${indexed ? ' pos' : ''}`;
  $('#indexSize').textContent = has && state.indexBytes ? `Index size ~${(state.indexBytes / 1048576).toFixed(1)} MB` : 'Index not built';
  // Card B: 80/20 split, parameter space, live evaluation counter
  $('#splitTrainLbl').textContent = m ? `80% Train (${m.sizes.train} Qs)` : '80% Train';
  $('#splitTestLbl').textContent = m ? `20% Hold-out Test (${m.sizes.test} Qs)` : '20% Hold-out Test';
  $('#paramGrid').innerHTML = paramGridHtml(m);
  $('#evalText').textContent = ev ? `${ev.i}/${ev.n} evaluated` : m ? `✓ ${m.combos}/${m.combos} settings evaluated` : `0/${combosN} settings evaluated`;
  $('#evalFill').style.width = ev ? `${(ev.i / ev.n) * 100}%` : m ? '100%' : '0%';
  $('#evalCount').dataset.state = ev ? 'run' : m ? 'done' : 'idle';
  $('#trainResult').innerHTML = m ? resultsHtml(m)
    : `<div class="empty-train"><span class="label">Results · Hold-Out Benchmark</span><p>Not trained yet. The ranking uses standard BM25 settings (k1 ${DEFAULT_PARAMS.k1}, b ${DEFAULT_PARAMS.b}) until you train it. ${has ? 'Click <b>Train ranking</b> to see the held-out scores here.' : 'Build the universe first.'}</p></div>`;
}

/** Completion dots on the step tabs: data downloaded, universe built and tuned, a question asked. */
function renderNav() {
  const done = { datasets: state.catalog.datasets.some((d) => okFiles(d).length), train: !!(state.index && state.model && !state.stale), ask: state.asked };
  const names = { datasets: '01 Datasets', train: '02 Build & train', ask: '03 Ask' };
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => {
    const d = !!done[b.dataset.tab];
    b.dataset.done = String(d);
    b.setAttribute('aria-label', `${names[b.dataset.tab]}${d ? ', complete' : ''}`);
  });
  const onDisk = state.catalog.datasets.filter((d) => okFiles(d).length).length;
  $('#navSub1').textContent = `${onDisk} / ${state.catalog.datasets.length} on disk`;
  $('#navSub2').textContent = !state.index ? 'Not built' : state.stale ? 'Rebuild needed' : state.model ? 'Indexed & tuned' : 'Indexed · untrained';
  $('#navSub3').textContent = state.index ? 'Grounded Q&A' : 'Build first';
}

function applyTheme(theme, save = false) {
  document.documentElement.dataset.theme = theme;
  $('#themeBtn').setAttribute('aria-pressed', String(theme === 'dark'));
  $('#themeLbl').textContent = theme === 'dark' ? 'Editorial Light' : 'PRISM Dark';
  $('#themeIcon').textContent = theme === 'dark' ? '◑' : '◐';
  nebula?.setTheme(theme);
  if (save) { try { localStorage.setItem('universe-theme', theme); } catch {} }
}

// ---------------------------------------------------------------- ask

function datasetLines() {
  return state.catalog.datasets.filter((d) => datasetDocCount(d.id)).map((d) => {
    const ids = state.series.filter((s) => s.dataset === d.id).slice(0, 8).map((s) => s.id);
    return `- ${d.id}: ${d.name} (${datasetDocCount(d.id)} documents${ids.length ? `; series ids: ${ids.join(', ')}` : ''})`;
  }).join('\n');
}

function renderAskMode() {
  const s = state.status.settings, engine = currentEngine();
  $('#modeBadge').textContent = engine === 'open' ? `Open model · ${llmLabel(s)}` : engine === 'claude' ? `Claude agent · ${s.model}` : 'Ranked search only';
  $('#modeBadge').dataset.mode = engine === 'search' ? 'search' : 'agent';
  $('#useAgentWrap').classList.toggle('hidden', !(llmReady(s) || s.apiKeySet));
  if (state.concl.status !== 'writing') renderConclusionWin();
  $('#askBtn').disabled = !state.index;
  $('#askStatus').textContent = state.index ? `${state.docs.length.toLocaleString()} docs · ${state.model ? 'trained' : 'untrained'}` : 'Not built';
  $('#askHint').textContent = state.index ? `${state.docs.length.toLocaleString()} documents searchable${state.model ? ' · trained ranking' : ' · untrained ranking'}` : 'Download datasets and build the universe first (Build & train tab).';
  $('#datasetSel').innerHTML = '<option value="">All datasets</option>' + state.catalog.datasets.filter((d) => datasetDocCount(d.id)).map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
}

async function callClaude(body) {
  const r = await api('/api/claude', body);
  if (!r.ok) {
    const msg = r.json?.error?.message || r.json?.raw || `HTTP ${r.status}`;
    const err = new Error(msg); err.status = r.status; throw err;
  }
  return r.json;
}

async function agentAnswer(question, dataset, progress) {
  const ctx = { index: state.index, series: state.series, params: state.params, datasets: datasetLines() };
  const seen = new Set(), tools = [];
  const first = search(state.index, question, state.params, { k: 8, dataset });
  first.forEach((h) => seen.add(h.chunk.id));
  const model = state.status.settings.model || 'claude-opus-5-5';
  const messages = [{ role: 'user', content: `Question: ${question}${dataset ? `\n(Restrict to dataset: ${dataset})` : ''}\n\nInitial search results from the universe:\n\n${formatHits(first) || 'none'}` }];
  let useFormat = true;
  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    if (state.abort?.signal.aborted) throw new Error('Stopped.');
    progress(turn ? `Agent step ${turn + 1}…` : 'Asking Claude…');
    // A conclusion drawn across many entries is reasoning-heavy work, so run at high effort.
    const body = { model, max_tokens: 16000, system: systemPrompt(ctx.datasets), tools: AGENT_TOOLS, messages, output_config: { effort: 'high' } };
    if (useFormat) body.output_config.format = { type: 'json_schema', schema: ANSWER_SCHEMA };
    if (!model.startsWith('claude-haiku')) body.fallbacks = 'default';
    let resp;
    try { resp = await callClaude(body); }
    catch (e) {
      if (useFormat && e.status === 400 && /format|output_config|schema/i.test(e.message)) { useFormat = false; turn--; continue; }
      throw e;
    }
    if (resp.stop_reason === 'refusal') throw new Error('Claude declined this request. Rephrase the question or use ranked search.');
    messages.push({ role: 'assistant', content: resp.content });
    const calls = resp.content.filter((b) => b.type === 'tool_use');
    if (resp.stop_reason === 'tool_use' && calls.length) {
      const results = calls.map((c) => {
        tools.push({ name: c.name, input: c.input });
        progress(c.name === 'search_universe' ? `Searching: “${c.input.query}”` : c.name === 'get_series' ? `Reading series ${c.input.series_id}` : 'Listing datasets');
        let out;
        try { out = runTool(ctx, c.name, c.input || {}, seen); } catch (e) { return { type: 'tool_result', tool_use_id: c.id, content: String(e.message), is_error: true }; }
        return { type: 'tool_result', tool_use_id: c.id, content: out };
      });
      messages.push({ role: 'user', content: results });
      continue;
    }
    if (resp.stop_reason === 'max_tokens') throw new Error('The answer was cut off (max_tokens). Try a narrower question.');
    const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const raw = parseAnswer(text);
    if (!raw) throw new Error('Claude did not return the expected JSON answer.');
    const fallback = rankedOptions(state.index, question, state.params, { k: 6, dataset });
    return { ...finalizeOptions(raw, seen, state.index, fallback), tools, seen: [...seen], mode: 'agent', model: resp.model, usage: resp.usage };
  }
  throw new Error('The agent used too many steps without answering.');
}

const errMsg = (r) => r.json?.error?.message || r.json?.raw?.slice(0, 200) || `HTTP ${r.status}`;

/** Open model: gather the entries with the trained ranking, then one call writes a cited conclusion over all of them. */
async function openAnswer(a, progress, fresh = false) {
  const s = state.status.settings;
  const entries = gatherEntries(state.index, a.query, state.params, { k: 10, ...a.filt });
  const fallback = rankedOptions(state.index, a.query, state.params, { k: 5, ...a.filt });
  if (!entries.length) return { options: [], mode: 'search' };
  progress(`Reading ${entries.length} relevant entries with ${llmLabel(s)}…`);
  // Reasoning models (GPT-OSS) spend part of max_tokens thinking, so leave room for the JSON answer.
  const body = { model: s.llmModel, temperature: 0.2, max_tokens: 4000, response_format: { type: 'json_object' }, messages: conclusionMessages(a.prompt, entries) };
  // Pollinations caches identical requests, so Regenerate sends a new seed to get a new reply.
  if (fresh) body.seed = Math.floor(Math.random() * 1e9);
  let r = await api('/api/llm', body);
  if (!r.ok && r.status === 400 && /response_format|json/i.test(errMsg(r))) { delete body.response_format; r = await api('/api/llm', body); }
  // Free tiers rate-limit (Pollinations: one reply every 30 s per IP). Wait out the window, then retry.
  for (let tries = 0; !r.ok && (r.status === 402 || r.status === 429) && tries < 2; tries++) {
    for (let t = Number(/retry after (\d+)/i.exec(errMsg(r))?.[1] || 30) + 1; t > 0; t--) {
      if (state.abort?.signal.aborted) throw new Error('Stopped.');
      progress(`The free tier allows one reply every 30 seconds. Retrying in ${t}s…`);
      await sleep(1000);
    }
    progress(`Reading ${entries.length} relevant entries with ${llmLabel(s)}…`);
    r = await api('/api/llm', body);
  }
  if (state.abort?.signal.aborted) throw new Error('Stopped.');
  if (!r.ok) throw new Error(errMsg(r));
  if (r.json.choices?.[0]?.finish_reason === 'length' && !r.json.choices[0].message?.content) throw new Error('the model ran out of tokens before answering; try again or a narrower question');
  const raw = parseAnswer(r.json.choices?.[0]?.message?.content);
  if (!raw?.conclusion) throw new Error('the model did not return a conclusion');
  const out = finalizeOptions({ ...raw, conclusion: numbersToIds(raw.conclusion, entries), options: [] }, new Set(entries.map((h) => h.chunk.id)), state.index, fallback, Math.max(MIN_OPTIONS, fallback.length));
  const u = r.json.usage;
  return { ...out, reasoning: r.json.choices?.[0]?.message?.reasoning || '', mode: 'open', model: r.json.model || s.llmModel, entries: entries.length, usage: u && { input_tokens: u.prompt_tokens, output_tokens: u.completion_tokens } };
}

async function ask(e) {
  e?.preventDefault();
  const question = $('#askInput').value.trim();
  if (!question || !state.index) return;
  state.asked = true; renderNav();
  state.last = { question, ...startScope() };
  traceStart();
  if ($('#clarifyToggle').checked && renderClarify()) return;
  await answerNow();
}

const FACETS = { dataset: 'Source', focus: 'Measure', period: 'Period' };
const realScope = (v) => (v && v !== '*' ? v : '');

/** The scope before any clarifying answer: just the "Search in" dataset, if one is picked. */
function startScope() {
  const dataset = $('#datasetSel').value;
  return dataset ? { scope: { dataset }, labels: { dataset: state.catalog.datasets.find((d) => d.id === dataset)?.name || dataset }, preset: true } : { scope: {}, labels: {}, preset: false };
}

/** "Source: FOMC policy statements; Period: 2023" for the choices that narrow (not the "any" ones). */
const scopeText = () => Object.entries(state.last.labels).filter(([k]) => state.last.scope[k] !== '*').map(([k, l]) => `${FACETS[k]}: ${l}`).join('; ');

/** The question as it will be answered: the retrieval query with the chosen period, the filters, and the prompt for the model. */
function scopedAsk() {
  const { question, scope } = state.last, text = scopeText();
  return { question, query: scopedQuery(question, scope), filt: { dataset: realScope(scope.dataset), focus: realScope(scope.focus) }, prompt: text ? `${question}\n(Scope chosen by the analyst: ${text}.)` : question };
}

/** Shows the clarifying questions still worth asking for the current scope. Returns false when there is nothing to ask. */
function renderClarify() {
  const qs = clarifyQuestions(state.index, state.last.question, state.params, { scope: state.last.scope, datasetNames: Object.fromEntries(state.catalog.datasets.map((d) => [d.id, d.name])) });
  if (!qs.length) return false;
  const chosen = Object.entries(state.last.labels);
  $('#answers').innerHTML = `<form class="clarify" id="clarifyCard">
    <p class="eyebrow">Narrow it down · ${qs.length} quick question${qs.length > 1 ? 's' : ''}</p><h2>${esc(state.last.question)}</h2>
    <p class="muted">The best matches for this question are spread across ${qs.map((q) => ({ dataset: 'several sources', focus: 'several measures', period: 'several years' })[q.id]).join(', ').replace(/, ([^,]*)$/, ' and $1')}. Picking one gives a more precise answer from fewer, closer entries.</p>
    ${chosen.length ? `<p class="scope-line">${chosen.map(([k, l]) => `<span class="scope-chip">${FACETS[k]}: ${esc(l)} <button type="button" class="chip-x" data-unset="${k}" aria-label="Remove ${FACETS[k]}">×</button></span>`).join('')}</p>` : ''}
    ${qs.map((q) => `<fieldset class="clar-q"><legend>${esc(q.question)}</legend><div class="chips">
      ${q.options.map((o) => `<button type="button" class="chip" data-facet="${q.id}" data-value="${esc(o.value)}" data-label="${esc(o.label)}">${esc(o.label)}${o.share ? ` <span class="muted">${Math.round(o.share * 100)}%</span>` : ''}</button>`).join('')}
      <button type="button" class="chip any" data-facet="${q.id}" data-value="*" data-label="any">Any</button></div></fieldset>`).join('')}
    <div class="clar-actions"><button class="primary" type="submit">${chosen.length ? 'Answer with this scope' : 'Answer now'}</button><button class="text-btn plain" type="button" data-skip>Skip, answer as asked</button></div>
    <p class="muted small-text">Percentages are each choice's share of the top matches. Questions are built from your universe, so every choice has data behind it.</p>
  </form>`;
  setConcl({ status: 'clarifying' });
  traceUpdate({ stage: 2, choosing: true, sawCard: true, scopeText: scopeText() });
  return true;
}

function pickScope(facet, value, label) {
  if (value === undefined) { delete state.last.scope[facet]; delete state.last.labels[facet]; }
  else { state.last.scope[facet] = value; state.last.labels[facet] = label; }
  // Each answer narrows the search, so the remaining questions are rebuilt; when nothing is left to ask, answer.
  if (!renderClarify()) answerNow();
}

/** Ranked options for the scoped question at once; the conclusion window fills in when the model replies. */
async function answerNow() {
  const a = scopedAsk();
  const t0 = performance.now();
  const hits = gatherEntries(state.index, a.query, state.params, { k: 10, ...a.filt });
  const options = rankedOptions(state.index, a.query, state.params, { k: 5, ...a.filt });
  traceUpdate({ stage: 4, choosing: false, scopeText: scopeText(), picks: Object.keys(state.last.scope).length - (state.last.preset ? 1 : 0), clarifyOff: !$('#clarifyToggle').checked,
    query: a.query, params: { ...state.params }, trained: !!state.model, docsN: state.docs.length, entries: hits.map(entryOf), optionsN: options.length, searchMs: Math.round(performance.now() - t0),
    model: null, concl: null, error: null, reasoning: '', tools: [] });
  renderAnswers(a.question, { options, mode: 'search' });
  if (!options.length) { setConcl({ status: 'empty' }); return; }
  await writeConclusion();
}

/** Writes the conclusion for the last question into the conclusion window (also used by Regenerate and Retry). */
async function writeConclusion(fresh = false) {
  if (!state.last || state.concl.status === 'writing') return;
  const a = scopedAsk();
  const engine = currentEngine();
  if (engine === 'search') { setConcl({ status: 'off' }); return; }
  state.abort = new AbortController();
  $('#askBtn').disabled = true; $('#stopBtn').classList.remove('hidden');
  setConcl({ status: 'writing', engine, progress: 'Gathering the relevant entries…', started: Date.now() });
  const modelLabel = engine === 'open' ? llmLabel(state.status.settings).split(' · ')[0] : 'Claude agent';
  traceUpdate({ stage: 5, model: { status: 'writing', label: modelLabel }, concl: null, error: null, reasoning: '', tools: [] });
  const progress = (m) => { state.concl.progress = m; const p = $('#winProgress'); if (p) p.textContent = m; };
  const tick = setInterval(() => { const t = $('#winElapsed'); if (t) t.textContent = `${Math.round((Date.now() - state.concl.started) / 1000)}s`; }, 1000);
  try {
    const result = engine === 'open' ? await openAnswer(a, progress, fresh) : await agentAnswer(a.prompt, a.filt.dataset, progress);
    if (!result.conclusion?.parts?.length) throw new Error('no conclusion came back');
    renderAnswers(a.question, result);
    const seconds = Math.round((Date.now() - state.concl.started) / 1000), refs = result.conclusion.refs;
    setConcl({ status: 'done', engine, result, seconds });
    // The agent chooses its own searches, so its entries are the ones it saw; the open model reads the entries gathered above.
    traceUpdate({ stage: 6, model: { status: 'done', label: modelLabel }, concl: { confidence: result.confidence, refs, dropped: result.droppedCitations || 0, seconds }, reasoning: result.reasoning || '', tools: result.tools || [],
      ...(engine === 'claude' ? { entries: [...new Set([...refs, ...(result.seen || [])])].slice(0, 10).map(entryOfId).filter(Boolean) } : {}) });
  } catch (err) {
    setConcl({ status: 'error', engine, error: err.message });
    traceUpdate({ model: { status: 'error', label: modelLabel }, error: err.message });
  } finally { clearInterval(tick); $('#askBtn').disabled = false; $('#stopBtn').classList.add('hidden'); }
}

function setConcl(c) { state.concl = c; renderConclusionWin(); }

// ---------------------------------------------------------------- reasoning trace (the tree on the Ask tab)
// The tree records what the system did for one question: scope, search, the entries handed to the model, and which
// of them the conclusion cites. It is built from real values, never from guesses about the model's thinking.

const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

/** Word-wraps text into at most `maxLines` lines of about `n` characters, ending with an ellipsis when it was cut. */
function wrapText(s, n, maxLines) {
  const lines = [];
  let cur = '';
  for (const w of String(s ?? '').split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= n) { cur = next; continue; }
    if (cur) lines.push(cur);
    cur = clip(w, n);
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = `${lines[maxLines - 1].replace(/…$/, '').slice(0, n - 1)}…`; }
  return lines;
}

const entryOf = (h) => ({ id: h.chunk.id, title: h.doc.title, dataset: h.doc.dataset, date: h.doc.date || '', score: h.score });
function entryOfId(id) {
  const i = state.index.chunkById.get(id);
  if (i == null) return null;
  const d = state.index.docs.get(state.index.chunks[i].docId);
  return { id, title: d.title, dataset: d.dataset, date: d.date || '', score: null };
}

function traceStart() {
  state.trace = null; state.treeShown = new Set();
  traceUpdate({ question: state.last.question, stage: 1, entries: [], model: null, concl: null, error: null, reasoning: '', tools: [], sawCard: false, skipped: false, picks: 0, choosing: false, scopeText: '' });
}
function traceUpdate(patch) {
  state.trace = { ...(state.trace || { stage: 1, entries: [] }), ...patch };
  renderTree();
}

const clarifyText = (t) => (t.choosing ? 'awaiting your choices' : t.sawCard ? (t.skipped ? 'clarifying skipped' : t.picks ? `${t.picks} clarifying answer${t.picks > 1 ? 's' : ''}` : 'answered as asked') : t.clarifyOff ? 'clarifying off' : 'no clarifying needed');

const TREE_W = 1190, ROW = 44;

/** Lays the trace out left to right: question → scope → search → entries → model → conclusion, with the ranked options below. */
function buildTree(t) {
  const dsName = (id) => state.catalog.datasets.find((d) => d.id === id)?.name || id;
  const colour = new Map();
  t.entries.forEach((e) => { if (!colour.has(e.dataset)) colour.set(e.dataset, colour.size % 6); });
  const refN = new Map((t.concl?.refs || []).map((id, i) => [id, i + 1]));
  const n = t.entries.length, rows = t.stage >= 4 ? Math.max(n, 5) : 2, top = 22, listH = rows * ROW, mid = top + listH / 2, optY = top + listH + 16, H = optY + (t.stage >= 4 ? 62 : 4);
  const nodes = [], edges = [];
  const box = (o) => { o.h = o.h || 34 + o.lines.length * 13 + 8; o.y = o.y ?? mid - o.h / 2; nodes.push(o); return o; };
  const curve = (a, b) => { const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, dx = (x2 - x1) * .5; return `M${x1},${y1}C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`; };
  const link = (a, b, cls) => edges.push({ id: `${a.id}>${b.id}`, cls, d: curve(a, b) });

  const q = box({ id: 'q', k: 'q', x: 10, w: 150, title: 'Question', lines: wrapText(t.question, 24, 4), tip: t.question });
  let scope = null, ret = null, mod = null;
  const ents = [];
  if (t.stage >= 2) {
    scope = box({ id: 'scope', k: 'scope', x: 190, w: 150, title: 'Scope', lines: [...wrapText(t.scopeText || (t.choosing ? 'choosing…' : 'whole universe'), 24, 3), clarifyText(t)], cls: t.choosing ? 'active' : '', tip: `Scope: ${t.scopeText || 'whole universe'}` });
    link(q, scope, 'main');
  }
  if (t.stage >= 3) {
    const p = t.params || {};
    ret = box({ id: 'ret', k: 'retrieve', x: 370, w: 170, title: 'Search', lines: [t.trained ? 'trained BM25 ranking' : 'default BM25 ranking', `k1 ${p.k1} · b ${p.b}`, `title ${p.titleBoost} · year ${p.yearBoost}`, `${(t.docsN || 0).toLocaleString()} docs → ${n} entries`, `${t.searchMs} ms`], tip: `Search query: ${t.query}` });
    link(scope, ret, 'main');
  }
  if (t.stage >= 4) {
    t.entries.forEach((e, i) => {
      const ref = refN.get(e.id);
      const nd = box({ id: `e${i}`, k: 'entry', x: 585, w: 235, h: 36, y: top + i * ROW + (ROW - 36) / 2, lines: [], ent: e, i, stripe: colour.get(e.dataset), ref, cls: t.concl ? (ref ? 'cited' : 'skip') : '',
        tip: `${i + 1}. ${e.title} (${dsName(e.dataset)}${e.date ? `, ${e.date}` : ''})${ref ? `: cited as reference ${ref}` : t.concl ? ': read but not cited' : ''}` });
      ents.push(nd); link(ret, nd, 'out');
    });
    const opt = { id: 'opt', k: 'options', x: 585, w: 595, y: optY, h: 50, title: `${t.optionsN} ranked option${t.optionsN === 1 ? '' : 's'}`, lines: ['most relevant first · at most 2 per measure · from the same search'], tip: 'The ranked options come straight from the search, not from the model.' };
    nodes.push(opt);
    edges.push({ id: 'ret>opt', cls: 'main', d: `M${ret.x + ret.w / 2},${ret.y + ret.h}V${optY + 25}H${opt.x}` });
  }
  if (t.stage >= 5 && t.model) {
    const m = t.model, cited = ents.filter((e) => e.ref).length;
    mod = box({ id: 'model', k: 'model', x: 860, w: 140, title: m.label, cls: m.status === 'writing' ? 'active' : m.status === 'error' ? 'err' : '',
      lines: m.status === 'error' ? wrapText(t.error || 'failed', 22, 3) : [m.status === 'writing' ? 'reading the entries…' : 'wrote the conclusion', t.tools?.length ? `${t.tools.length} tool calls` : `read ${n} entries`], tip: m.status === 'error' ? `Failed: ${t.error}` : m.label });
    ents.forEach((nd) => link(nd, mod, t.concl ? (nd.ref ? 'cited' : 'skip') : 'wait'));
    if (t.concl) {
      const c = box({ id: 'concl', k: 'concl', x: 1030, w: 150, title: 'Conclusion', lines: [`${t.concl.confidence} confidence`, `cites ${cited} of ${n} entries`, t.concl.dropped ? `${t.concl.dropped} citation${t.concl.dropped > 1 ? 's' : ''} dropped` : 'all citations valid', `${t.concl.seconds}s`], tip: 'The written conclusion. Entries joined by a solid line are the ones it cites.' });
      link(mod, c, 'main');
    }
  }
  return { nodes, edges, H, legend: [...colour].map(([id, i]) => ({ name: dsName(id), i })) };
}

function renderTree() {
  const card = $('#thinkCard'), svg = $('#thinkTree'), t = state.trace;
  if (!card) return;
  if (!t) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  const { nodes, edges, H, legend } = buildTree(t);
  const prev = state.treeShown, now = new Set();
  let order = 0;
  // Only items that were not on screen yet fade in, one after another, so the tree appears to grow as the answer is made.
  const intro = (id) => { now.add(id); return prev.has(id) ? { c: '', s: '' } : { c: ' enter', s: ` style="--d:${Math.min(order++ * .07, 1).toFixed(2)}s"` }; };
  const edgeSvg = edges.map((e) => { const i = intro(e.id); return `<path class="e ${e.cls}${i.c}"${i.s} d="${e.d}"/>`; }).join('');
  const nodeSvg = nodes.map((nd) => {
    const i = intro(nd.id);
    const attrs = `class="tn ${nd.cls || ''}${i.c}" data-k="${nd.k}"${nd.ref ? ` data-ref="${nd.ref}" tabindex="0" role="button" aria-label="Jump to reference ${nd.ref}"` : ''}${i.s}`;
    const rect = `<rect class="box" x="${nd.x}" y="${nd.y}" width="${nd.w}" height="${nd.h}" rx="${nd.k === 'entry' ? 8 : 10}"/>`;
    const body = nd.k === 'entry'
      ? `${rect}<rect class="c${nd.stripe}" x="${nd.x + 1}" y="${nd.y + 5}" width="4" height="${nd.h - 10}" rx="2"/>
         <text class="t" x="${nd.x + 14}" y="${nd.y + 15}">${esc(`${nd.i + 1}. ${clip(nd.ent.title, nd.ref ? 26 : 34)}`)}</text>
         <text class="s m" x="${nd.x + 14}" y="${nd.y + 28}">${esc(`${nd.ent.date || 'undated'}${nd.ent.score != null ? ` · score ${nd.ent.score.toFixed(1)}` : ''}`)}</text>
         ${nd.ref ? `<text class="b" x="${nd.x + nd.w - 10}" y="${nd.y + 15}" text-anchor="end">✓ [${nd.ref}]</text>` : ''}`
      : `${rect}<text class="t" x="${nd.x + 12}" y="${nd.y + 20}">${esc(nd.title)}</text>${nd.lines.map((l, k) => `<text class="s" x="${nd.x + 12}" y="${nd.y + 38 + k * 13}">${esc(l)}</text>`).join('')}`;
    return `<g ${attrs}><title>${esc(nd.tip || nd.title)}</title>${body}</g>`;
  }).join('');
  state.treeShown = now;
  svg.setAttribute('viewBox', `0 0 ${TREE_W} ${H}`);
  svg.innerHTML = edgeSvg + nodeSvg;
  $('#thinkLegend').innerHTML = legend.map((l) => `<span><i class="c${l.i}"></i>${esc(clip(l.name, 40))}</span>`).join('') + (t.concl ? '<span>solid line = cited · dashed = read, not cited</span>' : '');

  // The same trace as plain text, for screen readers and for the AI log.
  const p = t.params || {}, n = t.entries.length, cited = t.concl ? t.concl.refs.length : 0, steps = [`Question: ${t.question}`];
  if (t.stage >= 2) steps.push(`Scope: ${t.scopeText || 'whole universe'} (${clarifyText(t)}).`);
  if (t.stage >= 3) steps.push(`Search: ${t.trained ? 'trained' : 'default'} BM25 (k1 ${p.k1}, b ${p.b}, title boost ${p.titleBoost}, year boost ${p.yearBoost}) over ${(t.docsN || 0).toLocaleString()} documents found ${n} entries in ${t.searchMs} ms.`);
  if (t.stage >= 4) steps.push(n ? `Evidence handed to the model: ${t.entries.map((e, i) => `${i + 1}. ${e.title}`).join('; ')}.` : 'Nothing in the universe matched.');
  if (t.model) steps.push(t.model.status === 'error' ? `${t.model.label} failed: ${t.error}.` : `${t.model.label} ${t.model.status === 'writing' ? 'is reading the entries' : 'wrote the conclusion'}${t.tools?.length ? ` using ${t.tools.length} tool calls` : ''}.`);
  if (t.concl) steps.push(`Conclusion: ${t.concl.confidence} confidence, cites ${cited} of ${n} entries${t.concl.dropped ? `, ${t.concl.dropped} invalid citation${t.concl.dropped > 1 ? 's' : ''} dropped` : ''}.`);
  if (t.stage >= 4) steps.push(`${t.optionsN} ranked options shown, most relevant first, from the same search.`);
  $('#thinkList').innerHTML = steps.map((s) => `<li>${esc(s)}</li>`).join('');
  $('#thinkRaw').classList.toggle('hidden', !t.reasoning);
  $('#thinkRawText').textContent = clip(t.reasoning, 4000);
}

function jumpToRef(n) {
  const t = document.querySelector(`#ref-${n}`);
  if (!t) return;
  const d = t.closest('details');
  if (d) d.open = true;
  t.scrollIntoView({ block: 'center', behavior: 'smooth' });
  t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1400);
}

/** Plain-text conclusion with numbered references, for the Copy button. */
function conclusionText(r) {
  const body = r.conclusion.parts.map((p) => (p.ref ? `[${p.ref}]` : p.text)).join('');
  const refs = r.conclusion.refs.map((id, i) => {
    const c = state.index.chunks[state.index.chunkById.get(id)], d = c && state.index.docs.get(c.docId);
    return `[${i + 1}] ${d ? `${d.title} (${d.date || 'undated'})` : id}`;
  });
  return `${state.last.question}${scopeText() ? `\nScope: ${scopeText()}` : ''}\n\nConclusion (${r.confidence} confidence, ${r.model}):\n${body}\n\nReferences:\n${refs.join('\n')}`;
}

function passageHtml(id) {
  const i = state.index.chunkById.get(id);
  if (i == null) return '';
  const c = state.index.chunks[i], d = state.index.docs.get(c.docId);
  return `<div class="passage"><div class="muted"><code>${esc(id)}</code> · ${esc(d.title)} · ${esc(d.date || 'undated')}${d.url ? ` · <a href="${esc(d.url)}" target="_blank">local file</a>` : ''}${d.source ? ` · <a href="${esc(d.source)}" target="_blank" rel="noopener">original</a>` : ''}</div><p>${esc(c.text)}</p></div>`;
}

function sparkline(docId) {
  const d = state.index.docs.get(docId);
  if (!d?.seriesId) return '';
  const s = state.series.find((x) => x.id === d.seriesId);
  if (!s) return '';
  const pts = d.year ? s.points.filter((p) => p[0].startsWith(String(d.year))) : s.points;
  if (pts.length < 3) return '';
  const step = Math.ceil(pts.length / 240), sample = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const ys = sample.map((p) => p[1]), lo = Math.min(...ys), hi = Math.max(...ys), w = 260, h = 46;
  const path = sample.map((p, i) => `${i ? 'L' : 'M'}${((i / (sample.length - 1)) * w).toFixed(1)},${(h - 3 - ((p[1] - lo) / (hi - lo || 1)) * (h - 6)).toFixed(1)}`).join('');
  return `<figure class="spark"><svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(s.title)} from ${sample[0][0]} to ${sample[sample.length - 1][0]}"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><figcaption>${esc(sample[0][0])} → ${esc(sample[sample.length - 1][0])} · range ${fmt(lo)} to ${fmt(hi)} ${esc(s.units || '')}</figcaption></figure>`;
}

/** The conclusion window beside the options: idle, writing, done, or error. */
function renderConclusionWin() {
  const el = $('#conclusionWin');
  if (!el || !state.status) return;
  const s = state.status.settings, c = state.concl;
  const engine = c.engine || currentEngine();
  const who = engine === 'open' ? `${esc(llmLabel(s))} · free open-weight model` : engine === 'claude' ? `Claude agent · ${esc(s.model)}` : 'No model';
  const head = (extra = '') => `<div class="concl-top"><h3>Conclusion</h3>${extra}</div><div class="win-meta"><span>${who}</span></div>`;
  if (c.status === 'writing') {
    el.innerHTML = `<div class="conclusion">${head()}<div class="writing"><span class="dot" aria-hidden="true"></span><span id="winProgress">${esc(c.progress)}</span><span class="muted" id="winElapsed">0s</span></div>
      <p class="muted small-text">The ranked options are already on the left. The conclusion reads the most relevant entries and cites them by number.</p></div>`;
    return;
  }
  if (c.status === 'clarifying') {
    el.innerHTML = `<div class="conclusion pending">${head()}<p>Waiting for your answers on the left. Once the scope is set, the conclusion is written here from the entries inside that scope only.</p></div>`;
    return;
  }
  if (c.status === 'error') {
    el.innerHTML = `<div class="conclusion error">${head()}<p>No conclusion this time: ${esc(c.error)}.</p>
      <p class="muted small-text">The ranked options on the left are unaffected.</p><div class="win-actions"><button class="secondary small" type="button" data-win="retry">Try again</button></div></div>`;
    return;
  }
  if (c.status === 'done') {
    const r = c.result;
    const text = r.conclusion.parts.map((p) => (p.ref ? `<a class="ref" href="#ref-${p.ref}" title="${esc(p.id)}">${p.ref}</a>` : esc(p.text))).join('');
    el.innerHTML = `<div class="conclusion">${head(`<span class="conf" data-conf="${esc(r.confidence)}">${esc(r.confidence)} confidence</span>`)}
      <p>${text}</p>
      ${r.droppedCitations ? `<p class="warn-text">${r.droppedCitations} citation${r.droppedCitations > 1 ? 's' : ''} not found in the universe ${r.droppedCitations > 1 ? 'were' : 'was'} removed.</p>` : ''}
      ${r.conclusion.refs.length ? `<details open><summary>References (${r.conclusion.refs.length})</summary>${r.conclusion.refs.map((id, i) => `<div id="ref-${i + 1}"><b class="ref-n">${i + 1}</b>${passageHtml(id)}</div>`).join('')}</details>` : '<p class="warn-text">The conclusion has no valid citations: treat it as unverified.</p>'}
      <p class="muted small-text">${r.mode === 'open' ? `Written by ${esc(r.model)} from the ${r.entries} most relevant entries in your universe` : 'Written by Claude from the entries it found in your universe'} in ${c.seconds}s${r.usage ? ` · ${r.usage.input_tokens?.toLocaleString()} tokens in, ${r.usage.output_tokens?.toLocaleString()} out` : ''}. Not investment advice.</p>
      <div class="win-actions"><button class="secondary small" type="button" data-win="copy">Copy</button><button class="secondary small" type="button" data-win="retry">Regenerate</button><span class="muted small-text" id="winMsg" role="status"></span></div></div>`;
    return;
  }
  if (engine === 'search') {
    el.innerHTML = `<div class="conclusion pending"><h3>Conclusion</h3><p>${$('#useAgent').checked ? 'No model is set up to write conclusions. Under <b>Settings</b> on the Datasets tab, pick <b>Pollinations</b> (free, no key) or add a free Groq or OpenRouter key.' : 'Tick <b>write a conclusion</b> to have a model draw one conclusion from all the relevant entries.'} The ranked options still work without it.</p></div>`;
    return;
  }
  el.innerHTML = `<div class="conclusion pending">${head()}<p>${c.status === 'empty' ? 'Nothing in the universe matched, so there is nothing to conclude from.' : 'Ask a question. The model reads the most relevant entries in your universe and writes one conclusion here, citing each entry by number. It may use only those entries.'}</p>
    ${engine === 'open' && s.llmKeyless ? '<p class="muted small-text">Free tier: one conclusion every 30 seconds; extra requests wait automatically. Your question and up to 10 excerpts are sent to Pollinations.</p>' : ''}</div>`;
}

function renderAnswers(question, r) {
  const out = $('#answers');
  if (!r.options.length) { out.innerHTML = '<div class="empty-result"><h3>Nothing in the universe matches</h3><p>Try other words, a different dataset, or download more datasets.</p></div>'; return; }
  const few = r.options.length < MIN_OPTIONS;
  out.innerHTML = `
    <div class="answer-head"><span class="eyebrow">${r.options.length} options, most relevant first</span><h2>${esc(question)}</h2>
      <div class="badges"><span class="badge-mode" data-mode="${r.mode === 'search' ? 'search' : 'agent'}">${r.mode === 'agent' ? `Claude agent · ${esc(r.model || '')}` : r.mode === 'open' ? `Open model · ${esc(r.model || '')}` : 'Ranked search'}</span></div>
      <p class="scope-line">${scopeText() ? `Scope: <b>${esc(scopeText())}</b>` : 'Scope: whole universe'} <button class="text-btn plain" type="button" data-rescope>Change scope</button></p></div>
    ${few ? `<p class="note">Only ${r.options.length} matching source${r.options.length > 1 ? 's' : ''} found in the universe.</p>` : ''}
    <ol class="options">${r.options.map((o) => `
      <li class="option" data-status="${o.status || 'cited'}">
        <div class="rank">${o.rank}</div>
        <div class="opt-body">
          <div class="opt-top"><div class="rel"><span class="rel-bar"><i style="width:${o.relevance}%"></i></span><b>${o.relevance}</b><span class="muted">relevance</span></div>
            <span class="muted small-text">${esc(o.title || '')}${o.date ? ` · ${esc(o.date)}` : ''}</span></div>
          <p class="opt-answer">${esc(o.answer)}</p>
          ${o.why ? `<p class="muted why">${esc(o.why)}</p>` : ''}
          ${o.origin === 'search' && r.mode === 'agent' ? '<p class="muted small-text">Added from the search ranking so you always get at least 3 options.</p>' : ''}
          ${o.status === 'uncited' ? '<p class="warn-text">No valid citation: treat as unverified.</p>' : ''}
          ${sparkline(o.docId)}
          ${o.sources.length ? `<details><summary>Sources (${o.sources.length})</summary>${o.sources.map(passageHtml).join('')}</details>` : ''}
        </div>
      </li>`).join('')}</ol>
    ${r.coverage ? `<div class="gaps"><h3>What the universe doesn't cover</h3><p>${esc(r.coverage)}</p></div>` : ''}
    ${r.usage ? `<p class="muted small-text">Tokens: ${r.usage.input_tokens?.toLocaleString()} in · ${r.usage.output_tokens?.toLocaleString()} out (last step).</p>` : ''}`;
}

// ---------------------------------------------------------------- wiring

function setTab(tab) {
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.tab === tab)));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${tab}`));
  try { localStorage.setItem('universe-tab', tab); } catch {}
}

function renderAll() { renderDatasets(); renderSettings(); renderTrain(); renderAskMode(); renderNav(); }

async function init() {
  state.catalog = JSON.parse(await getText('catalog.json'));
  await refreshStatus();
  if (state.status.index['docs.json']) { try { await loadUniverse(); } catch (e) { console.error(e); } }
  renderAll();
  let tab = state.index ? 'ask' : 'datasets';
  try { tab = localStorage.getItem('universe-tab') || tab; } catch {}
  setTab(tab);
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  // Animated nebula behind the panels. It follows the system "reduce motion" setting unless the sidebar switch was used.
  let motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  try { const m = localStorage.getItem('universe-motion'); if (m === 'on' || m === 'off') motion = m === 'on'; } catch {}
  nebula = startNebula($('#nebula'), { theme: document.documentElement.dataset.theme || 'dark', motion });
  const applyMotion = (on, save = false) => {
    nebula.setMotion(on);
    $('#motionBtn').setAttribute('aria-pressed', String(on));
    $('#motionBtn').setAttribute('aria-label', on ? 'Turn the background animation off' : 'Turn the background animation on');
    $('#motionLbl').textContent = on ? 'Motion on' : 'Motion off';
    if (save) { try { localStorage.setItem('universe-motion', on ? 'on' : 'off'); } catch {} }
  };
  applyMotion(motion);
  $('#motionBtn').addEventListener('click', () => { motion = !motion; applyMotion(motion, true); });
  $('#thinkTree').addEventListener('click', (e) => { const g = e.target.closest('[data-ref]'); if (g) jumpToRef(g.dataset.ref); });
  $('#thinkTree').addEventListener('keydown', (e) => { const g = e.target.closest('[data-ref]'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); jumpToRef(g.dataset.ref); } });
  applyTheme(document.documentElement.dataset.theme || 'light');
  $('#themeBtn').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true));
  $('#trainResult').addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]'), row = e.target.closest('[data-row]');
    if (go) { setTab(go.dataset.go); window.scrollTo({ top: 0 }); return; }
    if (!row) return;
    const open = row.getAttribute('aria-expanded') !== 'true';
    row.setAttribute('aria-expanded', String(open));
    $(`#drill-${row.dataset.row}`).classList.toggle('hidden', !open);
    state.expanded[open ? 'add' : 'delete'](row.dataset.row);
  });
  $('#catalogFilter').addEventListener('input', renderDatasets);
  $('#catalog').addEventListener('click', (e) => { const b = e.target.closest('[data-download]'); if (b) download(b.dataset.download); });
  $('#downloadAll').addEventListener('click', downloadAll);
  $('#settingsForm').addEventListener('submit', (e) => { e.preventDefault(); saveSettings(); });
  $('#clearKey').addEventListener('click', () => saveSettings({ clearApiKey: true }));
  $('#clearLlmKey').addEventListener('click', () => saveSettings({ clearLlmKey: true }));
  $('#loadModels').addEventListener('click', loadModels);
  $('#llmPreset').addEventListener('change', () => {
    const p = OPEN_PRESETS[$('#llmPreset').value];
    if (p) { $('#llmBase').value = p.base; $('#llmModel').value = p.model; $('#llmModels').innerHTML = ''; $('#modelsMsg').textContent = ''; }
    $('#llmKeyLink').innerHTML = keyLinkHtml(p);
  });
  $('#buildBtn').addEventListener('click', buildUniverse);
  $('#trainBtn').addEventListener('click', runTraining);
  $('#askForm').addEventListener('submit', ask);
  $('#askInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ask(e); });
  $('#useAgent').addEventListener('change', renderAskMode);
  $('#stopBtn').addEventListener('click', () => state.abort?.abort());
  $('#answers').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-facet]'), x = e.target.closest('[data-unset]');
    if (chip) pickScope(chip.dataset.facet, chip.dataset.value, chip.dataset.label);
    else if (x) pickScope(x.dataset.unset);
    else if (e.target.closest('[data-skip]')) { Object.assign(state.last, startScope()); traceUpdate({ skipped: true }); answerNow(); }
    else if (e.target.closest('[data-rescope]') && state.concl.status !== 'writing') {
      Object.assign(state.last, startScope());
      if (!renderClarify()) $('#answers').insertAdjacentHTML('afterbegin', '<p class="note">This question is already specific: there is nothing to narrow.</p>');
    }
  });
  $('#answers').addEventListener('submit', (e) => { e.preventDefault(); answerNow(); });
  $('#conclusionWin').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-win]');
    if (!b) return;
    if (b.dataset.win === 'retry') { writeConclusion(state.concl.status === 'done'); return; }
    try { await navigator.clipboard.writeText(conclusionText(state.concl.result)); $('#winMsg').textContent = 'Copied.'; }
    catch { $('#winMsg').textContent = 'Copy blocked by the browser.'; }
  });
  $('#conclusionWin').addEventListener('click', (e) => {
    const a = e.target.closest('.ref');
    if (!a) return;
    e.preventDefault();
    const t = document.querySelector(a.getAttribute('href'));
    if (!t) return;
    t.closest('details').open = true;
    t.scrollIntoView({ block: 'center', behavior: 'smooth' });
    t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1400);
  });
  document.querySelectorAll('.example').forEach((b) => b.addEventListener('click', () => { $('#askInput').value = b.textContent; ask(); }));
}

init().catch((e) => { document.body.insertAdjacentHTML('afterbegin', `<p class="note">Could not start: ${esc(e.message)}. Is serve.ps1 running?</p>`); });
