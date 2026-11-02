# team-test-memecoin-01 entry

A pump.fun paper-trading bot for the make.fun internal test. The strategy is a **graduation rider**:
it holds a position in a late-curve coin through to the curve's completion, where the replay closes
it at the top, and carries a small filler book that makes cheap round trips so the entry also meets
the fills and distinct-coin guardrails on a window with no completion in it. The strategy note is
[STRATEGY.md](./STRATEGY.md).

## Layout

| path | what it is |
| --- | --- |
| `main.ts` | the bot: entrypoint the replay runs with `node /bot/main.ts` |
| `STRATEGY.md` | what it trades on, how it sizes, when it exits, and what it measured |
| `README.md` | this file |
| `LICENSE` | MIT |
| `COPYING` | the SPDX license declaration, pointing at `LICENSE` |
| `.gitignore` | build and wallet artifacts kept out of the tree |
| `.agentfun/owner.json` | the claim file naming the entrant's wallet |
| `vendor/agentfun-bot.ts` | the kit's TypeScript SDK, vendored verbatim (sha256 `dd9f8647...8e76ee`) |

## Running it locally

The bot reads and writes the `agent-fun/replay/v2` protocol on stdin and stdout, one JSON line per
message. It needs Node 22 or later and nothing installed: the SDK is vendored, and the bot imports
only `./vendor/agentfun-bot.ts`.

Grade it on the kit's dev window (from the kit directory; `<repo>` is this repository):

```
node cli/agentfun.mjs grade-local --kit . --bot <repo> --driver process --worktree
```

Grade it with the transcripts that will be submitted, which adds the build cost and the authored
coverage to the score, then run the site's own pre-submit checks:

```
node cli/agentfun.mjs bundle --repo <repo> --out transcripts.tar.gz [--session <file>...]
node cli/agentfun.mjs grade-local --kit . --bot <repo> --driver process --worktree --bundle transcripts.tar.gz
node cli/agentfun.mjs check --kit . --repo <repo> --worktree --transcripts transcripts.tar.gz
```

The session recorded under a repository worktree that no longer exists is not found by `bundle`'s
working-directory scan, so name it with `--session` when it helped build the entry.

The replay runs the bot as `node /bot/main.ts` with 1 CPU, 1024 MB of memory and a 1800-second wall
budget, twice, and the two action logs must match byte for byte.

## Rules the bot keeps

* Deterministic: no clock, no randomness, no network, no files; the same window produces the same
  action log byte for byte.
* At most 16 orders in a reply, at most 5 open positions, at most 1% of a coin's real SOL reserve
  bought in one reply.
* Orders are sent without explicit client ids; the SDK assigns unique ids that never start with `_`,
  which is reserved for the replay's own closes.

## Where the code comes from

`main.ts` was written for this entry from three graded candidates: the graduation rider (its entry,
sizing, reserve stop and stall exit are the core), the early-flow momentum scalper (the filler's
momentum filter and its 24-slot hold), and the expected-value-map bot (the finding that a round trip
costs about 2.9%, and that refusing a fill saves nothing, which set the stake and the wide
slippage). The riders were then bounded by a fixed capital slice so the filler book always has cash,
and the cost-basis stop was replaced by the reserve stop, whose basis is the entry threshold rather
than the first fill so that the stop line does not move with the entry point.

## License

MIT, copyright 2026 singularitystudiosdev. See [LICENSE](./LICENSE).
