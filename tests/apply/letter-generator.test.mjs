import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLetterPrompt } from '../../src/apply/letter-generator.mjs';

test('includes company, role, language and JD excerpt', () => {
  const prompt = buildLetterPrompt({
    company: 'Acme AI',
    role: 'Machine Learning Intern',
    language: 'fr',
    jdText: 'We are looking for a strong ML intern with Python and PyTorch experience.',
    candidateSummary: 'Computer Engineering student, experience in RL Unity ML-Agents.',
  });
  assert.match(prompt, /Acme AI/);
  assert.match(prompt, /Machine Learning Intern/);
  assert.match(prompt, /français/i);
  assert.match(prompt, /Unity ML-Agents/);
  assert.match(prompt, /PyTorch/);
});

test('uses english instructions when language=en', () => {
  const prompt = buildLetterPrompt({
    company: 'Widget Corp',
    role: 'Research Intern',
    language: 'en',
    jdText: 'You will conduct research on LLMs.',
    candidateSummary: 'Computer Engineering student.',
  });
  assert.match(prompt, /english/i);
});

test('truncates very long JD', () => {
  const longJd = 'x'.repeat(10_000);
  const prompt = buildLetterPrompt({
    company: 'X',
    role: 'Y',
    language: 'fr',
    jdText: longJd,
    candidateSummary: '',
  });
  assert.ok(prompt.length < 6000);
});
