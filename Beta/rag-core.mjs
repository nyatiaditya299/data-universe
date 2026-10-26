// Retrieval core for "Ask the archive": cleaning, chunking, BM25 search, prompt, and answer checks.
// Pure functions only (no DOM, no network) so they run the same in the page and in node:test.

export const STAGES = [
  { key: 'trigger', label: 'Trigger', hint: 'What happened that forced a view' },
  { key: 'facts', label: 'Facts on the table', hint: 'Observable data and actions' },
  { key: 'interpretation', label: 'Interpretation', hint: 'What the facts were taken to mean' },
  { key: 'expectations', label: 'Expectations & sentiment', hint: 'What was already feared or priced' },
  { key: 'alternatives', label: 'Alternatives weighed', hint: 'The competing reading that was considered' },
  { key: 'decision', label: 'Stated view', hint: 'The conclusion or action taken' },
  { key: 'falsifiers', label: 'Risks & falsifiers', hint: 'What would change the view' }
];
const STAGE_KEYS = new Set(STAGES.map((s) => s.key));

const STOP = new Set(('a an and are as at be been but by can could did do does for from had has have how i if in into is it its ' +
  'may more most not of on or our over so such than that the their them then there these they this to was we were what when ' +
  'where which while who why will with would you your about after also any before between both each just only other out own same ' +
  'some through under until up very via all no nor too s t').split(' '));

