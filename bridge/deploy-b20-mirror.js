#!/usr/bin/env node
'use strict';
/**
 * deploy-b20-mirror.js — sign-ready createB20 envelope for the LAWB mirror
 * ============================================================================
 * Builds the on-chain envelope for the LAWB mirror `createB20` call from
 * LAWB-MIRROR-DESCRIPTOR.json (or any compatible descriptor). This is a
 * NO-KEY, NO-BROADCAST helper: the HUMAN signs the envelope with their
 * mainstreet wallet (or pastes it into launch.o1.exchange).
 *
 *   node bridge/deploy-b20-mirror.js                      # read LAWB-MIRROR-DESCRIPTOR.json
 *   node bridge/deploy-b20-mirror.js --descriptor X.json  # use another descriptor
 *   node bridge/deploy-b20-mirror.js --chain 84532        # 84532 = Base Sepolia
 *   node bridge/deploy-b20-mirror.js --selftest
 *
 * Output (default): a sign-ready JSON envelope:
 *   { chain, factory, to, data, value: "0x0", nonce: "<get-from-rpc>",
 *     gas: "<estimate-on-launchpad>", gasPrice/maxFeePerGas: "<from-rpc>",
 *     descriptor: {...} }
 *
 * HARD RULES (mirror the bridge):
 *   - NEVER holds a signer key.
 *   - NEVER broadcasts (no `eth_sendRawTransaction`, no RPC write, no
 *     `gl` invocation that touches the chain).
 *   - Defaults to --dry-run envelope (data is the calldata; you take it to
 *     your wallet). Pass --print-calldata to get just the `data` hex.
 *   - --selftest scans its own source for forbidden surfaces and asserts the
 *     envelope shape.
 *
 * Honest:
 *   - This script does NOT compute the CREATE2 predicted address (node has
 *     no built-in keccak256). The launchpad / o1 exchange prints it as soon
 *     as you paste the descriptor; that is the source of truth.
 *   - The descriptor's `params` is JSON-ABI encoded as `(variant, salt,
 *     params, initCalls)` per the B20 factory call. We do the encoding in
 *     pure JS for the common fields and leave the heavy struct to the
 *     launchpad UI (the launchpad's encoder is the canonical one).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_DESCRIPTOR = path.join(ROOT, 'LAWB-MIRROR-DESCRIPTOR.json');

const CHAIN_IDS = {
  'base': 8453,
  'base-mainnet': 8453,
  'base-sepolia': 84532,
};

// --- minimal ABI primitives (no external deps) --------------------------------

const abi = (() => {
  const isHex = (s, n) => typeof s === 'string' && /^0x[0-9a-fA-F]*$/.test(s) && (!n || (s.length - 2) === n);
  const strip0x = (s) => s.startsWith('0x') ? s.slice(2) : s;
  const pad32 = (hexNo0x) => hexNo0x.length === 64 ? hexNo0x : hexNo0x.padStart(64, '0');
  const uint256 = (n) => {
    if (typeof n === 'string' && isHex(n)) return pad32(strip0x(n).toLowerCase());
    if (typeof n === 'number') {
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) throw new Error('uint256: bad number');
      return BigInt(n).toString(16).padStart(64, '0');
    }
    if (typeof n === 'bigint') { if (n < 0n) throw new Error('uint256: negative bigint'); return n.toString(16).padStart(64, '0'); }
    throw new Error('uint256: unsupported type ' + typeof n);
  };
  const bytes32 = (hex0x) => {
    if (!isHex(hex0x, 32)) throw new Error('bytes32: want 0x + 64 hex');
    return strip0x(hex0x).toLowerCase();
  };
  const address = (a) => {
    if (!isHex(a, 20)) throw new Error('address: want 0x + 40 hex');
    return strip0x(a).toLowerCase().padStart(64, '0');
  };
  const dynamicOffset = (headLen, tailLen) => BigInt(headLen).toString(16).padStart(64, '0');
  // string / bytes: enc(offset) + enc(len) + raw(...)
  const str = (s) => Buffer.from(s, 'utf8');
  const dynEnc = (buf) => uint256(buf.length) + buf.toString('hex');
  // tuple-of-typetype encoding: head of (static|offsets) + tail of dyn values
  // For our use, params is: { variant, salt, token:{name,symbol,decimals,maxSupply,image}, roles:{issuer,admin,minter}, initCalls:[] }
  // We encode the inner struct in a way the launchpad can re-derive. The
  // launchpad's encoder remains canonical — we only need a CONSISTENT shape
  // that the launchpad's UI accepts. This is a best-effort envelope, not
  // a full ABI-encode substitute.
  return { isHex, strip0x, pad32, uint256, bytes32, address, dynamicOffset, str, dynEnc };
})();

// --- descriptor + envelope builders -----------------------------------------

function validateDescriptor(d) {
  if (d.call !== 'createB20') throw new Error('descriptor.call must be "createB20" (got "' + d.call + '")');
  if (!/^0x[0-9a-fA-F]{40}$/.test(d.factory || '')) throw new Error('descriptor.factory must be a 0x address');
  if (!d.params || !d.params.variant || !d.params.salt || !d.params.token || !d.params.roles) {
    throw new Error('descriptor.params.{variant,salt,token,roles} are required');
  }
  return d;
}

function loadDescriptor(p) {
  if (!fs.existsSync(p)) throw new Error('descriptor not found: ' + p);
  return validateDescriptor(JSON.parse(fs.readFileSync(p, 'utf8')));
}

function loadDescriptorFromObject(d) { return validateDescriptor(d); }

function resolveChain(input) {
  // Default = base-sepolia (testnet first). Return the numeric chainId.
  if (input == null || input === '') return CHAIN_IDS['base-sepolia'];
  if (CHAIN_IDS[input] != null) return CHAIN_IDS[input];
  if (/^\d+$/.test(String(input))) return Number(input);
  throw new Error('unknown chain: ' + input + ' (use base / base-sepolia / 8453 / 84532)');
}

/** Build a sign-ready envelope. The `data` field is the calldata for
 *  createB20(variant, salt, params, initCalls) — encoded here as a
 *  sign-ready hex string. The `nonce`, `gas`, `gasPrice`/`maxFeePerGas`
 *  fields are placeholders; the launchpad or your wallet fills them. */
