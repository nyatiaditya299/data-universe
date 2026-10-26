// "Ask the archive" view: document library with uploads, a query window, and the reconstructed decision flow.
// Generation uses Claude through the claude.ai artifact runtime when available; otherwise an extractive fallback.
import { STAGES, buildIndex, search, buildFlowPrompt, validateFlow, extractiveFlow, chunkCount, cleanText } from './rag-core.mjs';
import { STARTER_DOCS } from './corpus.js';

const MAX_CHARS = 120000; // one shared-library document must stay under the store's 256 KiB limit
const LOCAL_KEY = 'decisionReplayLibrary';
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const EXAMPLES = [
  { q: 'How did regulators respond when Silicon Valley Bank failed, and what were they trying to prevent?', asOf: '2023-03-16' },
  { q: 'What did the August 2022 CPI report show, and which numbers were new information?', asOf: '2022-09-13' },
  { q: 'How does Fisher describe moving from macro themes to security selection?', asOf: '' },
  { q: 'What emergency support did the CARES Act provide?', asOf: '2020-03-27' }
];

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stageLabel = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));

const state = {
  starter: STARTER_DOCS.map((d) => ({ ...d, origin: 'starter' })),
  shared: [],
  local: [],
  index: null,
  sample: null,
  db: null,
  user: null,
  engine: 'checking',
  controller: null,
  last: null
};

function allDocs() { return [...state.starter, ...state.shared, ...state.local]; }
function reindex() { state.index = buildIndex(allDocs()); }

// ---------- view switching ----------
function setMode(mode) {
  const ask = mode === 'ask';
  $('#replayView').classList.toggle('hidden', ask);
  $('#askView').classList.toggle('hidden', !ask);
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.mode === mode)));
}
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
  setMode(b.dataset.mode);
  try { history.replaceState(null, '', b.dataset.mode === 'ask' ? '#ask' : '#replay'); } catch {}
}));
if (location.hash === '#ask') setMode('ask');

// ---------- engine status ----------
function renderEngine() {
  const el = $('#engineStatus');
  const copy = {
    checking: ['pending', 'Connecting to Claude…', 'Checking whether this page can ask Claude.'],
    claude: ['on', 'Claude connected', 'Claude writes the flow from retrieved passages; every step is checked against them.'],
    extractive: ['off', 'Extractive mode', 'No language model is available here, so the flow quotes the best-matching sentences. Open the published claude.ai version to have Claude write it.']
  }[state.engine];
  el.dataset.state = copy[0];
  el.innerHTML = `<b>${esc(copy[1])}</b><span>${esc(copy[2])}</span>`;
}

// ---------- library ----------
function loadLocal() {
  try { state.local = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]').map((d) => ({ ...d, origin: 'local' })); } catch { state.local = []; }
}
function saveLocal() {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state.local.map(({ origin, ...d }) => d))); return true; } catch { return false; }
}

function renderLibrary() {
  const docs = allDocs();
  $('#libCount').textContent = `${docs.length} documents · ${state.index.chunks.length} passages`;
  $('#libStoreNote').textContent = state.db
    ? 'Uploads are shared with everyone who can open this page.'
    : 'Uploads stay in this browser only. In the published version they are shared with everyone who opens it.';
  const groups = [['shared', 'Shared uploads'], ['local', 'Your uploads (this browser)'], ['starter', 'Starter library']];
  $('#libList').innerHTML = groups.map(([origin, label]) => {
    const rows = docs.filter((d) => d.origin === origin);
    if (!rows.length) return origin === 'starter' ? '' : '';
    return `<li class="lib-group"><span class="eyebrow">${label}</span><ul>${rows.map((d) => `<li class="lib-doc">
      <div class="lib-doc-main"><strong>${esc(d.title)}</strong>
      <span class="lib-meta"><span class="kind-chip">${esc(d.kind || 'Document')}</span>${d.date ? esc(d.date) : 'Undated'} · ${chunkCount(state.index, d.id)} passages${d.truncated ? ' · truncated' : ''}</span></div>
      ${d.url ? `<a class="lib-link" href="${esc(d.url)}" target="_blank" rel="noopener" aria-label="Open original of ${esc(d.title)}">Original ↗</a>` : ''}
      ${origin !== 'starter' ? `<button class="text-button remove-doc" type="button" data-remove="${esc(d.id)}">Remove</button>` : ''}
    </li>`).join('')}</ul></li>`;
  }).join('');
}

