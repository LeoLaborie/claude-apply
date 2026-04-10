import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truncateJd, estimateTokens } from '../../src/score/jd-truncate.mjs';

test('estimateTokens: ~1 token / 4 chars', () => {
  assert.equal(estimateTokens('test '.repeat(100)), 125);
});

test('truncateJd garde sections responsibilities/requirements en priorité', () => {
  const jd = `
About us
We are a great company that does great things lorem ipsum ${'blah '.repeat(500)}

Responsibilities
- Build ML models
- Deploy to prod

Requirements
- Python
- 2 years exp

Benefits
Free lunch ${'yay '.repeat(500)}

Equal opportunity employer
`;
  const out = truncateJd(jd, 200);
  assert.match(out, /Responsibilities/);
  assert.match(out, /Requirements/);
  assert.ok(!out.includes('Free lunch'), 'benefits should be dropped');
  assert.ok(!out.includes('Equal opportunity'), 'EO should be dropped');
});

test('truncateJd respecte maxTokens (hard cap)', () => {
  const jd = 'x '.repeat(10000);
  const out = truncateJd(jd, 500);
  assert.ok(estimateTokens(out) <= 520, `got ${estimateTokens(out)}`);
});

test('truncateJd sans sections connues garde le début', () => {
  const jd = 'Random job description with no standard sections. '.repeat(50);
  const out = truncateJd(jd, 100);
  assert.ok(out.length > 0);
  assert.ok(estimateTokens(out) <= 120);
});
