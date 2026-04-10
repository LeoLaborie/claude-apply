import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage } from '../../src/apply/language-detect.mjs';

test('french from title', () => {
  assert.equal(
    detectLanguage({
      title: 'Stage Ingénieur Machine Learning',
      description: 'Nous recherchons un stagiaire...',
    }),
    'fr'
  );
});

test('english from title', () => {
  assert.equal(
    detectLanguage({
      title: 'Machine Learning Internship',
      description: 'We are looking for an intern...',
    }),
    'en'
  );
});

test('english when mixed but English dominant', () => {
  assert.equal(
    detectLanguage({
      title: 'Data Science Internship - Paris',
      description: 'You will work on large datasets using Python.',
    }),
    'en'
  );
});

test('french when accents and french words dominant', () => {
  assert.equal(
    detectLanguage({
      title: 'Stagiaire Développeur Full-Stack',
      description: 'Vous rejoindrez une équipe dynamique pour développer des fonctionnalités.',
    }),
    'fr'
  );
});

test('defaults to french on very short input', () => {
  assert.equal(detectLanguage({ title: 'Stage', description: '' }), 'fr');
});