/** Lowercase word tokens without stopwords, with a light plural strip so "banks" matches "bank". */
export function tokenize(text) {
  return String(text).toLowerCase().replace(/[’']/g, '').match(/[a-z0-9][a-z0-9.%-]*[a-z0-9%]|[a-z0-9]/g)?.reduce((out, w) => {
    if (STOP.has(w) || (w.length < 2 && !/\d/.test(w))) return out;
    out.push(w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
    return out;
  }, []) ?? [];
}

const BOILERPLATE = /official websites use \.gov|\.gov website belongs|secure \.gov websites|safely connected to the \.gov|share sensitive information only|locked padlock|skip to main content|an official website of the united states|cookie|javascript (is )?(disabled|required)/i;

/** Strips markdown/HTML markup and menu lines (lines that are mostly links) from web snapshots. */
export function cleanText(raw) {
  const lines = String(raw).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, '’')
    .split(/\r?\n/);
  const kept = [];
  for (let line of lines) {
    const hadLinks = /\]\([^)]*\)/.test(line);
    const withoutLinks = line.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[[^\]]*\]\([^)]*\)/g, '').replace(/[*#>\-|_\\\s]+/g, ' ').trim();
    line = line.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\\([_|*#])/g, '$1').replace(/^[#>*\s-]+/, '').replace(/\*\*|__/g, '').trim();
    if (!line || /^(\.\.\.|x|`{3,}.*)$/i.test(line) || BOILERPLATE.test(line)) continue;
    if (hadLinks && withoutLinks.length < 25) continue; // navigation, menus, related-article lists
    if (/^https?:\/\/\S+$/.test(line)) continue;
    kept.push(line);
  }
  return kept.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** Splits at . ! ? followed by a capital or quote, but not after initials (U.S.), common abbreviations, or inside numbers. */
export function splitSentences(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  const out = [];
  let start = 0;
  for (const m of t.matchAll(/[.!?]+["”’)]?\s+(?=["“(]?[A-Z0-9])/g)) {
    const before = t.slice(start, m.index);
    if (/(\b[A-Z]|\b(?:Mr|Ms|Dr|No|Inc|Corp|Co|Jr|vs|St|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec))$/.test(before)) continue;
    out.push(t.slice(start, m.index + m[0].length).trim());
    start = m.index + m[0].length;
  }
  if (start < t.length) out.push(t.slice(start).trim());
  return out.filter(Boolean);
}

/** Packs paragraphs into chunks of about maxChars, splitting long paragraphs at sentence boundaries. */
export function chunkText(text, { maxChars = 900 } = {}) {
  const pieces = [];
  for (const para of String(text).split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean)) {
    if (para.length <= maxChars) { pieces.push(para); continue; }
    let buf = '';
    for (const s of splitSentences(para)) {
      if (buf && buf.length + s.length + 1 > maxChars) { pieces.push(buf); buf = ''; }
      buf = buf ? `${buf} ${s}` : s.slice(0, maxChars * 2);
    }
    if (buf) pieces.push(buf);
  }
  const chunks = [];
  let buf = '';
  for (const p of pieces) {
    if (buf && buf.length + p.length + 1 > maxChars) { chunks.push(buf); buf = ''; }
    buf = buf ? `${buf}\n${p}` : p;
  }
  if (buf) chunks.push(buf);
  return chunks.filter((c) => tokenize(c).length >= 4);
}

/** docs: [{id, title, date ('YYYY-MM-DD' or ''), kind, text, ...}] → BM25 index. */
export function buildIndex(docs, { maxChars = 900 } = {}) {
  const chunks = [];
  const df = new Map();
  const docMap = new Map();
  for (const doc of docs) {
    docMap.set(doc.id, doc);
    chunkText(cleanText(doc.text), { maxChars }).forEach((text, n) => {
      const tokens = tokenize(text);
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
      chunks.push({ id: `${doc.id}#${n + 1}`, docId: doc.id, n: n + 1, text, tf, len: tokens.length });
    });
  }
  const avgdl = chunks.reduce((s, c) => s + c.len, 0) / (chunks.length || 1);
  return { chunks, df, avgdl, docs: docMap };
}

export function chunkCount(index, docId) {
  return index.chunks.filter((c) => c.docId === docId).length;
}

/** True when a document may be used for an as-of question. Undated documents stay in and are labeled by the UI. */
export function availableAsOf(doc, asOf) {
  return !asOf || !doc?.date || doc.date <= asOf;
}

/** BM25 (k1 1.2, b 0.75). Returns the top k chunks with their document and the query terms they matched. */
export function search(index, query, { k = 6, asOf = '' } = {}) {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  const N = index.chunks.length;
  const scored = [];
  for (const c of index.chunks) {
    const doc = index.docs.get(c.docId);
    if (!availableAsOf(doc, asOf)) continue;
    let score = 0;
    const matched = [];
    for (const t of terms) {
      const f = c.tf.get(t);
      if (!f) continue;
      const n = index.df.get(t) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * (f * 2.2) / (f + 1.2 * (1 - 0.75 + 0.75 * c.len / index.avgdl));
      matched.push(t);
    }
    if (score > 0) scored.push({ chunk: c, doc, score, matched });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, k).map((h, i) => ({ ...h, label: `S${i + 1}` }));
}

/** The instruction sent to Claude: sources are labeled S1..Sk and every step must cite and quote them. */
export function buildFlowPrompt(question, hits, { asOf = '' } = {}) {
  const sources = hits.map((h) => `[${h.label}] "${h.doc.title}" | ${h.doc.kind || 'Document'} | ${h.doc.date || 'undated'}\n${h.chunk.text}`).join('\n\n');
  return `You reconstruct the thought process behind a past investment view for a training tool used by junior analysts.

QUESTION: ${question}
${asOf ? `AS-OF DATE: ${asOf}. Treat anything after this date as unknown.\n` : ''}
SOURCES (the only material you may use):
${sources}

Rebuild the reasoning as an ordered flow using these stage keys, in this order, skipping any stage the sources do not support:
${STAGES.map((s) => `- ${s.key}: ${s.hint}`).join('\n')}

Rules:
- Use only the sources above. Never add outside knowledge, later events, or market outcomes.
- Every step cites one or more source labels and includes "quote": an exact, word-for-word excerpt (8-30 words) copied from one cited source.
- "claim" paraphrases what the source shows in at most 40 words. Attribute views to the document's author (for example "the commentary argued"), never to unnamed executives.
- Public commentary is not evidence of internal decisions or trades. Say so in "gaps" when it matters.
- If the sources cannot answer the question, return an empty "steps" list and explain in "gaps".

Reply with only this JSON:
{"decision_point":"one sentence naming the moment and the question faced","steps":[{"stage":"trigger","claim":"...","quote":"...","sources":["S1"]}],"gaps":["what the sources do not show"],"confidence":"low|medium|high"}`;
}

const norm = (s) => String(s).toLowerCase().replace(/[“”"’'`]/g, '').replace(/[^a-z0-9%$.]+/g, ' ').trim();

/**
 * Checks a model's flow against the retrieved sources:
 * 1. citations must name retrieved labels (others are removed),
 * 2. the quote must appear word for word in a cited source,
 * 3. the claim's content words must overlap the cited text (lexical support).
 */
export function validateFlow(flow, hits) {
  const byLabel = new Map(hits.map((h) => [h.label, h]));
  let invalidCitations = 0;
  const steps = (Array.isArray(flow?.steps) ? flow.steps : []).filter((s) => s && STAGE_KEYS.has(s.stage)).map((s) => {
    const cited = (Array.isArray(s.sources) ? s.sources : []).map(String);
    const valid = cited.filter((l) => byLabel.has(l));
    invalidCitations += cited.length - valid.length;
    const sourceText = valid.map((l) => byLabel.get(l).chunk.text).join(' ');
    const quote = String(s.quote || '').trim();
    const quoteVerified = quote.split(/\s+/).length >= 4 && norm(sourceText).includes(norm(quote));
    const claimTokens = [...new Set(tokenize(s.claim))];
    const sourceTokens = new Set(tokenize(sourceText));
    const support = claimTokens.length ? claimTokens.filter((t) => sourceTokens.has(t)).length / claimTokens.length : 0;
    // A quote that is not in the cited passage is a fabrication signal, so it caps the step at "weak".
    const status = !valid.length ? 'unsupported'
      : quoteVerified && support >= 0.3 ? 'verified'
      : support >= 0.45 && !quote ? 'supported'
      : support >= 0.25 ? 'weak' : 'unsupported';
    return { stage: s.stage, claim: String(s.claim || ''), quote, sources: valid, quoteVerified, support: Math.round(support * 100) / 100, status };
  });
  const count = (st) => steps.filter((s) => s.status === st).length;
  return {
    decisionPoint: String(flow?.decision_point || ''),
    gaps: (Array.isArray(flow?.gaps) ? flow.gaps : []).map(String).filter(Boolean),
    confidence: ['low', 'medium', 'high'].includes(flow?.confidence) ? flow.confidence : 'low',
    steps,
    summary: { total: steps.length, verified: count('verified'), supported: count('supported'), weak: count('weak'), unsupported: count('unsupported'), invalidCitations }
  };
}

const CUES = {
  trigger: /\b(fail(ed|ure)?|collaps|shock|announc|released?|sell-?off|spook|plung|crisis|lockdown|pandemic|surg|closed|emergency)/i,
  facts: /(\d[\d,.]*\s?(%|percent|billion|million)|\b(rose|fell|increased|decreased|index|reported|seasonally|annual))/i,
  interpretation: /\b(suggest|means|because|indicat|our research|in our view|we think|reflects?|shows?|healthy|healthier|judged|concluded|assessed|concentrated)/i,
  expectations: /\b(expect|priced|sentiment|consensus|surpris|anticipat|fear|angst|worr|perceiv|talk of)/i,
  alternatives: /\b(however|although|contagion|on the other hand|whether|but\b|despite|rather than)/i,
  decision: /\b(we believe|decided|should|recommend|remain|rebound|overweight|underweight|unchanged|maintain|keep|stay|designed to|will make available|protect)/i,
  falsifiers: /\b(if\b|unless|risk|uncertain|could|watch|depend)/i
};

/** No-model fallback: picks one quoted sentence per stage from the retrieved passages, by cue words and query overlap. */
export function extractiveFlow(question, hits) {
  const q = new Set(tokenize(question));
  const top = hits[0]?.score || 0;
  const pool = hits.filter((h) => h.score >= top * 0.35).flatMap((h, rank) => splitSentences(h.chunk.text).filter((s) => s.split(' ').length >= 6 && s.length <= 420).map((text) => ({ text, label: h.label, rank })));
  const used = new Set();
  const steps = [];
  for (const st of STAGES) {
    let best = null;
    for (const s of pool) {
      if (used.has(s.text) || !CUES[st.key].test(s.text)) continue;
      const overlap = tokenize(s.text).filter((t) => q.has(t)).length;
      if (!overlap && s.rank > 0) continue; // the best passage is relevant as a whole; others must share a word
      const score = overlap * 2 + 1 / (s.rank + 1);
      if (!best || score > best.score) best = { ...s, score };
    }
    if (!best) continue;
    used.add(best.text);
    steps.push({ stage: st.key, claim: best.text, quote: best.text, sources: [best.label] });
  }
  return {
    decision_point: question,
    steps,
    gaps: ['Extractive mode: sentences were matched to stages by keywords, not read by a language model. Treat the stage labels as a rough sort.'],
    confidence: 'low'
  };
}
