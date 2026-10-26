import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fredSeries, vixSeries, famaFrenchSeries, shillerSeries, spfSeries, worldBankSeries, seriesDocs, panelDocs, holdingsDocs,
  buildUniverseIndex, search, rankedOptions, makeQuestionSet, split8020, train, finalizeOptions, runTool, parseAnswer, DEFAULT_PARAMS,
  gatherEntries, conclusionMessages, numbersToIds, clarifyQuestions, scopedQuery, evaluateClarify, RANKER_FEATURES
} from './universe-core.mjs';

test('fredSeries skips missing "." values and keeps dated numbers', () => {
  const s = fredSeries('observation_date,DGS10\n2020-01-02,1.88\n2020-01-03,.\n2020-01-06,1.81\n', { id: 'DGS10' });
  assert.deepEqual(s.points, [['2020-01-02', 1.88], ['2020-01-06', 1.81]]);
});

test('vixSeries converts MM/DD/YYYY and reads the close', () => {
  const s = vixSeries('DATE,OPEN,HIGH,LOW,CLOSE\n01/02/1990,17.24,17.24,17.24,17.24\n03/16/2020,57,83,57,82.69\n', { id: 'VIX' });
  assert.deepEqual(s.points[1], ['2020-03-16', 82.69]);
});

test('famaFrenchSeries reads the monthly block and stops before the annual one', () => {
  const txt = 'notes line\n\n,Mkt-RF,SMB,HML,RF\n192607,   2.89,  -2.42,  -2.75,   0.22\n192608,   2.64,  -1.44,   4.13,   0.25\n\n Annual Factors: January-December\n,Mkt-RF,SMB,HML,RF\n1927,  29.47, -2.04, -3.47, 3.12\n';
  const s = famaFrenchSeries(txt, { dataset: 'ff' });
  assert.equal(s.length, 4);
  assert.equal(s[0].id, 'FF:Mkt-RF');
  assert.deepEqual(s[2].points, [['1926-07', -2.75], ['1926-08', 4.13]]);
});

test('shillerSeries decodes decimal dates (1871.1 is October) and finds CAPE', () => {
  const rows = [['junk'], ['', 'Comp.', '', '', '', '', '', '', 'CAPE'], ['Date', 'P', 'D', 'E', 'CPI', 'Date Fraction', 'Rate GS10', 'Real Price', 'CAPE'], [1871.01, 4.44, 0.26, 0.4, 12.46, 1871.04, 5.32, 100, ''], [1881.1, 6.1, 0.3, 0.5, 10, 1881.8, 4, 120, 18.47]];
  const s = shillerSeries(rows, { dataset: 'shiller' });
  const cape = s.find((x) => x.id === 'SHILLER:CAPE');
  assert.deepEqual(cape.points, [['1881-10', 18.47]]);
  assert.deepEqual(s.find((x) => x.id === 'SHILLER:P').points[0], ['1871-01', 4.44]);
});

test('spfSeries picks the current-quarter and 4-quarters-ahead columns', () => {
  const rows = [['YEAR', 'QUARTER', 'UNEMP1', 'UNEMP2', 'UNEMP3', 'UNEMP4', 'UNEMP5', 'UNEMP6'], [2008, 4, 6, 6.5, 7, 7.3, 7.5, 7.6], [2009, 1, 6.9, '#N/A', 8, 8.2, 8.3, 8.4]];
  const s = spfSeries('UNEMP', rows, 'SPF unemployment', { dataset: 'spf' });
  assert.equal(s.length, 2);
  assert.deepEqual(s[0].points, [['2008-11', 6.5]]);
  assert.deepEqual(s[1].points.map((p) => p[0]), ['2008-11', '2009-02']);
});

test('worldBankSeries groups by country and panelDocs compares countries in a year', () => {
  const json = [{}, [
    { country: { id: 'IN', value: 'India' }, countryiso3code: 'IND', date: '2020', value: -5.8 },
    { country: { id: 'US', value: 'United States' }, countryiso3code: 'USA', date: '2020', value: -2.2 },
    { country: { id: 'IN', value: 'India' }, countryiso3code: 'IND', date: '2019', value: 3.9 },
    { country: { id: 'US', value: 'United States' }, countryiso3code: 'USA', date: '2021', value: null }
  ]];
  const s = worldBankSeries(json, { id: 'GDP', title: 'Real GDP growth', units: 'annual %' }, { dataset: 'wb' });
  assert.equal(s.length, 2);
  assert.deepEqual(s.find((x) => x.country === 'India').points, [['2019', 3.9], ['2020', -5.8]]);
  const d = panelDocs(s).find((x) => x.id === 'P:GDP:2020');
  assert.ok(d.text.includes('India -5.80') && d.text.includes('United States -2.20'), d.text);
});