$('#libList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  if (btn.dataset.confirm !== 'yes') { btn.dataset.confirm = 'yes'; btn.textContent = 'Confirm remove'; return; }
  const doc = allDocs().find((d) => d.id === btn.dataset.remove);
  if (!doc) return;
  btn.disabled = true;
  if (doc.origin === 'local') {
    state.local = state.local.filter((d) => d.id !== doc.id);
    saveLocal(); reindex(); renderLibrary();
  } else if (doc.origin === 'shared' && state.db) {
    try { await state.db.doc(`library/${doc.dbId}`).delete(); } catch (err) { setUploadStatus(dbErrorCopy(err), 'error'); btn.disabled = false; }
  }
});

// ---------- uploads ----------
function setUploadStatus(text, tone = '') { const el = $('#uploadStatus'); el.textContent = text; el.dataset.tone = tone; }

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(s);
  });
}
let pdfReady = null;
async function pdfText(file) {
  // Both scripts load as plain <script> tags; with pdfjsWorker defined, pdf.js parses on the main thread (no Worker needed).
  pdfReady ||= loadScript(PDFJS + 'pdf.min.js').then(() => loadScript(PDFJS + 'pdf.worker.min.js')).then(() => { globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; });
  await pdfReady;
  const pdf = await globalThis.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    let line = '', out = '';
    for (const item of content.items) { line += item.str; if (item.hasEOL) { out += line + '\n'; line = ''; } else line += ' '; }
    pages.push((out + line).replace(/[ \t]+/g, ' '));
    if (pages.join('\n').length > MAX_CHARS) break;
  }
  return { text: pages.join('\n\n') };
}

function htmlText(raw) {
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  doc.querySelectorAll('script,style,nav,header,footer,aside,form,noscript,svg').forEach((n) => n.remove());
  const root = doc.querySelector('article') || doc.querySelector('main') || doc.body;
  const blocks = [...root.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,td')].map((n) => n.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t.length > 1);
  const meta = (sel) => doc.querySelector(sel)?.getAttribute('content') || doc.querySelector(sel)?.getAttribute('datetime') || '';
  const date = (meta('meta[property="article:published_time"]') || meta('meta[name="date"]') || meta('time[datetime]')).slice(0, 10);
  return {
    text: blocks.length ? blocks.join('\n') : root.textContent,
    title: (doc.querySelector('h1')?.textContent || doc.title || '').replace(/\s+/g, ' ').trim(),
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    url: doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || ''
  };
}

async function readFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return pdfText(file);
  const raw = await file.text();
  if (/\.(html?|xhtml)$/.test(name)) return htmlText(raw);
  return { text: raw };
}

const fileInput = $('#docFile');
const drop = $('#dropZone');
let pendingFile = null;
function pickFile(file) {
  pendingFile = file || null;
  $('#dropName').textContent = file ? `${file.name} · ${(file.size / 1024).toFixed(0)} KB` : 'No file chosen';
  if (file && !$('#docTitle').value) $('#docTitle').value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  validateUpload();
}
fileInput.addEventListener('change', () => pickFile(fileInput.files[0]));
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) pickFile(e.dataTransfer.files[0]); });
$('#pasteToggle').addEventListener('click', () => {
  const box = $('#pasteBox');
  box.classList.toggle('hidden');
  $('#pasteToggle').textContent = box.classList.contains('hidden') ? 'Paste text instead' : 'Hide pasted text';
  validateUpload();
});
['#docPaste', '#docTitle'].forEach((s) => $(s).addEventListener('input', validateUpload));
function validateUpload() {
  const hasText = pendingFile || (!$('#pasteBox').classList.contains('hidden') && $('#docPaste').value.trim().length > 40);
  $('#addDoc').disabled = !(hasText && $('#docTitle').value.trim());
}

