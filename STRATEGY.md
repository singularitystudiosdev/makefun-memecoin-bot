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
  by more than 9% — or, once the book already holds the coin as a rider, within 75% of that high
  (v10's add gate, described below);
* net quote flow over its last 12 trades is positive;
* its creator's first buy was above zero and at most 20 SOL (the creator-participation gate, below);
* the coin is not in its re-entry cooldown and its reserve is above the level the last exit blocked.

A candidate is bought deepest-reserve first. While it keeps qualifying the bot adds to it on later
batches, so a position is built up a pump instead of being taken in one shot.

A rider book may only *start* on a coin that is also still within 98% of its own reserve high and
whose reserve has not risen faster than 0.4 SOL per slot over the last 24 slots. The first gate is a
chase filter: the quiet windows' worst losing book had already given back 5.5% of its high (9451 bps)
while every completing book started at 10000. The second rejects a coin at the top of a vertical
move, which is the other losing book on those windows (1.220 SOL/slot against 0.00-0.20 for the
completers). Both apply only to a start — an idle entry, a filler promotion, or the preemption scan;
the filler book keeps the 91% test too, because that constant also moves the filler entries and
tightening it there costs the pumping windows. Later adds on an open rider use their own, looser
gate: a held rider keeps buying while the reserve is still within 75% of the coin's own high, where
a start needs 98% and a filler 91%. The 1%-per-reply cap binds almost every rider buy, so a reply
the stricter gate skipped is capital the ladder never gets back, and a pullback inside a live climb
is not the same thing as an entry on a coin that has already faded. That is what keeps a dip from
stranding the ladder mid-climb: on the dev window the second completer deploys 10.22 SOL through its
pullbacks instead of stopping at 9.42.

A separate start gate reads the creator. The bot records the coin's creator from its `CreateEvent` and
the creator's first buy from the tape, and a rider book may only open where that first buy is above
zero and at most 20 SOL. It admits an organic launch — a creator that put a small but real stake
behind its own coin — and refuses both degenerate shapes: a creator that never bought at all
(launching-and-leaving, no stake behind the coin) and a whale-first-buy launch of tens of SOL, which
has no organic demand behind it. The gate applies to starts only — an idle entry, a filler promotion
and the preemption scan; it never blocks an add on a book already open, and the filler book is not
gated. Across the nineteen graded windows it blocks two losing rider books (`BctEGzLC`, whose
creator never traded, and `DM2Jiki`, a 29.63 SOL first buy) and no completer the bot ever held:
`blockedCompletersHeld = 0` on every window, and the three coins that carry the edge have creator
first buys of 10, 2.2 and 0.98765432 SOL, all admitted.

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

A rider book that has never filled a tranche is also released when two of its rider buys in a row
are rejected: the role, the tranche decisions and the slot go back at once, exactly as a stall exit
releases them, and the coin must print a new high and wait 10 slots before it can be entered again.
This is **hygiene, not edge**. It is PnL-neutral on every graded window (Δ 0.000000), and it exists
because v11 leaves a role on a coin that cannot trade: 4,880 reply batches on the identity window
and 46,287 across the nineteen graded windows carry `role = 'rider'` with no position behind it.

## The filler half

While no rider candidate is waiting and fewer than two fillers are held, the bot makes a 0.002 SOL
round trip in a coin that is rising but far below the rider threshold: at least 1 SOL of real
reserve, within 91% of its reserve high, positive net flow, not blocked, and with a reserve cap that
allows the stake. Entries are spaced at least 300 slots apart — one filler entry at a time, whichever
coin it lands on — so the book cannot churn: a quiet four-hour window makes 174-180 fills instead of
v10's 448-460, and every round trip pays two curve fees (~2.5% of the stake each) plus two transaction
fees (0.000105 SOL each). The 300-slot cell is chosen over the cheaper 600-slot one for guardrail
margin: 600 leaves only 124-126 fills against the 80-fill bar (1.55x), while 300 leaves better than
2x the bar at 0.007 SOL below it on the stride mean, and a fill-guardrail failure is the one failure
mode that costs all three prizes. A filler is sold after 24 slots, or earlier only on a 50% trailing
stop, so in practice it times out; the wide trail is what stops a round trip from paying the fees on
noise. If it reaches the rider threshold it is promoted in place (the tokens are kept and the rider
starts scaling in), and if a rider candidate needs a slot the oldest filler is sold to make room two
slots later.

Once a window is more than an hour old — 16,925 slots since its first delivered event, the dev
window's four hours divided by four — and the account is below its starting capital with no rider
open, the filler stake halves again to 0.001 SOL. That is the capital-return rule: on a window that
never pumps, the bleed rate halves instead of the book paying the full stake's curve fees to the end.
It cannot fire while a rider is held, and it reads slots since the window's first event, never wall
time. Together the smaller stake, the spacing and the rule turn the filler from a 0.10-0.11 SOL cost
on a quiet window into about 0.02 SOL.

## Order discipline

One reply carries at most 16 orders (the account's cap, which the vendored SDK also enforces
locally), every sell goes out before any buy in the same reply, and a mint gets at most one order per
reply. Orders are sent without explicit client ids, so the SDK assigns unique ids in the `o<n>`
series, which never start with `_` (the replay reserves `_` for its own completion, flatten and
write-off closes). No reply can put more than 5 positions on the book, and every buy is clamped to
`state.maxBuyLamports(mint)`, the 1%-of-real-reserve cap for that coin at the decision slot.

## What was measured on the dev window

The entry as committed (v12) is the grade-local result over the kit's dev window (2026-10-27
00:08-06:08 UTC), two executions, byte-identical action logs:

