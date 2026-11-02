# Strategy: graduation rider with guardrail fillers

This one-pager is the strategy note for the entry: what the bot trades on, how it sizes, and when it
exits. Everything below is decided from the replay protocol's own messages (hello, batch events,
marks, fills and the account); the bot never reads a clock, a random source, the network or a file.

## The idea

On a pump.fun bonding curve almost all of the payoff in a window arrives in one event: the curve
completes, the replay force-closes a position at the completing trade's reserves (the top of the
curve), and a position bought at R SOL of real reserve is worth about
`((30 + 85) / (30 + R))^2` before curve fees. Two consequences shape the book:

1. The bot wants tokens in a coin that is climbing near the top of its curve, and it wants to still
   be holding them when that climb finishes.
2. A window can contain no completion at all, so the bot also needs a second, cheap job that keeps
   the guardrails satisfied (at least 80 fills over at least 10 coins, drawdown under 50%) without
   handing back the value of a good window.

The book does those two jobs at once: a rider half that takes the completion exposure, and a filler
half that makes small round trips in coins far below the rider threshold.

## What the rider trades on

The bot follows every delivered coin's real SOL reserve, the highest reserve that coin has shown,
the slot of its latest real-reserve high on the market tape (the stall clock), and the signed quote
flow of its last 12 trades. A coin becomes a rider candidate on the batch being answered when all of
these hold:

* its real SOL reserve is at least 30 SOL (it is already late up the curve);
* the reserve is still within 91% of the coin's own reserve high, i.e. the coin has not rolled over
  by more than 9%;
* net quote flow over its last 12 trades is positive;
* the coin is not in its re-entry cooldown and its reserve is above the level the last exit blocked.

A candidate is bought deepest-reserve first. While it keeps qualifying the bot adds to it on later
batches, so a position is built up a pump instead of being taken in one shot.

A rider book may only *start* on a coin that is also still within 98% of its own reserve high and
whose reserve has not risen faster than 0.4 SOL per slot over the last 24 slots. The first gate is a
chase filter: the quiet windows' worst losing book had already given back 5.5% of its high (9451 bps)
while every completing book started at 10000. The second rejects a coin at the top of a vertical
move, which is the other losing book on those windows (1.220 SOL/slot against 0.00-0.20 for the
completers). Both apply only to a start — an idle entry, a filler promotion, or the preemption scan;
later adds on an open rider keep the shipped 91% test, and the filler book keeps it too, because
that constant also moves the filler entries and tightening it there costs the pumping windows.

A second entry gate keeps the entry price from following the threshold up. A coin that has already
run to 30 SOL of real reserve — the shipped threshold, a fixed floor rather than a share of the
threshold being used — and is still within 91% of its own reserve high with positive net flow is
entered at that floor even when the primary threshold has been moved above it; nothing under 30 SOL
is entered, and a tranche the gate buys below the threshold anchors its stop just under its own
entry reserve (99% of it) rather than at the threshold, which would sit above the fill and close the
book on the next batch. At the shipped 30 SOL the gate is exactly the primary test and changes no
decision; its value is the entry floor when the sealed window's reserves run higher than ours.

## How the rider sizes

Each reply buys at most `state.maxBuyLamports(mint)`, the account's cap of 1% of the coin's real SOL
reserve per reply, and at most what is left of two budgets:

* 15 SOL of total spend on any one coin — the whole rider slice, so the book holds one rider at a
  time and puts the entire slice into the largest-reserve candidate;
* 15 SOL across the whole rider book at once (held riders plus rider buys still in flight), i.e.
  exactly one coin budget. This is a fixed slice of commitment: the account's growth never raises
  it, and a buy that would cross it is not sent.

The account holds 10 SOL, so the slice is a ceiling on commitment rather than cash on hand; what the
cash leaves after one buy is what limits the next. Spending the slice on one coin at a time is
deliberate: the completing ladder is where the window's expectation lives, and splitting 15 SOL
into two 7.5 SOL riders buys less of the coin that is most likely to finish. The cost of that choice
is measured below, under **Risks kept in view**.

The rider book also stops spending at a 0.25 SOL fee buffer plus 0.10 SOL kept for filler orders, so
a rider can never take the cash a filler round trip needs. At most three rider positions are held,
inside the account's five-position cap, which leaves room for the two fillers; with one coin budget
equal to the slice, a full rider is normally the whole book.

## When the rider exits

A rider is held toward completion. It is sold before then only by one of four guards:

| guard | rule | purpose |
| --- | --- | --- |
| reserve stop | real reserve at 97.5% of 30 SOL, the entry threshold | sells a retrace below the lowest reserve the rider's own ladder can have been filled at |
| reserve floor | real reserve under 90% of the reserve the rider entered on | defence in depth: unreachable while the stop basis exists, and covers a promoted filler before its first rider tranche fills |
| crash guard | price under 50% of the high the position has reached since entry | defence in depth: a disaster stop for a market with no stop-limit orders |
| stall | no new real-reserve high on the market tape for 225 slots | frees the slot from a coin that has stopped pumping |

The reserve stop's basis is the entry threshold, not the reserve the book happened to get in at. A
rider buy is only decided while the recorded reserve is at or above 30 SOL, so 30 SOL is the lowest
reserve any filled rider tranche can be decided at; booking the basis there makes the stop line a
fixed 97.5% of it. The alternative — the first filled tranche's decision reserve — moves the line
with the entry point: a rider that can only open at 35 SOL then stops out at 34.3 while the same
ladder is still building, which turns a two-SOL change of the entry threshold into several SOL of
mean on the dev windows. The threshold basis makes the entry point on the ladder not matter to the
stop, and that is the risk it removes.