$('#uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#addDoc');
  btn.disabled = true;
  setUploadStatus('Reading document…');
  try {
    const pasted = !$('#pasteBox').classList.contains('hidden') && $('#docPaste').value.trim();
    const parsed = pendingFile ? await readFile(pendingFile) : { text: pasted };
    let text = cleanText(parsed.text || '');
    if (text.length < 80) throw new Error('No readable text found. Scanned PDFs and images need OCR first; try a text PDF, a saved web page, or paste the text.');
    const truncated = text.length > MAX_CHARS;
    if (truncated) text = text.slice(0, MAX_CHARS);
    const record = {
      title: $('#docTitle').value.trim() || parsed.title || 'Untitled document',
      date: $('#docDate').value || parsed.date || '',
      kind: $('#docKind').value,
      url: $('#docUrl').value.trim() || parsed.url || '',
      text, truncated, addedAt: new Date().toISOString()
    };
    if (state.db) {
      const uid = state.user ? await state.user.id().catch(() => null) : null;
      await state.db.collection('library').add({ ...record, addedBy: uid });
      setUploadStatus(`Added “${record.title}” to the shared library.`, 'ok');
    } else {
      state.local.push({ ...record, id: `local-${Date.now().toString(36)}`, origin: 'local' });
      const kept = saveLocal();
      reindex(); renderLibrary();
      setUploadStatus(kept ? `Added “${record.title}”.` : `Added “${record.title}” for this visit only; this browser would not store it.`, 'ok');
    }
    $('#uploadForm').reset(); $('#docPaste').value = ''; pickFile(null);
  } catch (err) {
    setUploadStatus(err?.code ? dbErrorCopy(err) : err.message, 'error');
  } finally { validateUpload(); }
});

function dbErrorCopy(err) {
  if (err?.code === 'invalid_argument') return 'You can read this library but not change it. Ask the page owner for Contributor access.';
  if (err?.code === 'quota_exceeded') return 'The shared library is full. Remove an older upload, then try again.';
  if (err?.code === 'resource_exhausted') return 'Too many changes at once. Wait a few seconds and try again.';
  return 'The shared library is unavailable right now. Try again in a moment.';
}

// ---------- asking ----------
$('#exampleList').innerHTML = EXAMPLES.map((ex, i) => `<button type="button" class="example" data-ex="${i}">${esc(ex.q)}</button>`).join('');
$('#exampleList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ex]');
  if (!b) return;
  const ex = EXAMPLES[Number(b.dataset.ex)];
  $('#askInput').value = ex.q; $('#asOf').value = ex.asOf;
  $('#askInput').focus();
});
$('#askInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#askForm').requestSubmit(); });
$('#stopBtn').addEventListener('click', () => state.controller?.abort());

$('#askForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const question = $('#askInput').value.trim();
  if (!question) { $('#askInput').focus(); return; }
  const asOf = $('#asOf').value;
  const hits = search(state.index, question, { k: Number($('#passageCount').value), asOf });
  if (!hits.length) {
    $('#askResult').innerHTML = `<div class="empty-result"><h3>No passages match that question</h3><p>Try other words, move the as-of date later, or add the documents that would answer it.</p></div>`;
    return;
  }
  let flow = null, mode = 'extractive', note = '';
  if (state.sample) {
    state.controller = new AbortController();
    setBusy(true);
    renderResult({ question, asOf, hits, pending: true });
    try {
      flow = await state.sample.json(buildFlowPrompt(question, hits, { asOf }), { signal: state.controller.signal });
      mode = 'claude';
    } catch (err) {
      if (err?.code === 'cancelled') { setBusy(false); renderResult({ question, asOf, hits, stopped: true }); return; }
      if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(err?.code)) {
        state.sample = null; state.engine = 'extractive'; renderEngine();
        note = 'Claude is not allowed on this page for you, so this flow uses extractive mode.';
      } else {
        note = { rate_limited: 'Claude is busy or your usage limit was reached.', invalid_json: 'Claude’s reply could not be read.', refused: 'Claude declined this request.', prompt_too_large: 'Too many passages for one request; choose fewer.' }[err?.code] || 'Claude could not answer just now.';
        note += ' Showing the extractive flow instead. You can ask again.';
      }
    } finally { setBusy(false); }
  }
  if (!flow) flow = extractiveFlow(question, hits);
  const result = validateFlow(flow, hits);
  state.last = { question, asOf, hits, result, mode, at: new Date().toISOString() };
  renderResult({ question, asOf, hits, result, mode, note });
});

