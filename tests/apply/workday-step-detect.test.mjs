import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectStep, STEP_SIGNATURES } from '../../src/apply/workday/step-detect.mjs';

// --- URL-only matching ---

test('detectStep — URL /myInformation → my-information', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/site/job/123/myInformation', domMarkers: [] }),
    'my-information'
  );
});

test('detectStep — URL /myExperience → my-experience', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/site/job/123/myExperience', domMarkers: [] }),
    'my-experience'
  );
});

test('detectStep — URL /voluntaryDisclosures → voluntary-disclosures', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/site/job/123/voluntaryDisclosures', domMarkers: [] }),
    'voluntary-disclosures'
  );
});

test('detectStep — URL /selfIdentify → self-identify', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/site/job/123/selfIdentify', domMarkers: [] }),
    'self-identify'
  );
});

test('detectStep — URL /review → review', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/site/job/123/review', domMarkers: [] }),
    'review'
  );
});

// --- DOM-only matching ---

test('detectStep — DOM marker myInformation-SectionTitle → my-information', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/site/job/123/apply', domMarkers: ['myInformation-SectionTitle'] }),
    'my-information'
  );
});

test('detectStep — DOM marker myExperience-SectionTitle → my-experience', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/generic', domMarkers: ['myExperience-SectionTitle'] }),
    'my-experience'
  );
});

test('detectStep — DOM marker voluntaryDisclosures-SectionTitle → voluntary-disclosures', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/generic', domMarkers: ['voluntaryDisclosures-SectionTitle'] }),
    'voluntary-disclosures'
  );
});

test('detectStep — DOM marker selfIdentify-SectionTitle → self-identify', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/generic', domMarkers: ['selfIdentify-SectionTitle'] }),
    'self-identify'
  );
});

test('detectStep — DOM marker review-SectionTitle → review', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/generic', domMarkers: ['review-SectionTitle'] }),
    'review'
  );
});

// --- Priority and edge cases ---

test('detectStep — URL wins when URL and DOM disagree', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/site/job/123/myExperience', domMarkers: ['review-SectionTitle'] }),
    'my-experience'
  );
});

test('detectStep — returns generic when nothing matches', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/site/job/123/unknownStep', domMarkers: [] }),
    'generic'
  );
});

test('detectStep — empty domMarkers falls back to URL only', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/site/job/123/review', domMarkers: [] }),
    'review'
  );
});

test('detectStep — empty url falls back to DOM only', () => {
  assert.equal(
    detectStep({ url: '', domMarkers: ['myInformation-SectionTitle'] }),
    'my-information'
  );
});

test('STEP_SIGNATURES — exported and non-empty', () => {
  assert.ok(Array.isArray(STEP_SIGNATURES));
  assert.ok(STEP_SIGNATURES.length >= 5);
});