The stall clock counts slots since the last new real SOL reserve printed by a `TradeEvent`, and it is
reset to the entry slot when a rider begins. It never reads a mark: a mark carries the bot's own
impact, so folding marks in would let the bot's own fills restart the timer, and the stall exit could
never fire on a coin the bot was still buying.

After a reserve-stop or floor exit the coin is blocked until its reserve is 5% above the exit reserve
and for 50 slots. After a crash exit it is blocked for 20 slots and needs a 2% higher reserve; after
a stall a new high and 10 slots are enough to come back. Sells go out with slippage at the maximum,
because the position is leaving whatever the fill price turns out to be.

## The filler half

While no rider candidate is waiting and fewer than two fillers are held, the bot makes one 0.005 SOL
round trip per batch in a coin that is rising but far below the rider threshold: at least 1 SOL of
real reserve, within 91% of its reserve high, positive net flow, not blocked, and with a reserve cap
that allows the stake. A filler is sold after 24 slots, or earlier only on a 50% trailing stop, so
in practice it times out; the wide trail is what stops a round trip from paying the fees on noise.
If it reaches the rider threshold it is promoted in place (the tokens are kept and the rider starts
scaling in), and if a rider candidate needs a slot the oldest filler is sold to make room two slots
later. Each round trip costs a few hundred thousand lamports in fees and transaction fees; the filler
book is what supplies the fills and distinct coins the guardrails ask for on a window with no
completion in it.

## Order discipline

One reply carries at most 16 orders (the account's cap, which the vendored SDK also enforces
locally), every sell goes out before any buy in the same reply, and a mint gets at most one order per
reply. Orders are sent without explicit client ids, so the SDK assigns unique ids in the `o<n>`
series, which never start with `_` (the replay reserves `_` for its own completion, flatten and
write-off closes). No reply can put more than 5 positions on the book, and every buy is clamped to
`state.maxBuyLamports(mint)`, the 1%-of-real-reserve cap for that coin at the decision slot.

## What was measured on the dev window

The entry as committed (v9) is the grade-local result over the kit's dev window (2026-10-27
00:08-06:08 UTC), two executions, byte-identical action logs:

* net **+23.376588 SOL** (return +2.337659 on the 10 SOL account), 90% interval **+5.864936 ..
  +48.220047 SOL** (1,000 token-bootstrap resamples);
* 742 fills over 152 coins, 318 round trips, win rate 17.92%, 21 seeded failed transactions, 4
  rejected orders;
* maximum drawdown **14.80%** against the 50% guardrail;
* all three guardrails met: 742 >= 80 fills, 152 >= 10 distinct coins, 14.80% < 50% drawdown.

The two rider-start gates were measured on a v7-based candidate; at the shipped constants the
second gate is the primary test, so that candidate and v9 produce byte-identical action logs on this
window (sha256 `f37dc317…`) and the same net to the lamport. On
the thirteen overlapping dev windows on a fixed slot stride the candidate's mean is **+9.713543 SOL**
against v8's +9.510831, its minimum +5.621829, and the worst drawdown **23.98%**; over the five
4-hour dev windows the mean is **+5.403332** against +5.209767. The two constructed quiet windows
improve from **-0.310837 / -0.284120** to **-0.110541 / -0.100093 SOL**, their drawdown falling to
1.18% / 1.08%. Those windows are the number to trust more than this single 6-hour one: the sealed
final window is 4 hours, and this file's gain sits in the completions.

The second gate is v8's and is unchanged. Over thirteen overlapping dev windows on a fixed slot
stride the mean at `ENTRY_RESERVE` 28/30/32/34 is **+9.126113 / +9.510831 / +9.534319 / +9.550456
SOL** — a 0.424343 SOL band against v7's 3.190972, **86.70% flatter** — and the 30 cell is v7's to
the lamport before the rider-start gates are applied.

## Risks kept in view

* **Concentration.** The edge is a handful of completing curves. On this dev window the best coin,
  the slow ladder `GZwCGPmdm`, is +9.967045 SOL of the net; the next two are +7.314071 and
  +6.504890. Without the best coin the net is +13.409543 SOL, without the best two +6.095472, and
  without the best three **-0.409418 SOL**. Only 25 of the 155 per-token rows are positive. A window
  whose completions land elsewhere, or not at all, measures like the quiet windows below.
* **Quiet windows lose.** A constructed 4-hour window with no completion and no pumping coin loses
  about **0.10-0.11 SOL** (the two quiet dev slices measure -0.110541 and -0.100093; before the
  rider-start gates they measured -0.310837 and -0.284120) — now almost entirely the filler book's
  fees, the rider book having stopped opening on the faders. The fill count falls with the trade
  density, so the guardrail margin is real but not unbounded.
* **One rider at a time.** The 15 SOL budget is the whole rider slice, so a full rider is the whole
  book. A window whose completion lands on a second candidate — one the largest-reserve rule did not
  pick — gets none of the two-rider diversification it forgoes.
* **The stop line is now threshold-anchored.** A rider that opens well above 30 SOL holds to 97.5%
  of 30 SOL (29.25), which is roughly a 16% loss before the stop when it opened at 35. The stop and
  the 15 SOL per-coin budget, not the floor, bound that; a curve that gaps from a high reserve to
  zero between a decision and its fill can still cost more than the stop.
* The bot keeps its state in memory for the run (a few hundred coins), and memory is not a concern
  at this scale.
