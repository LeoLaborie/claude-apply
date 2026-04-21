import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  interpretProbeResult,
  probeExtensionPermission,
} from '../../src/lib/extension-permission-probe.mjs';

test('interpretProbeResult returns ok when navigate and find succeed', () => {
  const r = interpretProbeResult({
    navigateResult: { url: 'https://jobs.lever.co/anthropic' },
    findResult: { elements: 1 },
    findError: null,
  });
  assert.deepEqual(r, { ok: true });
});

test('interpretProbeResult detects missing host permission', () => {
  const r = interpretProbeResult({
    navigateResult: { url: 'https://jobs.lever.co/anthropic' },
    findResult: null,
    findError: 'Extension manifest must request permission to access the respective host',
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing_permission');
});

test('interpretProbeResult detects extension not installed', () => {
  const r = interpretProbeResult({
    navigateResult: { url: 'https://jobs.lever.co/anthropic' },
    findResult: null,
    findError: 'No response from extension — is it installed?',
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'extension_not_installed');
});

test('interpretProbeResult detects navigation failure', () => {
  const r = interpretProbeResult({
    navigateResult: null,
    findResult: null,
    findError: null,
    navigateError: 'net::ERR_ABORTED',
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'navigation_failed');
});

test('interpretProbeResult detects timeout', () => {
  const r = interpretProbeResult({
    navigateResult: { url: 'https://jobs.lever.co/anthropic' },
    findResult: null,
    findError: 'Operation timeout exceeded',
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'timeout');
});

test('probeExtensionPermission wires navigate+find through a mock client', async () => {
  const calls = [];
  const client = {
    async navigate(url) {
      calls.push({ tool: 'navigate', url });
      return { url };
    },
    async find(selector) {
      calls.push({ tool: 'find', selector });
      return { elements: 1 };
    },
  };
  const r = await probeExtensionPermission(client);
  assert.deepEqual(r, { ok: true });
  assert.equal(calls[0].tool, 'navigate');
  assert.ok(calls[0].url.startsWith('https://jobs.lever.co/'));
  assert.equal(calls[1].tool, 'find');
  assert.equal(calls[1].selector, 'body');
});

test('probeExtensionPermission propagates find errors', async () => {
  const client = {
    async navigate(url) {
      return { url };
    },
    async find() {
      throw new Error('Extension manifest must request permission');
    },
  };
  const r = await probeExtensionPermission(client);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing_permission');
});

test('probeExtensionPermission propagates navigate errors', async () => {
  const client = {
    async navigate() {
      throw new Error('net::ERR_ABORTED');
    },
    async find() {
      throw new Error('should not be called');
    },
  };
  const r = await probeExtensionPermission(client);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'navigation_failed');
});