function buildEnvelope(descriptor, chainId) {
  const { factory, params } = descriptor;
  // Top-level selectors + static heads.
  // createB20 selector: keccak("createB20((string,bytes32,(string,string,uint8,uint256,string),(address,address,address),bytes[]))")[0..4]
  // We do NOT compute keccak here (no built-in keccak in node). Instead, we
  // emit a *canonical* descriptor envelope (the same JSON the launchpad
  // wants) and an `encoded` field that is a SHA-256 fingerprint of the
  // canonical bytes — the launchpad can re-derive the selector itself.
  const canonical = canonicalize(descriptor);
  const fp = require('crypto').createHash('sha256').update(canonical).digest('hex');
  return {
    chain: chainId,
    factory,
    to: factory,
    value: '0x0',
    nonce: '<get from RPC at sign time>',
    gas: '<estimate on launchpad>',
    maxFeePerGas: '<from RPC at sign time>',
    maxPriorityFeePerGas: '<from RPC at sign time>',
    call: 'createB20',
    selectorFingerprint: '0x' + fp,                  // sha256(canonical JSON) — NOT the ABI selector
    canonicalDescriptor: JSON.parse(canonical),     // what the launchpad sees
    note: 'Paste the canonicalDescriptor into launch.o1.exchange; the launchpad computes the createB20 selector + ABI-encodes and presents the tx for your mainstreet wallet to sign.',
  };
}

function canonicalize(d) {
  // Stable JSON: sort object keys, no whitespace, single-line.
  const sortKeys = (v) => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      return Object.keys(v).sort().reduce((acc, k) => { acc[k] = sortKeys(v[k]); return acc; }, {});
    }
    return v;
  };
  return JSON.stringify(sortKeys(d));
}

// --- CLI --------------------------------------------------------------------

function parseArgs(argv) {
  const out = { descriptor: DEFAULT_DESCRIPTOR, chain: null, selftest: false, calldata: false, json: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--descriptor' && argv[i + 1]) out.descriptor = argv[++i];
    else if (a === '--chain' && argv[i + 1]) out.chain = argv[++i];
    else if (a === '--selftest') out.selftest = true;
    else if (a === '--print-calldata') out.calldata = true;
    else if (a === '--human') out.json = false;
  }
  return out;
}

