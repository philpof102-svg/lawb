#!/usr/bin/env node
'use strict';
/**
 * b20-to-gitlawb.test.js — real unit tests via node:test
 * ============================================================================
 * Run:   node --test bridge/b20-to-gitlawb.test.js
 * Watch: node --test --watch bridge/b20-to-gitlawb.test.js
 *
 * Covers:
 *   - backoffSeconds: shape, monotonicity, cap, NaN/zero/negative, type coercion
 *   - diff:           firstRun, no-change, single-field, multi-field, fetchedAt excluded
 *   - symbolUniquenessCheck: unknown-slot fallback (network in CI is iffy)
 *   - exports:        all public functions are functions (so the consumer
 *                     wiring never breaks on a typo)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const bridge = require('./b20-to-gitlawb.js');
const { backoffSeconds, diff, symbolUniquenessCheck } = bridge;

const FIXTURES = path.join(__dirname, 'fixtures');
function snap(o) { return Object.assign({ ca: '0x' + 'a'.repeat(40), name: 'LAWB', symbol: 'LAWBM', decimals: 18, totalSupply: '1000000', fetchedAt: '2026-07-12T00:00:00.000Z' }, o || {}); }

// ---------------------------------------------------------------------------
test('backoffSeconds — shape and expected sequence (capped at MAX_BACKOFF_S)', () => {
  // Expected: 5, 10, 20, 40, 80, 160, 320, 640, 1280, 1800 (capped), 1800, 1800
  const seq = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 99, 1000].map(backoffSeconds);
  assert.deepEqual(seq, [5, 10, 20, 40, 80, 160, 320, 640, 1280, 1800, 1800, 1800]);
});

test('backoffSeconds — monotonic non-decreasing', () => {
  let prev = -1;
  for (let i = 1; i < 30; i++) {
    const v = backoffSeconds(i);
    assert.ok(v >= prev, 'value decreased at i=' + i + ': ' + v + ' < ' + prev);
    prev = v;
  }
});

test('backoffSeconds — never exceeds MAX_BACKOFF_S (1800s)', () => {
  for (let i = -3; i < 1000; i++) {
    const v = backoffSeconds(i);
    assert.ok(v <= 1800, 'over cap at i=' + i + ': ' + v);
    assert.ok(v > 0, 'non-positive at i=' + i + ': ' + v);
  }
});

test('backoffSeconds — clamps failures<1 to 1 and accepts floats/stringy numerics', () => {
  assert.equal(backoffSeconds(0), 5);
  assert.equal(backoffSeconds(-5), 5);
  assert.equal(backoffSeconds(0.5), 5);
  assert.equal(backoffSeconds('3'), 20);
  assert.equal(backoffSeconds(NaN), 5);
  assert.equal(backoffSeconds(Infinity), 1800);
});

test('backoffSeconds — return type is an integer (seconds, not ms)', () => {
  for (let i = 1; i < 10; i++) {
    const v = backoffSeconds(i);
    assert.equal(typeof v, 'number');
    assert.equal(v, Math.round(v));
  }
});

// ---------------------------------------------------------------------------
test('diff — firstRun when either side is null', () => {
  const s = snap();
  assert.equal(diff(null, s).firstRun, true);
  assert.equal(diff(s, null).firstRun, true);
  assert.equal(diff(undefined, s).firstRun, true);
});

test('diff — no change yields empty object (no firstRun)', () => {
  const s = snap();
  const d = diff(s, snap());
  assert.equal(d.firstRun, undefined);
  assert.deepEqual(d, {});
});

test('diff — single-field change is reported with from/to', () => {
  const a = snap();
  const b = snap({ totalSupply: '2000000' });
  const d = diff(a, b);
  assert.deepEqual(d.totalSupply, { from: '1000000', to: '2000000' });
});

test('diff — multi-field change yields one entry per changed key', () => {
  const a = snap();
  const b = snap({ name: 'LAWB v2', totalSupply: '9999' });
  const d = diff(a, b);
  assert.equal(typeof d.name, 'object');
  assert.equal(typeof d.totalSupply, 'object');
  assert.equal(d.symbol, undefined);
  assert.equal(d.decimals, undefined);
});

test('diff — fetchedAt is excluded (it changes every tick)', () => {
  const a = snap({ fetchedAt: '2026-07-12T00:00:00.000Z' });
  const b = snap({ fetchedAt: '2026-07-12T00:00:42.000Z' });
  const d = diff(a, b);
  assert.equal(d.fetchedAt, undefined, 'fetchedAt must be ignored');
});

// ---------------------------------------------------------------------------
test('symbolUniquenessCheck — degrades to unknown-slot on missing args', async () => {
  const r = await symbolUniquenessCheck(null, null);
  assert.equal(r.ok, true);
  assert.equal(r.status, 'unknown-slot');
});

test('symbolUniquenessCheck — never throws, always returns a status', async () => {
  // A bogus factory URL keeps the fetch short, and the helper must catch.
  const r = await symbolUniquenessCheck('LAWBM', '0x' + 'f'.repeat(40));
  assert.ok(r);
  assert.ok(['unknown-slot', 'free', 'taken', 'error'].includes(r.status));
  assert.equal(typeof r.ok, 'boolean');
});

// ---------------------------------------------------------------------------
test('exports — all public functions are functions (typo guard)', () => {
  for (const k of ['fetchB20Snapshot', 'diff', 'acquireLock', 'releaseLock', 'backoffSeconds', 'symbolUniquenessCheck']) {
    assert.equal(typeof bridge[k], 'function', k + ' is not a function');
  }
});

test('exports — `diff` from the module matches a from-the-source invocation', () => {
  const a = snap({ totalSupply: '1' });
  const b = snap({ totalSupply: '2' });
  assert.deepEqual(diff(a, b), { totalSupply: { from: '1', to: '2' } });
});
