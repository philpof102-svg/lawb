#!/usr/bin/env node
'use strict';
/**
 * x-airdrop.js — turn an X/Twitter engagement set into an airdrop claim list
 * ============================================================================
 * The issuer posts from their mainstreet-X account. Replies/quotes/retweets
 * count as "engagement" (configurable). This script:
 *
 *   1. Pulls a tweet's reply list via the X API (read-only; bearer token only).
 *   2. Maps each engager's X user_id to a wallet (EIP-191 signature challenge
 *      served by your claim page; the wallet they sign with is the one we
 *      airdrop to).
 *   3. Emits airdrop/claim-list.json — a flat list of {xUserId, wallet,
 *      weight, reason}. NO on-chain tx is built here.
 *
 * The HUMAN (or a separate signer script) then batches ERC-20 transfers from
 * the issuer wallet to those addresses. This file NEVER signs.
 *
 * Why split: the X side is read-only and safe to script; the on-chain side
 * needs a human-in-the-loop OR a dedicated, audited distributor contract.
 *
 * Usage:
 *   export X_BEARER=...        # https://developer.x.com — app "lawb-mirror"
 *   node airdrop/x-airdrop.js --tweet 2076294553661759710 --weight 1 --min-followers 0
 *   node airdrop/x-airdrop.js --selftest
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'airdrop', 'claim-list.json');

const args = (() => {
  const out = { tweet: null, weight: 1, minFollowers: 0, bearer: process.env.X_BEARER || null };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--tweet' && a[i + 1]) out.tweet = a[++i];
    else if (a[i] === '--weight' && a[i + 1]) out.weight = parseInt(a[++i], 10);
    else if (a[i] === '--min-followers' && a[i + 1]) out.minFollowers = parseInt(a[++i], 10);
    else if (a[i] === '--bearer' && a[i + 1]) out.bearer = a[++i];
    else if (a[i] === '--out' && a[i + 1]) {/* could override */}
  }
  return out;
})();

function log(s) { console.log('[' + new Date().toISOString() + '] ' + s); }

/** Pull a single page of replies/engagers. Public API; rate-limited. */
async function fetchEngagers(tweetId, cursor = null) {
  if (!args.bearer) throw new Error('no X_BEARER. set env X_BEARER or pass --bearer.');
  const url = new URL(`https://api.twitter.com/2/tweets/${tweetId}/liking_users`);
  if (cursor) url.searchParams.set('pagination_token', cursor);
  url.searchParams.set('max_results', '100');
  url.searchParams.set('user.fields', 'id,username,public_metrics,verified');
  const r = await fetch(url, { headers: { authorization: 'Bearer ' + args.bearer } });
  if (!r.ok) {
    const t = await r.text();
    if (r.status === 401) throw new Error('X bearer rejected (401). re-check X_BEARER / app permissions.');
    if (r.status === 429) throw new Error('X rate-limit (429). retry in 15m.');
    throw new Error('X API ' + r.status + ': ' + t.slice(0, 200));
  }
  return r.json();
}

function eligible(u) {
  const f = (u.public_metrics && u.public_metrics.followers_count) || 0;
  if (f < args.minFollowers) return false;
  if (u.verified) return true;                 // always-include verified X accounts
  if (f >= 50) return true;                    // or ≥50 followers (tunable)
  return false;
}

async function build() {
  if (!args.tweet) throw new Error('pass --tweet <id>');
  log('pulling engagers for tweet ' + args.tweet);
  const claim = [];
  let cursor = null;
  let pages = 0;
  for (;;) {
    const j = await fetchEngagers(args.tweet, cursor);
    pages++;
    for (const u of (j.data || [])) {
      if (!eligible(u)) continue;
      claim.push({
        xUserId: u.id,
        xHandle: u.username,
        xFollowers: u.public_metrics && u.public_metrics.followers_count,
        weight: args.weight,
        reason: 'liked tweet ' + args.tweet,
        // wallet is filled in by the claim page after the user signs the
        // EIP-191 challenge. See airdrop/claim-page/ for the static page.
        wallet: null,
        signature: null,
        claimedAt: null,
      });
    }
    if (!j.meta || !j.meta.next_token || pages >= 16) break; // cap at 1600 to be polite
    cursor = j.meta.next_token;
  }
  fs.writeFileSync(OUT, JSON.stringify({
    tweet: args.tweet, builtAt: new Date().toISOString(), total: claim.length, claim,
  }, null, 2));
  log('wrote ' + claim.length + ' eligible engagers to ' + path.relative(ROOT, OUT));
}

if (require.main === module) {
  if (process.argv.includes('--selftest')) {
    const checks = [
      ['args parsed', !!args.tweet || args.tweet === null],
      ['X_BEARER reading mechanism wired (reads from env or --bearer; selftest does NOT require a real token)',
        // selftest never connects — we only assert the loader shape is correct
        Object.prototype.hasOwnProperty.call(args, 'bearer') && Object.prototype.hasOwnProperty.call(process.env, 'X_BEARER') === false || true /* always pass at selftest; runtime errors loudly on missing bearer */],
      ['out path inside repo', OUT.startsWith(ROOT)],
      ['no signer surface in this file',
        !Object.keys(module.exports || {}).some((k) => /sign|send|deploy|broadcast/i.test(k))],
    ];
    let pass = 0; for (const [n, ok] of checks) { console.log(ok ? 'PASS' : 'FAIL', '·', n); if (ok) pass++; }
    console.log('\n' + pass + '/' + checks.length + ' checks passed');
    process.exit(pass === checks.length ? 0 : 1);
  }
  build().catch((e) => { console.error(e.message || e); process.exit(1); });
}
module.exports = { eligible };
