'use strict';
/**
 * LAWB — mint-lawb.js  (one-command $LAWB creation descriptor on Base's NATIVE B20 factory)
 * ==========================================================================================
 *   node mint-lawb.js 0xYourIssuerAddress        → prints the ready-to-sign createB20 descriptor
 *   node mint-lawb.js --selftest                 → runs the checker
 *
 * 🛑 DESCRIPTOR-ONLY. This script NEVER signs, NEVER deploys, NEVER moves funds, NEVER holds a key.
 *    It builds the exact call a HUMAN signs from their own wallet. No deps, no network.
 *
 * ✓ GROUNDED (docs.base.org/beryl/b20 + @buildonbase, 2026-07): createB20(variant, salt, params,
 *   initCalls) on the native precompile factory 0xB20f…0000; variants ASSET/STABLECOIN; tokens are
 *   prefixed 0xB200…; issuer roles include mint/freeze/seize (burnBlocked).
 * HONEST: B20 is the ISSUER standard — createB20 makes NO liquidity pool and NO trading fee.
 *   $LAWB is a mascot token, not an investment. Confirm the exact struct/ABI in ONE signed TESTNET
 *   deploy before mainnet — do not sign blind.
 */
const crypto = require('crypto');

const B20_FACTORY = '0xB20f000000000000000000000000000000000000';
const isAddr = (a) => typeof a === 'string' && /^0x[a-fA-F0-9]{40}$/.test(a);

/** Deterministic salt — same inputs, same salt, reproducible address derivation. */
function lawbSalt(seed = 'gitlawb:lawb:v1') {
  return '0x' + crypto.createHash('sha256').update(seed).digest('hex');
}

/** The ready-to-sign createB20 descriptor for $LAWB. @param {string} issuer the HUMAN who signs. */
function lawbDescriptor(issuer, opts = {}) {
  if (!isAddr(issuer)) throw new Error('pass the issuer 0x address (the human who signs — ideally gitlawb\'s founder)');
  return {
    rail: 'base-b20-native',
    factory: B20_FACTORY,
    call: 'createB20',
    params: {
      variant: 'ASSET',
      salt: lawbSalt(opts.saltSeed),
      token: { name: 'LAWB', symbol: 'LAWB', decimals: 18, maxSupply: opts.maxSupply || '0', image: opts.image || '' },
      roles: { issuer, admin: issuer, minter: issuer },   // the signer owns the mascot — mint/freeze/seize disclosed
      initCalls: [],
      memo: 'gitlawb official meme {°·°} — born in the shell',
    },
    liquidity: 'NONE — B20 is an issuer standard: no LP, no trading fee. $LAWB is a mascot, not an investment.',
    issuerControl: 'B20 embeds issuer mint/freeze/seize (burnBlocked). The issuer (the signer) holds those roles.',
    chain: 'base',
    signed: false,
    execution: 'FORBIDDEN — descriptor only; a HUMAN signs createB20 from their own wallet. Testnet first.',
    grounding: 'createB20(variant,salt,params,initCalls) on the native factory 0xB20f…0000 (docs.base.org/beryl/b20). CAVEAT: confirm the exact params struct/ABI in ONE signed TESTNET deploy before mainnet.',
  };
}

module.exports = { lawbDescriptor, lawbSalt, B20_FACTORY };

if (require.main === module) {
  const arg = process.argv[2];
  if (arg === '--selftest') {
    const A = '0x' + 'ab'.repeat(20);
    const d = lawbDescriptor(A);
    let threw = false; try { lawbDescriptor('nope'); } catch { threw = true; }
    const checks = [
      ['createB20 on the native factory, variant ASSET, deterministic salt', d.call === 'createB20' && d.factory === B20_FACTORY && d.params.variant === 'ASSET' && d.params.salt === lawbDescriptor(A).params.salt && /^0x[0-9a-f]{64}$/.test(d.params.salt)],
      ['token = LAWB/LAWB, issuer/admin/minter = the signer', d.params.token.symbol === 'LAWB' && d.params.roles.issuer === A && d.params.roles.admin === A],
      ['HONEST: no LP/fee + issuer-control disclosed + mascot-not-investment', /NONE/.test(d.liquidity) && /not an investment/.test(d.liquidity) && /freeze\/seize|mint\/freeze\/seize/.test(d.issuerControl)],
      ['DESCRIPTOR-ONLY: signed:false + FORBIDDEN + testnet-first', d.signed === false && /FORBIDDEN/.test(d.execution) && /TESTNET/.test(d.grounding)],
      ['bad issuer address throws', threw],
      ['no signer surface in exports', !Object.keys(module.exports).some((k) => /sign|send|deploy|broadcast|execute/i.test(k))],
    ];
    let pass = 0; for (const [n, ok] of checks) { console.log(ok ? 'PASS' : 'FAIL', '·', n); if (ok) pass++; }
    console.log(`\n${pass}/${checks.length} checks passed`);
    process.exit(pass === checks.length ? 0 : 1);
  }
  try {
    console.log(JSON.stringify(lawbDescriptor(arg), null, 2));
    console.log('\n{°·°} ready — a HUMAN signs this (testnet first). This tool never deploys.');
  } catch (e) { console.error('usage: node mint-lawb.js 0xIssuerAddress   (' + e.message + ')'); process.exit(1); }
}
