import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, cleanText, splitSentences, chunkText, buildIndex, search, availableAsOf, buildFlowPrompt, validateFlow, extractiveFlow } from './rag-core.mjs';

const DOCS = [
  { id: 'svb', title: 'FDIC closes Silicon Valley Bank', date: '2023-03-10', kind: 'Government release', text: 'Silicon Valley Bank, Santa Clara, California, was closed today by the California Department of Financial Protection and Innovation, which appointed the FDIC as receiver. To protect insured depositors, the FDIC created the Deposit Insurance National Bank of Santa Clara.' },
  { id: 'btfp', title: 'Fed announces Bank Term Funding Program', date: '2023-03-12', kind: 'Government release', text: 'The Federal Reserve Board announced it will make available additional funding to eligible depository institutions to help assure banks have the ability to meet the needs of all their depositors.' },
  { id: 'memo', title: 'Undated process note', date: '', kind: 'Firm process', text: 'Our top-down process begins with macroeconomic analysis of economic, political and sentiment drivers before selecting securities.' }
];

test('tokenize drops stopwords and folds simple plurals', () => {
  assert.deepEqual(tokenize('The banks and the depositors'), ['bank', 'depositor']);
  assert.deepEqual(tokenize('CPI rose 8.3% in August'), ['cpi', 'rose', '8.3%', 'august']);
});

test('cleanText removes menu lines and .gov banners but keeps prose links as text', () => {
  const raw = '* [Careers](https://x.com/careers)\nOfficial websites use .gov\nThe [FDIC](https://fdic.gov) was appointed receiver of the bank today.';
  assert.equal(cleanText(raw), 'The FDIC was appointed receiver of the bank today.');
});

test('splitSentences keeps initials and decimals inside a sentence', () => {
  assert.deepEqual(splitSentences('The U.S. index rose 8.3 percent. Core rose 6.3 percent.'), ['The U.S. index rose 8.3 percent.', 'Core rose 6.3 percent.']);
});

test('chunkText packs paragraphs under the size limit', () => {
  const chunks = chunkText(Array.from({ length: 6 }, (_, i) => `Paragraph ${i} talks about bank deposits and funding stress in detail.`).join('\n\n'), { maxChars: 150 });
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((c) => c.length <= 150));
});

test('search ranks the relevant document first and labels hits S1..Sk', () => {
  const hits = search(buildIndex(DOCS), 'who protected insured depositors at Silicon Valley Bank');
  assert.equal(hits[0].doc.id, 'svb');
  assert.deepEqual(hits.map((h) => h.label), hits.map((_, i) => `S${i + 1}`));
});

test('as-of date excludes later documents but keeps undated ones', () => {
  const index = buildIndex(DOCS);
  const ids = search(index, 'depositors funding macroeconomic', { asOf: '2023-03-11' }).map((h) => h.doc.id);
  assert.ok(ids.includes('svb') && ids.includes('memo'));
  assert.ok(!ids.includes('btfp'));
  assert.equal(availableAsOf({ date: '2023-03-12' }, '2023-03-12'), true);
});

test('prompt lists every retrieved passage with its label and the as-of date', () => {
  const hits = search(buildIndex(DOCS), 'depositors');
  const prompt = buildFlowPrompt('How were depositors protected?', hits, { asOf: '2023-03-12' });
  for (const h of hits) assert.ok(prompt.includes(`[${h.label}]`));
  assert.ok(prompt.includes('AS-OF DATE: 2023-03-12'));
});

test('validateFlow verifies exact quotes and rejects invented citations and quotes', () => {
  const hits = search(buildIndex(DOCS), 'insured depositors Silicon Valley Bank FDIC');
  const svb = hits.find((h) => h.doc.id === 'svb').label;
  const result = validateFlow({
    decision_point: 'SVB closure',
    steps: [
      { stage: 'trigger', claim: 'California closed Silicon Valley Bank and appointed the FDIC as receiver.', quote: 'was closed today by the California Department of Financial Protection and Innovation', sources: [svb] },
      { stage: 'decision', claim: 'The FDIC created a new bank to protect insured depositors.', quote: 'the FDIC promised to buy every regional bank in America', sources: [svb] },
      { stage: 'interpretation', claim: 'Executives privately expected a rapid rebound.', quote: 'executives expected a rebound', sources: ['S9'] },
      { stage: 'not-a-stage', claim: 'ignored', sources: [svb] }
    ]
  }, hits);
  assert.equal(result.steps.length, 3);
  assert.equal(result.steps[0].status, 'verified');
  assert.equal(result.steps[1].quoteVerified, false);
  assert.equal(result.steps[1].status, 'weak'); // accurate claim, invented quote
  assert.equal(result.steps[2].status, 'unsupported');
  assert.equal(result.summary.invalidCitations, 1);
});

test('extractive fallback quotes only sentences from the retrieved passages', () => {
  const hits = search(buildIndex(DOCS), 'insured depositors Silicon Valley Bank');
  const flow = extractiveFlow('How were insured depositors at Silicon Valley Bank protected?', hits);
  assert.ok(flow.steps.length > 0);
  for (const s of flow.steps) assert.ok(hits.some((h) => h.chunk.text.includes(s.quote)));
});
