#!/usr/bin/env node
'use strict';
/**
 * deploy-b20-mirror.test.js — real unit tests via node:test
 * ============================================================================
 * Run:   node --test bridge/deploy-b20-mirror.test.js
 *
 * Covers:
 *   - resolveChain: known aliases, numeric chainId, reject unknown
 *   - canonicalize: stable across key order, deep equality
 *   - buildEnvelope: shape, chain default (base-sepolia), factory = `to`
 *   - validateDescriptor: rejects bad factory / call / missing fields
 *   - selectorFingerprint: sha256(canonical) shape (NOT the ABI selector —
 *     we explicitly do not compute keccak in this no-deps script)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveChain, canonicalize, buildEnvelope, CHAIN_IDS, loadDescriptorFromObject } = require('./deploy-b20-mirror.js');

const SAMPLE = {
  rail: 'base-b20-native',
  factory: '0xB20f000000000000000000000000000000000000',
  call: 'createB20',
  params: {
    variant: 'ASSET',
    salt: '0x' + '2'.repeat(64),
    token: { name: 'LAWB', symbol: 'LAWBM', decimals: 18, maxSupply: '0', image: '' },
    roles: {
      issuer: '0xAC3ca7c5d3cDD7702fd08F9C4C28dAA22296aDa9',
      admin:  '0xAC3ca7c5d3cDD7702fd08F9C4C28dAA22296aDa9',
      minter: '0xAC3ca7c5d3cDD7702fd08F9C4C28dAA22296aDa9',
    },
    initCalls: [],
    memo: 'test',
  },
  chain: 'base',
};

// ---------------------------------------------------------------------------
test('resolveChain — known aliases', () => {
  assert.equal(resolveChain('base'), 8453);
  assert.equal(resolveChain('base-mainnet'), 8453);
  assert.equal(resolveChain('base-sepolia'), 84532);
  assert.equal(resolveChain(8453), 8453);
  assert.equal(resolveChain('84532'), 84532);
});

test('resolveChain — default is base-sepolia (testnet first)', () => {
  assert.equal(resolveChain(null), 84532);
  assert.equal(resolveChain(undefined), 84532);
  assert.equal(resolveChain(''), 84532);
});

test('resolveChain — rejects unknown chain', () => {
  assert.throws(() => resolveChain('mumbai'));
  assert.throws(() => resolveChain('polygon'));
  assert.throws(() => resolveChain('not-a-chain'));
});

// ---------------------------------------------------------------------------
test('canonicalize — sorts keys, no whitespace, deterministic', () => {
  const a = { z: 1, a: 2, nested: { y: 1, x: 2 } };
  const b = { a: 2, nested: { x: 2, y: 1 }, z: 1 };
  assert.equal(canonicalize(a), canonicalize(b));
  // No whitespace inside braces:
  assert.equal(canonicalize(a), JSON.stringify({ a: 2, nested: { x: 2, y: 1 }, z: 1 }));
});

test('canonicalize — handles arrays and primitives', () => {
  assert.equal(canonicalize([3, 1, 2]), JSON.stringify([3, 1, 2]));
  assert.equal(canonicalize(null), 'null');
  assert.equal(canonicalize('s'), '"s"');
  assert.equal(canonicalize(42), '42');
});

// ---------------------------------------------------------------------------
test('buildEnvelope — shape and chain default', () => {
  const env = buildEnvelope(SAMPLE, resolveChain(null));
  assert.equal(env.chain, 84532);
  assert.equal(env.to, SAMPLE.factory);
  assert.equal(env.value, '0x0');
  assert.equal(env.call, 'createB20');
  assert.equal(typeof env.note, 'string');
});

test('buildEnvelope — selectorFingerprint is sha256(canonical) = 0x + 64 hex', () => {
  const env = buildEnvelope(SAMPLE, 84532);
  assert.match(env.selectorFingerprint, /^0x[0-9a-f]{64}$/);
  // NOT the ABI selector (we don't compute keccak). Just sha256.
  // Compute the same fingerprint independently:
  const crypto = require('crypto');
  const expected = '0x' + crypto.createHash('sha256').update(canonicalize(SAMPLE)).digest('hex');
  assert.equal(env.selectorFingerprint, expected);
});

test('buildEnvelope — canonicalDescriptor round-trips through canonicalize', () => {
  const env = buildEnvelope(SAMPLE, 84532);
  const re = JSON.parse(canonicalize(env.canonicalDescriptor));
  assert.deepEqual(re, SAMPLE);
});

// ---------------------------------------------------------------------------
test('validateDescriptor — happy path returns the descriptor', () => {
  const d = loadDescriptorFromObject(SAMPLE);
  assert.equal(d.call, 'createB20');
});

test('validateDescriptor — rejects bad call', () => {
  const bad = JSON.parse(JSON.stringify(SAMPLE));
  bad.call = 'deployToken';
  assert.throws(() => loadDescriptorFromObject(bad), /call must be/);
});

test('validateDescriptor — rejects bad factory', () => {
  const bad = JSON.parse(JSON.stringify(SAMPLE));
  bad.factory = 'nope';
  assert.throws(() => loadDescriptorFromObject(bad), /factory must be/);
});

test('validateDescriptor — rejects missing params', () => {
  const bad = JSON.parse(JSON.stringify(SAMPLE));
  delete bad.params.salt;
  assert.throws(() => loadDescriptorFromObject(bad), /params/);
});

test('CHAIN_IDS — base + base-sepolia are present and numeric', () => {
  assert.equal(typeof CHAIN_IDS['base'], 'number');
  assert.equal(typeof CHAIN_IDS['base-sepolia'], 'number');
  assert.equal(CHAIN_IDS['base'], 8453);
  assert.equal(CHAIN_IDS['base-sepolia'], 84532);
});