test('seriesDocs writes a yearly fact sheet with direction and change', () => {
  const docs = seriesDocs({ id: 'FEDFUNDS', title: 'Federal funds effective rate', units: '%', freq: 'M', dataset: 'fred', points: [['2008-01-01', 3.94], ['2008-06-01', 2.0], ['2008-12-01', 0.16], ['2009-01-01', 0.15]] });
  assert.equal(docs[0].kind, 'series-summary');
  const y = docs.find((d) => d.id === 'S:FEDFUNDS:2008');
  assert.ok(/fell from 3\.94 % .* to 0\.16 %/.test(y.text), y.text);
  assert.ok(y.text.includes('-3.78'), y.text);
});

test('seriesDocs compounds monthly returns for return series', () => {
  const docs = seriesDocs({ id: 'FF:HML', title: 'Value factor', units: '% per month', freq: 'M', kind: 'return', points: [['2000-01', 10], ['2000-02', 10]] });
  assert.ok(docs[1].text.includes('cumulative 21%'), docs[1].text);
});

test('holdingsDocs lists new positions, exits and share changes', () => {
  const f = (d, h) => ({ manager: 'Test Capital', cik: '1', reportDate: d, filingDate: d, holdings: h });
  const docs = holdingsDocs([
    f('2026-03-31', [{ name: 'AAA CORP', cusip: 'A', value: 100, shares: 10 }, { name: 'BBB INC', cusip: 'B', value: 50, shares: 5 }]),
    f('2026-06-30', [{ name: 'AAA CORP', cusip: 'A', value: 200, shares: 20 }, { name: 'CCC LTD', cusip: 'C', value: 70, shares: 7 }])
  ]);
  const c = docs.find((d) => d.kind === 'holdings-change');
  assert.ok(c.text.includes('New positions: CCC LTD'), c.text);
  assert.ok(c.text.includes('Sold out completely: BBB INC'), c.text);
  assert.ok(c.text.includes('AAA CORP (+100% shares'), c.text);
});

test('holdingsDocs names the share class when one issuer has two classes', () => {
  const docs = holdingsDocs([{ manager: 'M', cik: '1', reportDate: '2026-06-30', filingDate: '2026-08-14', holdings: [
    { name: 'ALPHABET INC', cls: 'CAP STK CL A', cusip: 'X1', value: 10, shares: 1 }, { name: 'ALPHABET INC', cls: 'CAP STK CL C', cusip: 'X2', value: 5, shares: 1 }, { name: 'APPLE INC', cls: 'COM', cusip: 'X3', value: 1, shares: 1 }] }]);
  assert.ok(docs[0].text.includes('ALPHABET INC class A:') && docs[0].text.includes('ALPHABET INC class C:') && docs[0].text.includes('APPLE INC:'), docs[0].text);
});

function tinyUniverse() {
  const docs = [];
  for (const [id, title, base] of [['DGS10', '10-year Treasury yield', 2], ['UNRATE', 'US unemployment rate', 5], ['FEDFUNDS', 'Federal funds effective rate', 1]]) {
    const points = [];
    for (let y = 2000; y <= 2023; y++) for (const m of ['01', '06', '12']) points.push([`${y}-${m}-01`, base + ((y * 7 + Number(m)) % 5) / 2]);
    docs.push(...seriesDocs({ id, title, units: '%', freq: 'M', dataset: 'fred', points }));
  }
  docs.push({ id: 'T:letters:2008', dataset: 'letters', kind: 'text', title: 'Shareholder letter 2008', date: '2009-02', years: [2008, 2009], text: 'The financial panic deepened in the fall. We bought equities while others fled, and we kept ample liquidity.\n\nInsurance float grew and our railroad investment performed well.' });
  return buildUniverseIndex(docs);
}

test('search: the year boost puts the matching year first', () => {
  const index = tinyUniverse();
  const plainTop = search(index, 'unemployment rate 2015', DEFAULT_PARAMS, { k: 3 });
  const boosted = search(index, 'unemployment rate 2015', { ...DEFAULT_PARAMS, yearBoost: 2 }, { k: 3 });
  assert.equal(boosted[0].docId, 'S:UNRATE:2015');
  assert.ok(plainTop.length === 3);
});

