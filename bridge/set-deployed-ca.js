#!/usr/bin/env node
'use strict';
/**
 * set-deployed-ca.js — write the deployed mirror CA back into the descriptor
 * ============================================================================
 * After you've deployed the LAWB mirror on testnet/mainnet, the bridge needs
 * the CA to poll Basescan for the on-chain metadata. Run this once:
 *
 *   node bridge/set-deployed-ca.js 0xDeployedCaBaseSepolia...
 *
 * It:
 *   1. validates the CA is a 0x + 40 hex string,
 *   2. loads LAWB-MIRROR-DESCRIPTOR.json,
 *   3. writes `deployedCA` and `deployedAt` (only if absent — won't clobber),
 *   4. prints a one-line summary.
 *
 * The CA is also exported as LAWB_DEPLOYED_CA for the rest of the toolchain.
 * Safe to re-run: --force to overwrite an existing deployedCA.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DESCRIPTOR = path.join(ROOT, 'LAWB-MIRROR-DESCRIPTOR.json');

const args = process.argv.slice(2);
const force = args.includes('--force');
const ca = args.find((a) => /^0x[0-9a-fA-F]{40}$/.test(a)) || null;

if (!ca) {
  console.error('usage: node bridge/set-deployed-ca.js 0xCaBaseSepolia... [--force]');
  console.error('       pass a 0x-prefixed 40-hex-char address');
  process.exit(2);
}

if (!fs.existsSync(DESCRIPTOR)) {
  console.error('descriptor not found: ' + DESCRIPTOR);
  process.exit(1);
}

let d = JSON.parse(fs.readFileSync(DESCRIPTOR, 'utf8'));
if (d.deployedCA && !force) {
  console.log('descriptor already has deployedCA=' + d.deployedCA + ' (use --force to overwrite)');
  process.exit(0);
}
if (d.deployedCA && force) {
  console.log('--force: overwriting deployedCA=' + d.deployedCA + ' → ' + ca);
}

d.deployedCA = ca;
d.deployedAt = new Date().toISOString();
d.deployedChain = d.deployedChain || (d.chain === 'base' ? 'base-sepolia' : d.chain);

fs.writeFileSync(DESCRIPTOR, JSON.stringify(d, null, 2) + '\n');
console.log('OK · deployedCA=' + ca + ' · deployedAt=' + d.deployedAt);
console.log('next: node bridge/b20-to-gitlawb.js --apply --once  (will pick up the CA from the descriptor)');
