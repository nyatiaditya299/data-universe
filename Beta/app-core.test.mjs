import test from 'node:test';
import assert from 'node:assert/strict';
import { canReveal, scoreSelfReview } from './app-core.mjs';

test('reveal stays locked until the trainee records a view, reasoning, and a falsifier', () => {
  assert.equal(canReveal({ view: 'Hold', reasoning: 'Rates matter', falsifier: '' }), false);
  assert.equal(canReveal({ view: 'Hold', reasoning: 'Rates matter', falsifier: 'Inflation accelerates' }), true);
});

test('self-review score averages four valid 1-to-5 ratings onto a 100-point scale', () => {
  assert.equal(scoreSelfReview({ evidence: 4, expectations: 4, alternatives: 3, uncertainty: 5 }), 80);
});

test('self-review rejects missing or out-of-range ratings', () => {
  assert.equal(scoreSelfReview({ evidence: 4, expectations: 4, alternatives: 3 }), null);
  assert.equal(scoreSelfReview({ evidence: 4, expectations: 6, alternatives: 3, uncertainty: 5 }), null);
});