function setBusy(busy) {
  $('#askBtn').disabled = busy;
  $('#askBtn').textContent = busy ? 'Tracing…' : 'Trace the thought process';
  $('#stopBtn').classList.toggle('hidden', !busy);
}

const STATUS_COPY = {
  verified: ['Quote verified', 'The quote appears word for word in the cited passage.'],
  supported: ['Supported', 'Most of the claim’s key terms appear in the cited passage. No quote was given to check.'],
  weak: ['Weak support', 'The quote is not in the cited passage, or few of the claim’s key terms appear there. Read the source before relying on it.'],
  unsupported: ['Unsupported', 'No valid citation, or the cited passage does not back the claim. Do not use this step.']
};

function highlight(text, terms) {
  let html = esc(text);
  for (const t of terms.filter((x) => x.length > 2).sort((a, b) => b.length - a.length)) {
    html = html.replace(new RegExp(`\\b(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?)\\b`, 'gi'), '<mark>$1</mark>');
  }
  return html;
}

function renderSources(hits) {
  return `<section class="sources" aria-label="Retrieved passages"><div class="sources-head"><h3>Retrieved passages</h3><span class="hint">Ranked by BM25 keyword relevance${hits[0] ? '' : ''}. These are the only text the flow may use.</span></div><ol>${hits.map((h) => `<li id="src-${h.label}" class="source">
    <div class="source-top"><span class="src-label">${h.label}</span><strong>${esc(h.doc.title)}</strong></div>
    <div class="lib-meta"><span class="kind-chip">${esc(h.doc.kind || 'Document')}</span>${h.doc.date ? esc(h.doc.date) : 'Undated'} · passage ${h.chunk.n} · score ${h.score.toFixed(1)}${h.doc.url ? ` · <a href="${esc(h.doc.url)}" target="_blank" rel="noopener">original ↗</a>` : ''}</div>
    <p>${highlight(h.chunk.text, h.matched)}</p></li>`).join('')}</ol></section>`;
}

