#!/usr/bin/env bash
# Publish LAWB to gitlawb — mirror of the public GitHub repo. CC0/MIT.
# ==================================================================================================
# Closes the open-source loop: Toshi rides zero (@gitlawb/zero) → Toshi's code lives on gitlawb too.
#
# ⚠️ Linux/macOS ONLY (the gl CLI has no Windows build — on Windows run this inside WSL: `wsl bash
#    tools/publish-gitlawb.sh`). Idempotent: re-running re-registers (safe) and force-updates the mirror.
#
# What it does, step by step (everything is the documented gitlawb.com/start flow):
#   1. puts the REAL linux gl on PATH (npm) — a stale Windows `gl` shim inherited into WSL silently
#      shadows it and breaks every push; and points git-remote-gitlawb at the public node (GITLAWB_NODE)
#   2. reuses the DID identity if present (Ed25519 keypair in ~/.gitlawb/identity.pem — BACK IT UP)
#   3. registers the DID with the public node — STOPS LOUDLY if the node demands an iCaptcha proof
#      (that human step can't be scripted; see the printed instructions)
#   4. mirrors THIS repo's public GitHub history into gitlawb://<your-did>/toshi via `gl mirror`
#      (no local gateway, no working-tree push — pulls the current master straight from GitHub)
set -euo pipefail

NODE_URL="${GITLAWB_NODE:-https://node.gitlawb.com}"
export GITLAWB_NODE="$NODE_URL"
GITHUB_URL="${LAWB_GITHUB_URL:-https://github.com/philpof102-svg/lawb}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "· lawb repo:     $REPO_DIR"
echo "· gitlawb node: $NODE_URL"
echo "· github src:   $GITHUB_URL"

# 1. gl CLI — the real linux binary MUST win over any C:\...\npm\gl shim WSL inherits on PATH.
#    (That shim was the silent bug: `command -v gl` found it, the script "had" gl, every push then failed
#     against a dead git-remote-gitlawb.) Put the npm-global bin FIRST, install via npm if gl is not real.
NPM_BIN="$(npm config get prefix 2>/dev/null)/bin"
export PATH="$NPM_BIN:$PATH"
if ! gl --version >/dev/null 2>&1; then
  echo "· installing @gitlawb/gl via npm (same registry as @gitlawb/zero)…"
  npm i -g @gitlawb/gl
fi
echo "· gl: $(command -v gl) ($(gl --version)) · helper: $(command -v git-remote-gitlawb || echo MISSING)"

# 2. identity (NEVER overwrite an existing one — that key IS the account/URL)
if gl identity show >/dev/null 2>&1; then
  echo "· identity exists (reused): $(gl identity show)"
else
  echo "· creating a new DID identity (saved to ~/.gitlawb/identity.pem — BACK THIS FILE UP)"
  gl identity new
fi
MY_DID="$(gl identity show)"

# 3. register with the node. The public node can require an iCaptcha proof (level ≥ 3) — that is a human
#    challenge we must NOT try to bypass. If registration is blocked on it, stop and tell the operator.
echo "· registering $MY_DID with $NODE_URL …"
if ! reg_out="$(gl register 2>&1)"; then
  echo "$reg_out"
  if echo "$reg_out" | grep -qi "icaptcha\|captcha\|proof required\|403"; then
    cat <<EOF

⛔ gitlawb registration needs a human iCaptcha proof — this script cannot (and must not) solve it.
   Do this ONE step, then re-run this script:

     export PATH="$NPM_BIN:\$PATH"
     export GITLAWB_NODE=$NODE_URL
     gl quickstart          # guided: solves the iCaptcha, registers this DID, reuses your key

   (or follow the challenge URL gl printed above and register manually.)
EOF
    exit 2
  fi
  echo "· register returned non-zero (often = already registered) — continuing"
fi

# 4. mirror the CURRENT GitHub history into gitlawb (pulls master straight from GitHub — no local :7545
#    gateway, no /mnt/d working-tree push). Idempotent: re-running force-updates the gitlawb copy.
echo "· mirroring $GITHUB_URL → gitlawb://$MY_DID/lawb …"
gl mirror "$GITHUB_URL" --repo lawb \
  --description "LAWB {°·°} — the gitlawb official meme. Born in the shell. Art+lore CC0, code MIT, one-command B20 descriptor."

echo
DID_KEY="$(echo "$MY_DID" | cut -d: -f3)"
echo "✅ LAWB mirrored to gitlawb (current master)"
echo "   profile: https://gitlawb.com/${DID_KEY:0:8}"
echo "   verify:  gl repo list   (should now show lawb)"