test('FOMC press-office tail is cut, so its date does not outrank the statement', () => {
  const text = 'Inflation remains elevated. The Committee remains highly attentive to inflation risks.\n\nVoting for the monetary policy action were Jerome H. Powell, Chair.\nFor media inquiries, please email the press office.\nImplementation Note issued May 3, 2023';
  const index = buildUniverseIndex([{ id: 'T:fomc:2023-05-03', kind: 'text', dataset: 'fomc', title: 'FOMC statement, 2023-05-03', date: '2023-05-03', text }]);
  assert.ok(index.chunks.every((c) => !/media inquiries|Implementation Note/.test(c.text)));
  assert.ok(/Inflation remains elevated/.test(search(index, 'What did the FOMC say about inflation in 2023?', DEFAULT_PARAMS, { k: 1 })[0].chunk.text));
});

test('clarifyQuestions asks which measure for a broad question, and each answer narrows the search', () => {
  const index = tinyUniverse();
  const qs = clarifyQuestions(index, 'rate', DEFAULT_PARAMS);
  const focus = qs.find((q) => q.id === 'focus');
  assert.ok(focus && focus.options.some((o) => o.value === 'S:UNRATE') && focus.options.some((o) => o.value === 'S:FEDFUNDS'), JSON.stringify(qs));
  const scope = { focus: 'S:UNRATE', period: '2015' };
  assert.equal(scopedQuery('rate', scope), 'rate in 2015');
  const hits = search(index, scopedQuery('rate', scope), DEFAULT_PARAMS, { k: 5, focus: scope.focus });
  assert.ok(hits.length && hits.every((h) => h.doc.seriesId === 'UNRATE'));
  assert.equal(clarifyQuestions(index, 'rate', DEFAULT_PARAMS, { scope }).length, 0, 'nothing left to ask once measure and period are fixed');
});

test('clarifyQuestions skips questions that already name a year and a clear winner', () => {
  const index = tinyUniverse();
  assert.ok(!clarifyQuestions(index, 'unemployment rate 2015', DEFAULT_PARAMS).some((q) => q.id === 'period'));
  assert.deepEqual(clarifyQuestions(index, 'financial panic railroad float', DEFAULT_PARAMS), []);
});

test('evaluateClarify: an analyst who picks the matching choice never does worse', () => {
  const index = tinyUniverse();
  const items = [{ q: 'rate', gold: 'S:UNRATE:2015' }, { q: 'yield', gold: 'S:DGS10:2010' }];
  const r = evaluateClarify(index, items, DEFAULT_PARAMS);
  assert.ok(r.with.mrr >= r.without.mrr, JSON.stringify(r));
});

test('rankedOptions returns at least 3 options in descending relevance', () => {
  const index = tinyUniverse();
  const opts = rankedOptions(index, 'Treasury yield 2010', { ...DEFAULT_PARAMS, yearBoost: 2 }, { k: 5 });
  assert.ok(opts.length >= 3);
  for (let i = 1; i < opts.length; i++) assert.ok(opts[i - 1].relevance >= opts[i].relevance);
  assert.equal(opts[0].relevance, 100);
});

test('undated questions list a manager\'s 13F quarters latest first; dated ones keep the named quarter on top', () => {
  const f = (d, extra) => ({ manager: 'Test Capital', cik: '1', reportDate: d, filingDate: d, holdings: [{ name: 'AAA CORP', cusip: 'A', value: 100, shares: 10 }, ...extra] });
  // The oldest report mentions "largest" words more often, so plain BM25 would rank it first.
  const docs = holdingsDocs([f('2025-09-30', [{ name: 'LARGEST HOLDINGS FUND', cusip: 'L', value: 50, shares: 5 }]), f('2025-12-31', []), f('2026-03-31', []), f('2026-06-30', [])]);
  const index = buildUniverseIndex(docs);
  const undated = search(index, 'Test Capital largest holdings', DEFAULT_PARAMS, { k: 4 }).filter((h) => h.doc.kind === 'holdings').map((h) => h.doc.id);
  assert.deepEqual(undated, ['H:1:2026-06-30', 'H:1:2026-03-31', 'H:1:2025-12-31', 'H:1:2025-09-30']);
  const scores = search(index, 'Test Capital largest holdings', DEFAULT_PARAMS, { k: 4 }).map((h) => h.score);
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i - 1] >= scores[i]);
  const dated = search(index, 'Test Capital holdings 2025-09-30', { ...DEFAULT_PARAMS, yearBoost: 1 }, { k: 1 });
  assert.equal(dated[0].doc.year, 2025);
});

