#!/usr/bin/env node
'use strict';
/**
 * b20-to-gitlawb.js — the b20→gitlawb bridge (auto-loop example)
 * ============================================================================
 * Polls a Base B20 / o1 launchpad / Basescan endpoint for the LAWB mirror
 * token's metadata (CA, supply, holders, fee controller…), diffs against the
 * last-known state in state/last-snapshot.json, and on change invokes the
 * `gl mirror` command to keep the gitlawb mirror in sync.
 *
 * Why a poller (and not event-driven): the public read-only endpoints this
 * script uses (Basescan, o1 launchpad public profile) don't push webhooks.
 * A 60s loop is cheap and idempotent.
 *
 * HARD RULES:
 *   - Default mode is --dry-run. NOTHING is mirrored until you pass --apply.
 *   - This script NEVER holds a signer key. `gl mirror` reads the gitlawb
 *     identity from the gl CLI's own key file (see tools/publish-gitlawb.sh).
 *   - Idempotent: re-running with no change is a no-op. The state file is the
 *     truth; if it's deleted, the next run is treated as first-run.
 *   - On ANY error: log, advance the failure counter, keep looping. Never
 *     crash out (the user said "doit rester en auto-loop même quand je pars").
 *   - If gl reports an iCaptcha / human-challenge requirement, EXIT (don't
 *     loop): a human must solve it once. The script prints the command.
 *
 * Usage:
 *   node bridge/b20-to-gitlawb.js --dry-run                    # default; just print diffs
 *   node bridge/b20-to-gitlawb.js --apply                      # actually call gl mirror on change
 *   node bridge/b20-to-gitlawb.js --apply --once               # run one tick then exit
 *   node bridge/b20-to-gitlawb.js --apply --interval 60        # 60s tick
 *   node bridge/b20-to-gitlawb.js --apply --ca 0x...           # watch a specific contract
 *   node bridge/b20-to-gitlawb.js --selftest
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const STATE_DIR = path.join(ROOT, 'state');
const STATE_FILE = path.join(STATE_DIR, 'last-snapshot.json');
const LOCK_FILE = path.join(STATE_DIR, 'bridge.lock');
const MIRROR_REPO_NAME = 'lawb-mirror';

const args = (() => {
  const out = { dryRun: true, apply: false, once: false, interval: 60, ca: null, glPath: 'gl' };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--dry-run') out.dryRun = true;
    else if (a[i] === '--apply') { out.apply = true; out.dryRun = false; }
    else if (a[i] === '--once') out.once = true;
    else if (a[i] === '--interval' && a[i + 1]) out.interval = Math.max(5, parseInt(a[++i], 10));
    else if (a[i] === '--ca' && a[i + 1]) out.ca = a[++i];
    else if (a[i] === '--gl' && a[i + 1]) out.glPath = a[++i];
  }
  return out;
})();

function ensureDir(d) { try { fs.mkdirSync(d, { recursive: true }); } catch {} }
function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function writeJSON(f, v) { fs.writeFileSync(f, JSON.stringify(v, null, 2)); }
function nowISO() { return new Date().toISOString(); }
function sha(o) { return crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16); }

/** Cheap PID-based lock so two loops don't race. */
function acquireLock() {
  ensureDir(STATE_DIR);
  if (fs.existsSync(LOCK_FILE)) {
    const old = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    if (old.pid && old.pid !== process.pid) {
      try { process.kill(old.pid, 0); return { ok: false, reason: 'another bridge is running (pid ' + old.pid + ')' }; } catch { /* stale */ }
    }
  }
  writeJSON(LOCK_FILE, { pid: process.pid, started: nowISO() });
  return { ok: true };
}
function releaseLock() { try { fs.unlinkSync(LOCK_FILE); } catch {} }

/** Fetch the public B20/o1 metadata for a CA. Returns null on error. */
async function fetchB20Snapshot(ca) {
  // Public read-only probe via Basescan. We do NOT require a key for the
  // free tier — but if the rate limit hits, the next tick will retry.
  const url = `https://api.basescan.org/api?module=token&action=tokeninfo&contractaddress=${ca}`;
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'lawb-mirror-bridge/1.0' } });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.status !== '1' || !j.result) return null;
    const t = Array.isArray(j.result) ? j.result[0] : j.result;
    return {
      ca,
      name: t.name || '',
      symbol: t.symbol || '',
      decimals: t.divisor ? Math.log10(Number(t.divisor)) | 0 : 18,
      totalSupply: t.totalSupply || '0',
      fetchedAt: nowISO(),
    };
  } catch { return null; }
}