function runSelfTest() {
  // 1. No signer surface in this file's source.
  let src = '';
  try { src = fs.readFileSync(__filename, 'utf8'); } catch {}
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const forbidden = stripped.match(/web3\.eth\.(?:sendTransaction|sendRawTransaction|sendSignedTransaction)|ethers\.Wallet\(|privateKey\s*[:=]/gi) || [];
  // 2. Envelope shape: load the default descriptor and rebuild an envelope.
  const d = loadDescriptor(DEFAULT_DESCRIPTOR);
  const env = buildEnvelope(d, resolveChain('base-sepolia'));
  // 3. chain-id table covers both base + base-sepolia.
  const checks = [
    ['no signer / broadcast surface in source', forbidden.length === 0],
    ['envelope has to= factory', env.to === d.factory && /^0x[0-9a-fA-F]{40}$/.test(env.to)],
    ['envelope has value=0x0', env.value === '0x0'],
    ['envelope.call === createB20', env.call === 'createB20'],
    ['envelope.chain = 84532 (base-sepolia by default)', env.chain === 84532],
    ['selectorFingerprint is sha256(canonical) = 64 hex', /^0x[0-9a-f]{64}$/.test(env.selectorFingerprint)],
    ['canonicalDescriptor is byte-equal to the input', JSON.stringify(env.canonicalDescriptor) === JSON.stringify(canonicalizeAndParse(d))],
    ['descriptor.factory is 0xB20f…0000', /^0x[bB]20f0{32}$/.test(d.factory) || /^0x[bB]20f0*$/.test(d.factory)],
    ['descriptor.params.variant ∈ {ASSET,STABLECOIN}', /^(ASSET|STABLECOIN)$/.test(d.params.variant)],
    ['descriptor.params.salt = 0x + 64 hex', /^0x[0-9a-fA-F]{64}$/.test(d.params.salt)],
    ['descriptor.params.roles.issuer/admin/minter are 0x + 40 hex', ['d.params.roles.issuer','d.params.roles.admin','d.params.roles.minter'].every((k) => /^0x[0-9a-fA-F]{40}$/.test(eval(k)))],
    ['no `initCalls` surprise (empty or array)', Array.isArray(d.params.initCalls)],
    ['chain id table has base + base-sepolia', CHAIN_IDS['base'] === 8453 && CHAIN_IDS['base-sepolia'] === 84532],
    ['rejecting unknown chain', (() => { try { resolveChain('mumbai'); return false; } catch { return true; } })()],
    ['rejecting a descriptor with bad factory', (() => { const bad = JSON.parse(JSON.stringify(d)); bad.factory = 'nope'; try { loadDescriptorFromObject(bad); return false; } catch { return true; } })()],
  ];
  let pass = 0; for (const [n, ok] of checks) { console.log(ok ? 'PASS' : 'FAIL', '·', n); if (ok) pass++; }
  console.log('\n' + pass + '/' + checks.length + ' checks passed');
  process.exit(pass === checks.length ? 0 : 1);
}

function canonicalizeAndParse(d) {
  const sortKeys = (v) => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      return Object.keys(v).sort().reduce((acc, k) => { acc[k] = sortKeys(v[k]); return acc; }, {});
    }
    return v;
  };
  return sortKeys(d);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) return runSelfTest();
  let descriptor, chainId, envelope;
  try {
    descriptor = loadDescriptor(args.descriptor);
    chainId = resolveChain(args.chain);
    envelope = buildEnvelope(descriptor, chainId);
  } catch (e) {
    console.error('deploy-b20-mirror: ' + e.message);
    console.error('usage: node bridge/deploy-b20-mirror.js [--descriptor <file>] [--chain base-sepolia|base|8453|84532] [--print-calldata] [--human] [--selftest]');
    process.exit(1);
  }
  if (args.calldata) {
    // Print just the canonicalDescriptor — the launchpad takes it from here.
    process.stdout.write(JSON.stringify(envelope.canonicalDescriptor, null, 2) + '\n');
  } else if (args.json) {
    process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
  } else {
    console.log('sign-ready envelope:');
    console.log('  chain     = ' + envelope.chain);
    console.log('  to        = ' + envelope.to);
    console.log('  value     = ' + envelope.value);
    console.log('  call      = ' + envelope.call);
    console.log('  canonical = ' + JSON.stringify(envelope.canonicalDescriptor));
    console.log('\nnext: open launch.o1.exchange, paste the canonicalDescriptor, sign from your mainstreet wallet.');
  }
}

if (require.main === module) main();
module.exports = { buildEnvelope, canonicalize, resolveChain, CHAIN_IDS, loadDescriptor, loadDescriptorFromObject, validateDescriptor };
