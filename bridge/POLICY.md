# LAWB bridge — DRY-RUN policy
> Decision tree + locked defaults for `bridge/b20-to-gitlawb.js`.

## TL;DR
**`--dry-run` is the default. ALWAYS.** The bridge will only invoke `gl
mirror` when **both** `--apply` and `LAWB_BRIDGE_APPLY=1` are present. This
is enforced in code (see `parseArgs` + `canApply` in `b20-to-gitlawb.js`).

## Why double-gated?
A single `--apply` flag is too easy to type by reflex in a long tmux
session. An env var on top means that an accidental copy-paste of `--apply`
into a script without the env var still degrades to a no-op. The env var
is the "I am consciously leaving the safe path" signal.

## Decision tree
```
                                ┌────────────────────────────┐
                                │  user types --apply ?      │
                                └─────────────┬──────────────┘
                                              │
                                no ◀──────────┴────────────▶ yes
                                 │                            │
                                 ▼                            ▼
                          DRY-RUN (default)         user typed --apply
                          print diffs only          AND set LAWB_BRIDGE_APPLY=1 ?
                                                           │
                                              no ◀─────────┴──────────▶ yes
                                               │                          │
                                               ▼                          ▼
                                        still DRY-RUN            APPLY (real)
                                        (print "ignored          run `gl mirror`
                                         --apply: env var         on change
                                         not set")              (loop continues)
```

## What each side sees
| Mode | Sees diffs? | Touches `state/`? | Calls `gl mirror`? |
|---|---|---|---|
| DRY-RUN (default) | yes | yes (last-snapshot only, no tx) | no |
| DRY-RUN with `--apply` but no env | yes | yes | **no** (and a warning is printed) |
| APPLY (both flags set) | yes | yes | yes (on change) |

## How to enter APPLY mode (intentional)
```sh
export LAWB_BRIDGE_APPLY=1     # acknowledge: "yes, I want this to actually mirror"
node bridge/b20-to-gitlawb.js --apply --once
# then, for the loop:
node bridge/b20-to-gitlawb.js --apply --interval 60
```

To forget on purpose, `unset LAWB_BRIDGE_APPLY` — the bridge goes back to
DRY-RUN even with `--apply` set.

## What is the role of `gl mirror`?
`gl mirror` is gitlawb's own CLI; it uses gitlawb's identity (a key the
**human** already controls outside this repo). The bridge NEVER holds or
imports that key — it just shells out. So "APPLY" here means "we trust
`gl mirror` to act on our behalf using the key `gl` already has." That
trust boundary is documented in `b20-to-gitlawb.js` and reinforced by the
NO-SIGNER surface check in `--selftest`.

## What this is NOT
This is NOT a deploy policy. The deploy itself (`createB20` on Base) is
handled by `bridge/deploy-b20-mirror.js` (no-key, no-broadcast; the human
takes the sign-ready envelope to launch.o1.exchange or their wallet). See
`POLICY.md` of that script for its own gates.

## Tests
`node --test bridge/b20-to-gitlawb.test.js` includes a policy test that
fails if `--apply` is no longer double-gated, or if the default mode
drifts away from DRY-RUN. See `policy: --apply requires env var` and
`policy: default mode is dry-run`.