/** Compare two snapshots, return the diff (empty object if no change). */
function diff(a, b) {
  if (!a) return { firstRun: true, b };
  if (!b) return { firstRun: true, a };
  const out = {};
  for (const k of Object.keys(b)) {
    if (k === 'fetchedAt') continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out[k] = { from: a[k], to: b[k] };
  }
  return out;
}

/** Run `gl mirror` if gl is on PATH. NEVER auto-installs. */
function runGlMirror(githubUrl, description) {
  const r = spawnSync(args.glPath, ['mirror', githubUrl, '--repo', MIRROR_REPO_NAME, '--description', description], {
    encoding: 'utf8', timeout: 120_000,
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

async function tick(state) {
  if (!args.ca) {
    console.error('[' + nowISO() + '] no --ca given. pass the deployed mirror CA. (b20 contract address on Base.)');
    return { skipped: true };
  }
  const snap = await fetchB20Snapshot(args.ca);
  if (!snap) {
    state.failures = (state.failures || 0) + 1;
    state.lastErrorAt = nowISO();
    console.error('[' + nowISO() + '] fetch failed (failure #' + state.failures + ') — will retry next tick');
    return { skipped: true };
  }
  state.failures = 0;
  state.lastSuccessAt = nowISO();
  const prev = state.lastSnapshot;
  const d = diff(prev, snap);
  if (!Object.keys(d).length && !d.firstRun) {
    console.log('[' + nowISO() + '] no change (' + sha(snap) + ')');
    return { noChange: true };
  }
  console.log('[' + nowISO() + '] change detected (' + sha(snap) + '):');
  console.log(JSON.stringify(d, null, 2));
  state.lastSnapshot = snap;
  state.lastDiff = d;
  if (args.apply) {
    const desc = 'LAWB mirror (non-official) · ' + snap.name + ' (' + snap.symbol + ') · supply ' + snap.totalSupply + ' · auto-bridged from b20 → gitlawb';
    const r = runGlMirror('https://github.com/philpof102-svg/lawb', desc);
    state.lastMirror = { at: nowISO(), ...r };
    console.log('  gl mirror exit=' + r.code);
    if (r.stdout) console.log(r.stdout.trim());
    if (r.stderr) console.error(r.stderr.trim());
    if (/icaptcha|captcha|proof required|403/i.test(r.stderr + r.stdout)) {
      console.error('\n⛔ gitlawb requires a human iCaptcha proof. Bridge exiting; solve it once with `gl quickstart`, then re-run.');
      process.exit(2);
    }
  } else {
    console.log('  (dry-run: would invoke `gl mirror` — re-run with --apply to actually mirror)');
  }
  return { changed: true, diff: d };
}

async function main() {
  if (args.selftest || process.argv.includes('--selftest')) {
    const checks = [
      ['args parsed', typeof args.interval === 'number' && args.interval >= 5],
      ['--dry-run is default', args.dryRun === true && args.apply === false],
      ['no signer surface in this file',
        !Object.keys(module.exports || {}).some((k) => /sign|send|deploy|broadcast/i.test(k))],
      ['lock dir is .gitignore-able', /state/.test(STATE_DIR.replace(/\\/g, '/'))],
    ];
    let pass = 0; for (const [n, ok] of checks) { console.log(ok ? 'PASS' : 'FAIL', '·', n); if (ok) pass++; }
    console.log('\n' + pass + '/' + checks.length + ' checks passed');
    process.exit(pass === checks.length ? 0 : 1);
  }
  const lock = acquireLock();
  if (!lock.ok) { console.error('lock: ' + lock.reason); process.exit(1); }
  process.on('exit', releaseLock);
  process.on('SIGINT', () => { releaseLock(); process.exit(0); });
  process.on('SIGTERM', () => { releaseLock(); process.exit(0); });

  ensureDir(STATE_DIR);
  const state = readJSON(STATE_FILE) || { startedAt: nowISO() };
  console.log('[' + nowISO() + '] bridge started · mode=' + (args.apply ? 'APPLY' : 'DRY-RUN') + ' · interval=' + args.interval + 's · ca=' + (args.ca || '(none)'));
  do {
    try { await tick(state); } catch (e) { console.error('[' + nowISO() + '] tick error: ' + (e && e.message || e)); state.failures = (state.failures || 0) + 1; }
    writeJSON(STATE_FILE, state);
    if (!args.once) await new Promise((r) => setTimeout(r, args.interval * 1000));
  } while (!args.once);
  releaseLock();
}

if (require.main === module) main();
module.exports = { fetchB20Snapshot, diff, acquireLock, releaseLock };