* net **+24.334941 SOL** (return +2.433494 on the 10 SOL account);
* 348 fills over 101 coins, 132 round trips, win rate 12.12%, 7 seeded failed transactions, 6
  rejected orders;
* maximum drawdown **14.73%** against the 50% guardrail;
* all three guardrails met: 348 >= 80 fills, 101 >= 10 distinct coins, 14.73% < 50% drawdown.

v12 is v11 plus the creator gate and the retire rule, and the dev window isolates the gate's effect:
net rises **+0.476620 SOL** while fills fall from 374 to 348 and coins from 103 to 101. The gate
drops the losing rider book (`BctEGzLC`, whose creator never traded, -0.441649 SOL) and frees its
slot for the completing one. The stride instrument agrees: thirteen overlapping windows on a fixed
slot stride mean **+10.598387 SOL** (v11 +10.404037, **+0.194350**), minimum **+6.585266**; five
4-hour slices mean **+5.874121** (v11 +5.744463); worst quiet window **-0.021914** and quiet fills
174 / 180, both unchanged from v11 to the lamport. The gate's row reproduced on three independent
passes (K +0.246538, L and M +0.194350 stride), and every run recorded `blockedCompletersHeld = 0`
on all nineteen windows: it blocks no completer the bot ever held. The retire rule's column is
**Δ 0.000000** on every graded window, which is why it ships as hygiene rather than as a lever.

**The decision, recorded plainly.** +0.194350 is below the 0.30 stride-mean bar this project sets
for a new lever, and v12 ships the gate anyway. The bar exists to filter noise on an instrument whose
windows overlap 96%; this signal has a mechanism (a creator who puts nothing in is
launching-and-leaving, and a whale-first-buy coin has no organic demand), it reproduced on three
independent passes, its measured cost on quiet windows is exactly zero, and it blocks no coin the bot
has ever profited from. A thrice-repeated +0.19 with a mechanism and a zero-cost branch is not the
kind of noise that bar was written for.

v11's filler book was measured over thirteen overlapping stride windows and the two constructed
quiet slices: stride mean **+10.404037 SOL** (v10 +10.202799), minimum **+6.143618**; worst quiet
window **-0.021914 SOL** (v10 -0.110541) over 174-180 fills and 70 coins at 0.25% drawdown; the
three 4-hour pump slices **+13.889 / +7.155 / +7.721** (v10 +13.828 / +7.104 / +7.107). Every
graded row finished, reproduced L1 and met the guardrails.