function renderResult({ question, asOf, hits, result, mode, note, pending, stopped }) {
  const head = `<div class="result-head"><span class="eyebrow">${asOf ? `Using documents dated on or before ${esc(asOf)}` : 'Using all documents'} · ${hits.length} passages</span>`;
  if (pending || stopped) {
    $('#askResult').innerHTML = `${head}<h2>${esc(question)}</h2></div><div class="thinking">${stopped ? 'Stopped. Nothing was generated.' : 'Claude is reading the passages and rebuilding the reasoning. This can take up to a minute.'}</div>${renderSources(hits)}`;
    return;
  }
  const s = result.summary;
  const flowHtml = result.steps.length ? `<ol class="flow">${result.steps.map((st, i) => `<li class="flow-step" data-status="${st.status}">
      <div class="flow-node" aria-hidden="true">${i + 1}</div>
      <div class="flow-card">
        <div class="flow-top"><span class="stage">${esc(stageLabel[st.stage])}</span>${mode === 'claude' ? `<span class="status" title="${esc(STATUS_COPY[st.status][1])}">${STATUS_COPY[st.status][0]}</span>` : '<span class="status">Direct quote</span>'}</div>
        ${mode === 'claude' ? `<p class="claim">${esc(st.claim)}</p>` : ''}
        ${st.quote ? `<blockquote class="${st.quoteVerified ? 'ok' : 'miss'}">“${esc(st.quote)}”</blockquote>` : ''}
        <div class="cites">${st.sources.length ? st.sources.map((l) => `<a class="cite" href="#src-${l}" data-cite="${l}">${l}</a>`).join('') : '<span class="hint">No valid source</span>'}${mode === 'claude' && !st.quoteVerified && st.quote ? '<span class="hint">Quote not found word for word in the cited passage</span>' : ''}</div>
      </div></li>`).join('')}</ol>`
    : `<div class="empty-result"><h3>The passages do not show a reasoning chain for this question</h3><p>See the gaps below, or add documents that record the decision.</p></div>`;
  $('#askResult').innerHTML = `${head}<h2>${esc(result.decisionPoint || question)}</h2>
    <div class="badges"><span class="badge-mode" data-mode="${mode}">${mode === 'claude' ? 'Written by Claude' : 'Extractive · no model'}</span>
    ${mode !== 'claude' ? `<span class="check-summary"><b>${s.total}</b> steps quoted directly from the passages</span>` : `<span class="check-summary"><b>${s.verified}</b> verified · <b>${s.supported}</b> supported · <b>${s.weak}</b> weak · <b>${s.unsupported}</b> unsupported${s.invalidCitations ? ` · ${s.invalidCitations} invalid citation${s.invalidCitations === 1 ? '' : 's'} removed` : ''}</span>`}
    ${mode === 'claude' ? `<span class="hint">Confidence: ${esc(result.confidence)}</span>` : ''}</div></div>
    ${note ? `<div class="notice">${esc(note)}</div>` : ''}
    ${flowHtml}
    ${result.gaps.length ? `<div class="gaps"><h3>What the sources do not show</h3><ul>${result.gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div>` : ''}
    <div class="log-row"><button class="secondary" type="button" id="copyLog">Copy check record for the AI log</button><span class="hint" id="copyStatus"></span></div>
    ${renderSources(hits)}`;
}

$('#askResult').addEventListener('click', async (e) => {
  const cite = e.target.closest('[data-cite]');
  if (cite) {
    e.preventDefault();
    const el = document.getElementById(`src-${cite.dataset.cite}`);
    el?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    el?.classList.remove('flash'); void el?.offsetWidth; el?.classList.add('flash');
    return;
  }
  if (e.target.id === 'copyLog' && state.last) {
    const { question, asOf, hits, result, mode, at } = state.last;
    const record = {
      when: at, question, asOf: asOf || null, generator: mode === 'claude' ? 'Claude (claude.ai artifact runtime)' : 'extractive fallback (no model)',
      retrieval: 'BM25 over chunked documents', sources: hits.map((h) => `${h.label}: ${h.doc.title} (${h.doc.date || 'undated'}), passage ${h.chunk.n}`),
      checks: result.summary, steps: result.steps.map((s) => ({ stage: s.stage, status: s.status, quoteVerified: s.quoteVerified, support: s.support, sources: s.sources }))
    };
    const text = JSON.stringify(record, null, 2);
    try { await navigator.clipboard.writeText(text); $('#copyStatus').textContent = 'Copied.'; }
    catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text, className: 'copy-fallback' });
      e.target.after(ta); ta.select(); $('#copyStatus').textContent = 'Select-all is on; press Ctrl+C to copy.';
    }
  }
});

// ---------- start ----------
loadLocal();
reindex();
renderLibrary();
renderEngine();
validateUpload();

if (window.claude?.use) {
  window.claude.use('sample').then((s) => { state.sample = s; state.engine = s ? 'claude' : 'extractive'; renderEngine(); });
  window.claude.use('user').then((u) => { state.user = u; });
  window.claude.use('db').then((db) => {
    if (!db) return;
    state.db = db;
    db.collection('library').onSnapshot((snap) => {
      state.shared = snap.docs.map((d) => ({ ...d.data(), id: `shared-${d.id}`, dbId: d.id, origin: 'shared' }));
      reindex(); renderLibrary();
    }, () => { state.db = null; renderLibrary(); });
    renderLibrary();
  });
} else {
  state.engine = 'extractive';
  renderEngine();
}
