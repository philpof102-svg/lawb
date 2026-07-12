'use strict';
/**
 * LAWB-MIRROR — mint-lawb-mirror.js
 * ============================================================================
 *   node mint-lawb-mirror.js 0xYourMainstreetAddress
 *
 * Builds the ready-to-sign createB20 descriptor for the NON-OFFICIAL LAWB
 * mirror token on Base's native B20 factory. The mirror is a community
 * token (design from @Clansy314495853) — 100% of fees go to the issuer
 * (you, on the mainstreet wallet). It is *not* the gitlawb official meme
 * (that's the descriptor in LAWB-DESCRIPTOR-phil.json, which gives 100%
 * to gitlawb's founder wallet 0xAC3ca7…).
 *
 *   node mint-lawb-mirror.js --selftest         → runs the checker
 *
 * 🛑 DESCRIPTOR-ONLY. This script NEVER signs, NEVER deploys, NEVER holds a key.
 *    The HUMAN takes the JSON, opens launch.o1.exchange, and signs createB20
 *    from their mainstreet wallet.
 *
 * HONEST:
 *   - B20 is the ISSUER standard — createB20 makes NO liquidity pool and NO
 *     trading fee. The "100% fees to you" is about who CONTROLS the issuer
 *     role and can later deploy a hook/router; it is NOT automatic revenue.
 *   - Confirm symbol uniqueness on launch.o1.exchange first (e.g. 'LAWBM' or
 *     'MIRLAWB') to avoid colliding with the official gitlawb LAWB.
 *   - Testnet deploy FIRST. The salt is deterministic from a seed so the
 *     same inputs always yield the same address — pick a unique seed.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const B20_FACTORY = '0xB20f000000000000000000000000000000000000';
const isAddr = (a) => typeof a === 'string' && /^0x[a-fA-F0-9]{40}$/.test(a);

/** Deterministic salt for the mirror — DIFFERENT seed than the official meme. */
function mirrorSalt(seed = 'lawb-mirror:non-official:clansy-design:v1') {
  return '0x' + crypto.createHash('sha256').update(seed).digest('hex');
}

/** Build the descriptor. @param {string} issuer mainstreet wallet (the HUMAN signer). */
function mirrorDescriptor(issuer, opts = {}) {
  if (!isAddr(issuer)) throw new Error('pass your mainstreet 0x address (the human who signs createB20)');
  const salt = mirrorSalt(opts.saltSeed);

  // try to inline the design as a data URL if the file is small + present
  let image = opts.image || '';
  const localImg = path.join(__dirname, 'art', 'clansy-design.png');
  if (!image && fs.existsSync(localImg)) {
    try {
      const b64 = fs.readFileSync(localImg).toString('base64');
      // only inline if it's a reasonable size (<100KB) to keep the JSON readable
      if (b64.length < 100 * 1024) image = 'data:image/png;base64,' + b64;
      else image = 'art/clansy-design.png'; // reference local file
    } catch { image = 'art/clansy-design.png'; }
  }

  return {
    rail: 'base-b20-native',
    factory: B20_FACTORY,
    call: 'createB20',
    params: {
      variant: 'ASSET',
      salt,
      token: {
        name: 'LAWB',
        symbol: opts.symbol || 'LAWBM',           // default to a unique-ish symbol; pass --symbol to override
        decimals: 18,
        maxSupply: opts.maxSupply || '0',
        image,
      },
      roles: { issuer, admin: issuer, minter: issuer },
      initCalls: [],
      memo: 'LAWB mirror (non-official) — community design. Fees 100% to issuer. Not the gitlawb official meme.',
    },
    fees: {
      policy: '100% of any trading/liquidity routing fees flow to the issuer (you). No split.',
      honest: 'B20 creates no LP and no trading fee by itself. Fee routing requires a hook/router YOU deploy later.',
    },
    airdrop: {
      channel: 'X (Twitter) — your mainstreet-X account',
      plan: 'post a claim link; recipients EIP-191 sign with their claim wallet; you batch-transfer',
      firstDropSize: opts.firstDropSize || 'REPLACE — 1% of supply is a sane seed',
    },
    branding: {
      official_status: 'non-official mirror of community design (LAWB-DESCRIPTOR-phil.json is the gitlawb official meme)',
      design_source: 'art/clansy-design.png  ·  https://x.com/Clansy314495853/status/2076294553661759710/photo/1',
    },
    chain: 'base',
    signed: false,
    execution: 'FORBIDDEN — descriptor only; a HUMAN signs createB20 from their mainstreet wallet. Testnet first.',
    grounding: 'createB20(variant,salt,params,initCalls) on the native factory 0xB20f…0000; deploy via launch.o1.exchange (B20 launchpad). Testnet first; confirm symbol uniqueness on the launchpad.',
  };
}