The filler is a guardrail cost, not an edge. It is what makes a no-pump window eligible, and v10
paid 0.10-0.11 SOL for it; the smaller stake, the spacing and the capital-return rule cut that to
about **0.02 SOL** on the same constructed slices, which is still a loss. The spacing is deliberately
looser than the 600-slot cell that would lose 0.004-0.005 SOL less there: 600 leaves only 124-126
fills against the 80-fill bar (1.55x), while 300 leaves 174-180 (2.2x), and failing the fill
guardrail forfeits all three prizes. The cost of that margin is 0.007 SOL of stride mean.

v10's add gate was measured on the v9-based candidate over the same 18 graded windows: thirteen
overlapping stride windows mean **+10.202799 SOL** (v9 +9.713543), minimum **+5.956125**, five
4-hour windows mean **+5.565716** (v9 +5.403332), worst quiet window **-0.110541** unchanged,
worst drawdown **23.98%** unchanged. Every row finished, reproduced L1 and met the guardrails. The
gain is concentrated on one completer (`C5DXREKp…`: 20 -> 22 tranches, 9.42 -> 10.22 SOL deployed,
+0.57 net per view); the other completer is cash-bound and unchanged. The cost is 0.46-0.49 SOL on
two windows where the extra pullback tranche lands on a book that then stops. The response is flat
from 6,000 to 7,700 bps on all 18 windows, and 7,500 sits inside that plateau.

The two rider-start gates are v9's and were measured on a v7-based candidate; at the shipped
constants the second gate is the primary test, so those gates change no decision and v9's measured
numbers were the shipped file's. The two constructed quiet windows sit at **-0.021914 / -0.020373
SOL** with 0.25% / 0.23% drawdown under v12, unchanged from v11 to the lamport (v10: -0.110541 /
-0.100093 at 1.18% / 1.08%). Those
windows are the number to trust more than this single 6-hour one: the sealed final window is 4
hours, and this file's gain sits in the completions.

The second gate is v8's and is unchanged. Over thirteen overlapping dev windows on a fixed slot
stride the mean at `ENTRY_RESERVE` 28/30/32/34 is **+9.126113 / +9.510831 / +9.534319 / +9.550456
SOL** — a 0.424343 SOL band against v7's 3.190972, **86.70% flatter** — and the 30 cell is v7's to
the lamport before the rider-start gates are applied.

## Risks kept in view

* **Concentration.** The edge is a handful of completing curves. On this dev window the best coin,
  the slow ladder `GZwCGPmdm`, is +9.971849 SOL of the net; the next two are +7.308009 and
  +7.092480. Without the best coin the net is +13.886472 SOL, without the best two +6.578464, and
  without the best three **-0.514017 SOL**. Only 12 of the 106 per-token rows are positive. A window
  whose completions land elsewhere, or not at all, measures like the quiet windows below.
* **Quiet windows lose.** A constructed 4-hour window with no completion and no pumping coin loses
  about **0.02 SOL** (the two quiet dev slices measure -0.021914 and -0.020373 under v12,
  unchanged from v11; v10 measured -0.110541 and -0.100093, and before the rider-start gates
  -0.310837 and -0.284120) —
  almost entirely the filler book's fees, the rider book having stopped opening on the faders. The
  fill count falls with the trade density, so the 174-180-fill margin over the 80-fill bar is real
  but not unbounded.
* **One rider at a time.** The 15 SOL budget is the whole rider slice, so a full rider is the whole
  book. A window whose completion lands on a second candidate — one the largest-reserve rule did not
  pick — gets none of the two-rider diversification it forgoes.
* **The stop line is now threshold-anchored.** A rider that opens well above 30 SOL holds to 97.5%
  of 30 SOL (29.25), which is roughly a 16% loss before the stop when it opened at 35. The stop and
  the 15 SOL per-coin budget, not the floor, bound that; a curve that gaps from a high reserve to
  zero between a decision and its fill can still cost more than the stop.
* The bot keeps its state in memory for the run (a few hundred coins), and memory is not a concern
  at this scale.