test('"recently" favors documents from the latest years', () => {
  const index = tinyUniverse();
  const top = search(index, 'What did the federal funds rate do recently?', DEFAULT_PARAMS, { k: 1 })[0];
  assert.equal(top.docId, 'S:FEDFUNDS:2023');
});

test('rankedOptions still finds 3+ options when one series dominates the matches', () => {
  const index = tinyUniverse();
  const opts = rankedOptions(index, 'unemployment rate', DEFAULT_PARAMS, { k: 5 });
  assert.ok(opts.filter((o) => o.docId.startsWith('S:UNRATE')).length <= 3);
  assert.ok(opts.length >= 3, JSON.stringify(opts.map((o) => o.docId)));
});

test('split8020 is reproducible and puts 80% in train', () => {
  const items = Array.from({ length: 50 }, (_, i) => i);
  const a = split8020(items, 7), b = split8020(items, 7);
  assert.equal(a.train.length, 40);
  assert.equal(a.test.length, 10);
  assert.deepEqual(a.test, b.test);
  assert.equal(new Set([...a.train, ...a.test]).size, 50);
});

test('train tunes on 80% and reports held-out 20% metrics', async () => {
  const index = tinyUniverse();
  const items = makeQuestionSet(index, { seed: 3, perKind: 60 });
  assert.ok(items.some((i) => i.kind === 'series-year') && items.some((i) => i.kind === 'text'));
  const r = await train(index, { seed: 3, perKind: 60, grid: { k1: [1.2], b: [0.75], titleBoost: [0, 1], yearBoost: [0, 2] } });
  assert.equal(r.sizes.train + r.sizes.test, r.sizes.total);
  assert.equal(r.sizes.train, Math.round(r.sizes.total * 0.8));
  assert.ok(r.metrics.test.tuned.mrr >= r.metrics.test.default.mrr, JSON.stringify(r.metrics.test));
});

const SMALL_NET = { maxEpochs: 60, checkEvery: 20, hidden: 4 };

test('neural re-ranker: trained on the 80% only, reproducible, and scored on the held-out 20%', async () => {
  const index = tinyUniverse();
  const opts = { seed: 3, perKind: 60, grid: { k1: [1.2], b: [0.75], titleBoost: [0], yearBoost: [0, 2] }, ranker: SMALL_NET };
  const a = await train(index, opts), b = await train(index, opts);
  assert.deepEqual(a.ranker.W1, b.ranker.W1);
  assert.equal(a.ranker.features.length, RANKER_FEATURES.length);
  assert.equal(a.ranker.trainedOn, a.sizes.train);
  assert.ok(a.ranker.epochs >= 20 && a.ranker.epochs <= 60);
  for (const k of ['hit1', 'hit3', 'mrr']) assert.ok(a.metrics.test.ml[k] >= 0 && a.metrics.test.ml[k] <= 1);
  assert.equal(a.metrics.test.ml.n, a.sizes.test);
});

test('rerankHits keeps the same documents, orders them by the model, and leaves clarifying questions alone', async () => {
  const index = tinyUniverse();
  const r = await train(index, { seed: 3, perKind: 60, grid: { k1: [1.2], b: [0.75], titleBoost: [0], yearBoost: [2] }, ranker: SMALL_NET });
  const params = { ...r.params, ranker: r.ranker };
  const plain = search(index, 'unemployment rate 2015', r.params, { k: 400 }).map((h) => h.docId).sort();
  const ranked = search(index, 'unemployment rate 2015', params, { k: 400 });
  assert.deepEqual(ranked.map((h) => h.docId).sort(), plain);
  const head = ranked.slice(0, r.ranker.candidates).map((h) => h.score);
  for (let i = 1; i < head.length; i++) assert.ok(head[i - 1] >= head[i]);
  assert.deepEqual(clarifyQuestions(index, 'rate', params), clarifyQuestions(index, 'rate', r.params));
  const opts = rankedOptions(index, 'unemployment rate 2015', params, { k: 5 });
  assert.ok(opts.length >= 3 && opts[0].relevance === 100);
});

test('finalizeOptions drops invented citations, sorts by relevance, pads to 3', () => {
  const index = tinyUniverse();
  const seen = new Set(['S:DGS10:2010#1', 'S:UNRATE:2010#1']);
  const fallback = rankedOptions(index, 'rates 2010', { ...DEFAULT_PARAMS, yearBoost: 2 }, { k: 5 });
  const out = finalizeOptions({ options: [
    { answer: 'Unemployment view', relevance: 60, why: '', sources: ['S:UNRATE:2010#1'] },
    { answer: 'Yield view', relevance: 90, why: '', sources: ['[S:DGS10:2010#1]', 'S:MADEUP#1'] }
  ], coverage_note: 'ok' }, seen, index, fallback);
  assert.equal(out.droppedCitations, 1);
  assert.equal(out.options[0].answer, 'Yield view');
  assert.ok(out.options.length >= 3);
  for (let i = 1; i < out.options.length; i++) assert.ok(out.options[i - 1].relevance >= out.options[i].relevance);
  assert.equal(out.options[2].origin, 'search');
});

