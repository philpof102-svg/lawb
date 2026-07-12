# LAWB mirror (non-official) `{>·<}`

This branch (`feat/lawb-mirror-non-official`) is a **non-official mirror** of the
LAWB meme, in a separate `createB20` deployment on Base. The gitlawb official
meme lives in the original `LAWB-DESCRIPTOR-phil.json` and points to
`0xAC3ca7c5d3cDD7702fd08F9C4C28dAA22296aDa9` (Phil / gitlawb). This mirror is
**your** token, with **100% of the fees to your mainstreet wallet** — no split,
no treasury, no community multisig.

## TL;DR (3 commands, no deploys anything)

```sh
# 1. Build the ready-to-sign createB20 descriptor (replace with your mainstreet address):
node mint-lawb-mirror.js 0xYourMainstreetAddress

# 2. Self-tests:
node mint-lawb-mirror.js --selftest
node bridge/b20-to-gitlawb.js --selftest
node airdrop/claim-builder.js --selftest

# 3. Open launch.o1.exchange, paste the JSON output, sign the createB20 call.
#    Deploy to **testnet first** (Base Sepolia). Then to mainnet.
```

## What's here

| File | What it does | Touches funds? |
|---|---|---|
| `LAWB-MIRROR-DESCRIPTOR.json` | Hand-editable reference of the mirror descriptor | No |
| `mint-lawb-mirror.js` | Prints the ready-to-sign createB20 JSON; `--selftest` | No |
| `bridge/b20-to-gitlawb.js` | Polls the deployed CA, diffs, calls `gl mirror` on change | No (read-only APIs; `gl mirror` only) |
| `airdrop/claim-builder.js` | Pulls engagers from a tweet into `claim-list.json` | No |
| `airdrop/claim-page/index.html` | Static page; users EIP-191 sign with their wallet; signature stays in the browser | No |
| `art/clansy-design.png` | The community design (downloaded from Clansy on X) | n/a |

## The mirror, vs the official meme

| | Official (`LAWB-DESCRIPTOR-phil.json`) | This mirror |
|---|---|---|
| Issuer | `0xAC3ca7…aDa9` (Phil) | **your mainstreet address** |
| Symbol | `LAWB` | `LAWBM` (default; override with `--symbol`) |
| Salt seed | `gitlawb:lawb:v1` | `lawb-mirror:non-official:clansy-design:v1` |
| Fee policy | 100% to gitlawb | **100% to you** |
| Status | gitlawb official meme | non-official community mirror |
| Design | Kevin's `{>·<}` / `{°·°}` | @Clansy314495853's design (see `art/`) |

They are different `createB20` deployments with different salts → different
addresses. They can coexist on Base. The official descriptor is unchanged.

## The b20 → gitlawb bridge (auto-loop)

```
┌─────────────────┐    poll (60s)    ┌──────────────────┐
│  launch.o1 /    │ ───────────────▶ │  b20-to-gitlawb  │
│  Basescan API   │   token meta     │  (this repo)     │
└─────────────────┘                  └────────┬─────────┘
                                              │ diff?
                                              ▼
                                     ┌──────────────────┐
                                     │  `gl mirror`     │  ← never holds a key;
                                     │  (gitlawb CLI)   │     uses your existing
                                     └──────────────────┘     gitlawb identity
```

`bridge/b20-to-gitlawb.js` is **dry-run by default**. Pass `--apply` to make
`gl mirror` actually run when the snapshot changes. The state file
`state/last-snapshot.json` is the truth — delete it to re-baseline.

The loop survives transient errors (Basescan rate-limits, network blips) and
only exits if `gl mirror` itself demands a human iCaptcha proof (which it
prints instructions for).

## The airdrop (X-driven)

1. You post from your mainstreet-X account linking to `airdrop/claim-page/`.
2. People sign in with their wallet (EIP-191). The signature is computed in
   the user's browser; only the recovered address is recorded.
3. `airdrop/claim-builder.js` builds a candidate list from the tweet's
   engagers; the claim page fills in the `{xHandle, wallet, signature}`
   triples; you (or a separate audited distributor) batch-transfers the
   token from your issuer wallet to the verified addresses.

The script does **not** sign or send anything on-chain. The only thing it
does on-chain is read public Basescan metadata.

## Safety notes (please read before deploying)

- **Testnet first.** Base Sepolia has its own B20 factory address; confirm
  it before mainnet. The descriptor format in the official docs is the
  reference; the on-chain factory ABI is what governs.
- **Symbol collision.** `LAWB` is already the official meme. The default
  mirror symbol is `LAWBM`. If you want a different one, pass
  `--symbol MIRLAWB` (or whatever) to the mint script. The launchpad
  itself will reject duplicates.
- **Image rights.** The community design was posted publicly on X by
  @Clansy314495853. You should ask the artist before using it as the
  mirror's token image on a mainnet deployment. The default descriptor
  embeds the local PNG; replace it before going live.
- **No automatic fee routing.** B20 has no built-in LP and no built-in
  trading fee. The "100% fees to you" applies only if/when you later
  deploy a hook or a router that routes fees to your address.
- **Bridge mode = dry-run.** Until you pass `--apply`, the bridge just
  prints diffs. When you go to `--apply`, do it in a screen/tmux so the
  loop survives your shell closing.

## Files added on this branch

```
LAWB-MIRROR-DESCRIPTOR.json     # hand-editable reference
mint-lawb-mirror.js             # descriptor builder + self-test
bridge/b20-to-gitlawb.js        # the auto-loop poller
airdrop/claim-builder.js        # X → claim-list
airdrop/claim-page/index.html   # static EIP-191 sign page
state/                          # gitignored; bridge state lives here
```

`LICENSE`: same as the rest of the repo (art + lore CC0 · code MIT).
