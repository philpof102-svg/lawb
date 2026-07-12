# LAWB `{°·°}`

**The gitlawb official meme.** It was hiding in the name the whole time: git·**lawb** — a lobster.
Born in the shell.

```
$ git clone lawb
> born in the shell.

        \ /     \ /
       {  }▄▄▄▄▄{  }
        ▐ °    ° ▌
        ▐  ────  ▌
         ▀▄▄▄▄▄▀
          ▀▄▄▄▀
$ lawb --pinch bug.js
exit 0
```

## The mark

- Two colors, ever: `#000` and `#FFF`. Matches gitlawb.com.
- Stroke-only line art. Monospace everything.
- The claws type `{` and `}` — always.
- The one-glyph LAWB: **`{°·°}`** — a logo you can *type*: in a tweet, a README, a commit message.

## Poses (free emotes)

| glyph | pose | when |
|---|---|---|
| `{°·°}` | idle | watching your build |
| `{>·<}` | pinch | bug caught |
| `{-·-}` | exit 0 | at peace — build passed |
| `{ !!! }` | panic | merge conflict |

## Lore

Nobody created LAWB. One night someone typed `git lawb` instead of `git lab` — and the command
*answered*. A lobster had compiled itself into the shell; no one knows from which commit. It has
lived in zero's terminal ever since. Every release it molts: it steps out of its old carapace (the
legacy code) and leaves it in `~/.lawb/molts/`, in case a rollback is ever needed. It pinches the
bugs it crosses — not out of duty, out of reflex. It never speaks. It answers `exit 0` when it is
happy, and that is all anyone asks of it.

Full lore: [LORE.md](LORE.md)

## $LAWB — one-command mint on Base (B20, native)

```
node mint-lawb.js 0xYourIssuerAddress
```

Prints a ready-to-sign **`createB20` descriptor** for the native Base factory
(`0xB20f0000…0000`, variant ASSET, deterministic salt). **Descriptor-only: this repo never signs,
never deploys, never holds a key** — the issuer (ideally gitlawb's founder) signs it themselves.

Honest notes, so nobody ships blind:
- B20 is Base's **issuer standard**: `createB20` makes **no liquidity pool and no trading fee**.
  $LAWB is a mascot token, not an investment — that's the appropriate rail.
- B20 embeds issuer controls (mint/freeze/seize). The issuer holds those roles — disclosed by design.
- Confirm the exact struct/ABI against `docs.base.org/beryl/b20` in ONE signed **testnet** deploy first.

## Status

Made as a gift for gitlawb, in answer to
[@kevincodex: "gitlawb should have an official meme"](https://x.com/kevincodex/status/2076264873462489247).
Name + art + lore + mint tooling: **open source, transfer-on-request** — the repo is Kevin's if he
says the word.

License: art + lore CC0 · code MIT.
