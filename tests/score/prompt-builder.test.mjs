import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt } from '../../src/score/prompt-builder.mjs';

const cvMarkdown = '# Dev\nPython, ML, RL';
const offer = {
  company: 'Mistral',
  title: 'ML Engineer Intern',
  location: 'Paris',
  body: 'Responsibilities: build models. Requirements: Python.',
};

test('buildPrompt retourne system + user', () => {
  const p = buildPrompt({ cvMarkdown, offer, jdMaxTokens: 1500 });
  assert.ok(p.system.length > 0);
  assert.ok(p.user.length > 0);
});

test('system contient les consignes JSON', () => {
  const p = buildPrompt({ cvMarkdown, offer, jdMaxTokens: 1500 });
  assert.match(p.system, /JSON/);
  assert.match(p.system, /score/);
  assert.match(p.system, /verdict/);
});

test('user contient profil, critères, offre', () => {
  const p = buildPrompt({ cvMarkdown, offer, jdMaxTokens: 1500 });
  assert.match(p.user, /# Profil candidat/);
  assert.match(p.user, /Dev/);
  assert.match(p.user, /Critères/);
  assert.match(p.user, /Mistral/);
  assert.match(p.user, /ML Engineer Intern/);
  assert.match(p.user, /Paris/);
  assert.match(p.user, /Responsibilities/);
});

test('user tronque la JD si trop longue', () => {
  const bigOffer = { ...offer, body: 'x '.repeat(20000) };
  const p = buildPrompt({ cvMarkdown, offer: bigOffer, jdMaxTokens: 500 });
  assert.ok(p.user.length < 10000, `user too long: ${p.user.length}`);
});