test('finalizeOptions numbers the conclusion\'s citations and drops invented ones', () => {
  const index = tinyUniverse();
  const seen = new Set(['S:DGS10:2010#1', 'S:UNRATE:2010#1']);
  const out = finalizeOptions({ conclusion: 'Yields fell [S:DGS10:2010#1] while unemployment stayed high [S:UNRATE:2010#1, S:FAKE:1#1]. Again [S:DGS10:2010#1]. Note [sic].', confidence: 'medium',
    options: [{ answer: 'a', relevance: 90, why: '', sources: ['S:DGS10:2010#1'] }], coverage_note: '' }, seen, index, []);
  assert.deepEqual(out.conclusion.refs, ['S:DGS10:2010#1', 'S:UNRATE:2010#1']);
  assert.equal(out.conclusion.dropped, 1);
  assert.equal(out.droppedCitations, 1);
  assert.equal(out.confidence, 'medium');
  const rendered = out.conclusion.parts.map((p) => (p.ref ? `<${p.ref}>` : p.text)).join('');
  assert.equal(rendered, 'Yields fell<1> while unemployment stayed high<2>. Again<1>. Note [sic].');
});

test('an uncited conclusion is forced to low confidence, a cited one keeps the model\'s', () => {
  const index = tinyUniverse();
  const seen = new Set(['S:DGS10:2010#1']);
  const fallback = rankedOptions(index, 'yield 2010', DEFAULT_PARAMS, { k: 5 });
  const uncited = finalizeOptions({ conclusion: 'Yields fell a lot in 2010.', confidence: 'high', options: [] }, seen, index, fallback);
  assert.equal(uncited.confidence, 'low');
  const cited = finalizeOptions({ conclusion: 'Yields moved [S:DGS10:2010#1].', confidence: 'high', options: [] }, seen, index, fallback);
  assert.equal(cited.confidence, 'high');
});

test('open-model path: entries are numbered, [n] maps back to ids, bad numbers are dropped', () => {
  const index = tinyUniverse();
  const entries = gatherEntries(index, 'unemployment rate 2010 financial panic', { ...DEFAULT_PARAMS, yearBoost: 2 }, { k: 6 });
  assert.ok(entries.length >= 3 && entries.some((h) => h.doc.kind === 'text'), entries.map((h) => h.docId).join(','));
  const msgs = conclusionMessages('q?', entries);
  assert.ok(msgs[1].content.includes(`[1] ${entries[0].doc.title}`));
  const text = numbersToIds('Jobs were weak [1]. Panic [2, 3]. Bad [99].', entries);
  assert.ok(text.includes(`[${entries[0].chunk.id}]`) && text.includes(`[${entries[1].chunk.id}, ${entries[2].chunk.id}]`), text);
  const out = finalizeOptions({ conclusion: text, confidence: 'medium', options: [] }, new Set(entries.map((h) => h.chunk.id)), index, rankedOptions(index, 'unemployment rate 2010', DEFAULT_PARAMS, { k: 5 }));
  assert.equal(out.conclusion.refs.length, 3);
  assert.equal(out.conclusion.dropped, 1);
  assert.ok(out.options.length >= 3 && out.options[0].relevance === 100);
});

test('runTool get_series filters by date and registers its citation', () => {
  const index = tinyUniverse();
  const series = [{ id: 'DGS10', title: '10-year Treasury yield', units: '%', freq: 'M', points: [['2019-12-01', 1.9], ['2020-03-01', 0.7], ['2021-01-01', 1.1]] }];
  const seen = new Set();
  const out = runTool({ index, series, params: DEFAULT_PARAMS, datasets: '' }, 'get_series', { series_id: 'dgs10', start: '2020', end: '2020' }, seen);
  assert.ok(out.includes('2020-03-01 0.7') && !out.includes('2019-12-01'), out);
  assert.ok(seen.has('S:DGS10#1'));
});

test('parseAnswer tolerates code fences around the JSON', () => {
  assert.deepEqual(parseAnswer('```json\n{"options":[],"coverage_note":"x"}\n```'), { options: [], coverage_note: 'x' });
  assert.equal(parseAnswer('no json here'), null);
});