module.exports = { mirrorDescriptor, mirrorSalt, B20_FACTORY };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--selftest') {
    const A = '0x' + 'ab'.repeat(20);
    const d = mirrorDescriptor(A);
    let threw = false; try { mirrorDescriptor('nope'); } catch { threw = true; }
    const checks = [
      ['createB20 on the native factory, ASSET, deterministic salt',
        d.call === 'createB20' && d.factory === B20_FACTORY && d.params.variant === 'ASSET' && /^0x[0-9a-f]{64}$/.test(d.params.salt)],
      ['roles issuer/admin/minter = the signer (you, mainstreet wallet)',
        d.params.roles.issuer === A && d.params.roles.admin === A && d.params.roles.minter === A],
      ['fees policy = 100% to issuer (no split, no treasury, no multisig)',
        /100%/.test(d.fees.policy) && !/treasury|multisig/i.test(d.fees.policy) && !/split/i.test(d.fees.policy) || /100%/.test(d.fees.policy) && /no split/i.test(d.fees.policy)],
      ['NON-OFFICIAL: branding says mirror, not gitlawb official',
        /non-official/i.test(d.branding.official_status) && /official meme/i.test(d.branding.official_status)],
      ['DESCRIPTOR-ONLY: signed:false + FORBIDDEN + testnet-first',
        d.signed === false && /FORBIDDEN/.test(d.execution) && /TESTNET/i.test(d.grounding)],
      ['airdrop channel = X, plan signed-claim',
        /X \(Twitter\)/i.test(d.airdrop.channel) && /EIP-191|sign/i.test(d.airdrop.plan)],
      ['bad issuer address throws', threw],
      ['mirror salt ≠ official salt',
        mirrorSalt() !== '0x138f908e5f8a2f103e8c9e0c87724c5df94488ffeeb66dc8945456be8e948b3e'],
      ['no signer surface in exports',
        !Object.keys(module.exports).some((k) => /sign|send|deploy|broadcast|execute/i.test(k))],
    ];
    let pass = 0; for (const [n, ok] of checks) { console.log(ok ? 'PASS' : 'FAIL', '·', n); if (ok) pass++; }
    console.log(`\n${pass}/${checks.length} checks passed`);
    process.exit(pass === checks.length ? 0 : 1);
  }
  // tiny arg parser: --symbol X --seed S --firstdrop F
  const opts = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--symbol' && args[i + 1]) { opts.symbol = args[++i]; }
    else if (args[i] === '--seed' && args[i + 1]) { opts.saltSeed = args[++i]; }
    else if (args[i] === '--firstdrop' && args[i + 1]) { opts.firstDropSize = args[++i]; }
    else if (args[i] === '--max' && args[i + 1]) { opts.maxSupply = args[++i]; }
    else positional.push(args[i]);
  }
  // --json flag: print ONLY the JSON (no decorative trailer). Useful for
  // `... | pbcopy` and `... > out.json`. Default keeps the human-friendly
  // banner so casual runs are easy to read.
  const jsonOnly = process.argv.includes('--json');
  try {
    if (jsonOnly) {
      process.stdout.write(JSON.stringify(mirrorDescriptor(positional[0], opts), null, 2) + '\n');
    } else {
      console.log(JSON.stringify(mirrorDescriptor(positional[0], opts), null, 2));
      console.log('\n{·} ready — a HUMAN signs this via launch.o1.exchange (testnet first). This tool never deploys.');
    }
  } catch (e) { console.error('usage: node mint-lawb-mirror.js 0xYourMainstreetAddress [--symbol LAWBM] [--seed <text>] [--firstdrop "1% of supply"] [--json]\n  (' + e.message + ')'); process.exit(1); }
}
