// Graduation rider v9: hold a late-curve coin through to its bonding-curve completion, and carry a
// small filler book that makes cheap round trips so the entry still meets the fill and distinct-coin
// guardrails on a window with no completion in it. It is v8 plus two rider-start gates, described
// below: a rider book may only open on a coin still within 2% of its own reserve high and whose
// climb has not gone vertical, while an open rider keeps adding under the shipped rules.
//
// The book has two jobs. The first is to be holding tokens in a coin when its bonding curve
// completes: a rider that enters a curve with R SOL of real reserves and is force-closed at the top
// collects about ((30 + 85) / (30 + R))^2 before fees, and that single exit is where almost all of
// the window's positive expectation lives. The second is to make the guardrails (at least 80 fills
// over at least 10 coins, drawdown under 50%) on a window with no completion in it, at a cost small
// enough that it cannot turn a quiet window into a collapse.
//
// The rider reads the protocol's own state: every delivered coin's real SOL reserve, the high that
// reserve has set, and the signed quote flow of its last few trades. It starts buying when the
// reserve is at ENTRY_RESERVE or more, still within NEAR_HIGH_BPS of the coin's own reserve high,
// and the recent net flow is buying. A book may only *start* there if the coin is also within
// RIDER_MIN_NEAR_HIGH_BPS of its high and has not risen faster than RIDER_MAX_VELOCITY_24 per slot
// over the last RIDER_VELOCITY_SLOTS slots: the filler book keeps the looser NEAR_HIGH_BPS gate,
// while the rider declines to open on a coin that has already given back more than 2% of its high
// or that spiked more than 0.4 SOL per slot over the last 24 slots. Both are chase filters.
// The second entry gate below admits the same coin at GATE_RESERVE when ENTRY_RESERVE has been
// moved above it, so a threshold step selects the coins that must still be bought at it without
// moving the price the book gets in at. The rider keeps adding on later batches
// while the test stays true, but never spends past the account's per-reply cap on a coin, never more
// than COIN_BUDGET on one coin, and never past the rider slice: a fixed part of the capital is the
// most the rider book may commit, so the rest is always there for the filler round trips and for
// transaction fees.
//
// A rider is held toward completion and sold early only by four guards: the recorded real reserve
// falls to RESERVE_STOP_BPS of its booked stop basis, the real reserve falls under
// RESERVE_FLOOR_BPS of the reserve the rider entered on, the price gives back the crash guard's
// share of its post-entry high, or the recorded reserve has made no new high on the market tape for
// STALL_SLOTS slots (which frees the slot from a coin that has stopped pumping).
//
// The stop line's basis is the entry threshold, and the second gate is what makes that hold when
// the threshold moves. A primary rider buy is decided at or above ENTRY_RESERVE, so booking the
// basis there puts the stop at a fixed 97.5% of the threshold and the entry point on the ladder no
// longer moves it. That is not enough on its own: the line still rises with the threshold, and a
// window whose completer clears a raised threshold before the book is free is entered at that
// higher reserve and gives back most of the completion multiple. On the dev windows the v7 response
// is +9.510831 / +9.031509 / +6.319859 at ENTRY_RESERVE 30/32/34: the 30→32 step costs 0.479322 and
// 32→34 costs a further 2.711650, and none of it is the stop itself (switching the reserve stop off
// entirely at 34 measures +6.443848, a 0.124 SOL difference).
//
// The second gate is the fix. A coin that has already run to GATE_RESERVE -- the shipped threshold,
// a fixed floor rather than a share of ENTRY_RESERVE -- and is still within NEAR_HIGH_BPS of its own
// reserve high with net buying on the tape may be bought back at that floor even when
// ENTRY_RESERVE is above it. The threshold still selects coins: nothing under GATE_RESERVE is
// entered, and a coin that has not yet run to the floor is governed by the primary test. What the
// gate removes is the threshold's pull on the entry price. With it the same response measures
// +9.126113 / +9.510831 / +9.534319 / +9.550456 at 28/30/32/34 (stop 9750): a 0.424343 SOL band
// where v7's is 3.190972, and at the shipped 30 cell that gate alone changed nothing to the lamport
// or to the action log.
//
// How the basis is booked: on the FILL, not on the decision. A rider buy records its batch slot and
// the reserve it was decided at in the coin's `riderDecisions` map; when it fills and the coin has no
// basis yet, the basis is ENTRY_RESERVE for a primary tranche and GATE_STOP_ANCHOR_BPS (99%) of that
// decision reserve for one the gate bought below the threshold. The max() form of that anchor -- 99%
// of the fill floored at ENTRY_RESERVE -- cannot be used for a below-threshold entry: the floor
// would sit above the fill and the stop would close the book on the next batch, which measured
// -0.164795 SOL of stride mean and a 75.64% drawdown at 34. A rejected or failed tranche spends its
// slot but never books the basis, so a refused first ticket cannot start the stop clock. A filler
// promoted to rider books no basis until a rider tranche fills (its earlier fills happened while it
// was a filler, so their decided slots are not in the map), so until then it is held by the floor,
// the crash guard and the stall clock only. A fresh rider always books on its first filled tranche.
//
// The slots the riders do not need carry a filler: a 0.005 SOL round trip on a coin that is rising
// but still far under the rider threshold, held at most FILLER_MAX_HOLD slots. Each round trip costs
// a few hundred thousand lamports, and the fills and distinct coins it buys are what keep the entry
// eligible on a window that never completes a curve. A filler that reaches the rider threshold is
// promoted in place, and a filler gives its slot up at once when a rider candidate would otherwise
// go unfilled.
//
// Measured on the dev windows through the replay: thirteen overlapping dev windows on a fixed slot
// stride mean +9.713543 SOL with a worst drawdown of 23.98% (v8: +9.510831); the five-window dev
// set +5.403332 mean (v8: +5.209767); the worst constructed quiet window -0.110541 SOL against
// v8's -0.310837; the 6-hour dev window +23.376588 SOL over 742 fills and 152 coins at 14.80% max
// drawdown. The rider-start gates are v9's change and were measured on the v7-based candidate; at
// the shipped constants the second gate is dormant, so v9 and that candidate produce byte-identical
// action logs on the identity window and the same net to the lamport. The threshold response is
// v8's, unchanged: +9.126113 / +9.510831 / +9.534319 / +9.550456 at ENTRY_RESERVE 28/30/32/34
// (stop 9750), a 0.424343 SOL band where v7's is 3.190972 -- 86.70% flatter. Above the shipped 30
// SOL the gate enters a coin that has already run to 30 SOL at that floor, with its stop anchored
// at 99% of its own entry reserve. STRATEGY.md says what that trades and where it loses.
//
// Decisions come only from the protocol's hello, batch events, marks, fills and account: no clock,
// no randomness, no network, no files. Fills are echoed to stderr for diagnostics; no decision ever
// reads that output.
import {
  BPS,
  LAMPORTS_PER_SOL,
  runBot,
  type Batch,
  type BotState,
  type OrderInput,
} from './vendor/agentfun-bot.ts';

const SOL = LAMPORTS_PER_SOL;

// ---------------------------------------------------------------- rider settings
/**
 * Real SOL reserve the primary rider test needs before it may start buying, and the basis of the
 * reserve stop for a primary tranche: every primary rider tranche is decided at a reserve at or
 * above this one, so this is the lowest reserve that ladder can be filled at, and its stop line is
 * RESERVE_STOP_BPS of it independent of where on the ladder the book got in. A tranche the second
 * gate buys below this floor books GATE_STOP_ANCHOR_BPS of its own decision reserve instead, because
 * a basis above the fill would close the book on the next batch.
 */
const ENTRY_RESERVE = 30n * SOL;
/**
 * The second gate's entry floor: a coin that has already run to this reserve, is still within
 * NEAR_HIGH_BPS of its own reserve high and whose tape is net buying may be bought back at it even
 * when ENTRY_RESERVE sits above it. It is the shipped threshold, not a second number to tune: at the
 * shipped constants the gate is exactly the primary entry test and changes nothing, and its only
 * effect is to keep the entry price from drifting up when ENTRY_RESERVE is moved above it.
 */
const GATE_RESERVE = 30n * SOL;
/**
 * The reserve must still be this share (bps) of the coin's own reserve high: a coin that has already
 * given back more than 9% of its reserve high is not a live pump, and those entries are the ones
 * that lose, while a tighter filter starts dropping coins that are still being bought.
 */
const NEAR_HIGH_BPS = 9_100n;
/** Slots the rider start gate's reserve-velocity window looks back over. */
const RIDER_VELOCITY_SLOTS = 24;
/**
 * A rider book may only start (or a filler be promoted) when the reserve is still this share (bps)
 * of the coin's own reserve high. On the dev windows every completing coin entered at 10000 bps,
 * while the fader the quiet windows lose on entered at 9451, having already given back 5.5% of its
 * high. 9800 is the middle of the flat 9700-9950 plateau. The filler book keeps NEAR_HIGH_BPS: that
 * shared constant also moves the filler entries, and doing so costs the pumping windows.
 */
const RIDER_MIN_NEAR_HIGH_BPS = 9_800n;
/**
 * A rider book may only start when the signed reserve change per slot over the last
 * RIDER_VELOCITY_SLOTS slots is at most this many lamports. A coin that gained more than about
 * 9.6 SOL of reserve in 24 slots is at the top of a vertical move, and a rider opening into it is
 * buying the fade. 0.4 SOL/slot is the middle of the flat 0.3-1.0 plateau on the dev windows.
 */
const RIDER_MAX_VELOCITY_24 = 400_000_000n;
/**
 * Signed quote flow over the last FLOW_TRADES trades, in lamports, needed to start or add. 0 means
 * the tape must be net buying but a large net flow is not required: the 0.4 SOL threshold skipped
 * riders that were still being bought.
 */
const MIN_INFLOW = 0n;
/** Trades the inflow window looks back over. */
const FLOW_TRADES = 12;
/**
 * Most the rider book ever commits at once, across every rider coin and pending rider buy. It is a
 * fixed slice, not a limit the account's growth can raise, and it is charged before the fee buffer
 * and the filler reserve, so a filler round trip can always be paid for. At COIN_BUDGET = RIDER_SLICE
 * the slice is exactly one coin budget: the book holds one rider at a time by construction.
 */
const RIDER_SLICE = 15n * SOL;
/**
 * Most the rider book commits to a single coin: the whole RIDER_SLICE, so the book holds one rider
 * at a time and puts the entire slice into the largest-reserve candidate, the one most likely to be
 * the ladder that completes. The price is concentration: a window whose completion lands on a coin
 * the largest-reserve rule did not pick loses the two-rider split it forgoes.
 */
const COIN_BUDGET = 15n * SOL;
/** Smallest rider buy worth its transaction fee. */
const MIN_RIDER_BUY = SOL / 50n;
/**
 * Sell a rider when its recorded real SOL reserve falls to this share (bps) of its booked basis:
 * ENTRY_RESERVE for a primary tranche, 99% of the decision reserve for a second-gate tranche. The
 * 97.5-99% band is flat, and the bottom of it keeps the widest plateau: the entry threshold can move
 * two SOL either way without the stop line cutting into a ladder that is still building.
 */
const RESERVE_STOP_BPS = 9_750n;
/**
 * A rider tranche the second gate bought below ENTRY_RESERVE books its stop basis at this share (bps)
 * of its decision reserve instead of at ENTRY_RESERVE, which would sit above the fill and close the
 * book on the next batch. 99% is a slightly wider stop than a basis at the fill itself: the gate's
 * entry is the one the threshold did not license, so it is the one held closest.
 */
const GATE_STOP_ANCHOR_BPS = 9_900n;
/**
 * Sell a rider when the real reserve is this share (bps) of the reserve it entered on. The reserve
 * stop above fires first whenever the rider booked a basis, so this is defence in depth for the one
 * case that stop cannot cover: a promoted filler before its first rider tranche fills. 90% is the
 * middle of a band in which the floor's own value barely moves the result.
 */
const RESERVE_FLOOR_BPS = 9_000n;
/** Sell a rider when its price gives back this share (bps) of its post-entry high. */
const CRASH_GUARD_BPS = 5_000n;
/**
 * Sell a rider whose recorded reserve has made no new high on the market tape for this many slots.
 * The clock is fed only by a TradeEvent's real_quote_reserves (see observe), so the bot's own fills
 * cannot restart it. Short enough to free the slot from a coin that has stopped pumping, long enough
 * that a ladder pausing between adds is not sold.
 */
const STALL_SLOTS = 225;
/** Rider buys allow this much drift between the decision and the fill two slots later. */
const RIDER_BUY_SLIPPAGE_BPS = 3_000;
/** Rider positions held at once, inside the account's position cap. */
const MAX_RIDERS = 3;

// ---------------------------------------------------------------- filler settings
/** Stake of one guardrail round trip: half the old 0.01 SOL, which halves the filler bleed. */
const FILLER_STAKE = SOL / 200n;
/** Longest a filler is held before it is sold. */
const FILLER_MAX_HOLD = 24;
/**
 * Sell a filler when its price gives back this share (bps) of its post-entry high. A round trip
 * stopped out on a 15% giveback was paying the fees on noise; at 50% the filler almost always times
 * out instead, which is what a guardrail round trip wants.
 */
const FILLER_TRAIL_BPS = 5_000n;
/** A filler candidate must already hold this much real SOL reserve. */
const FILLER_MIN_RESERVE = SOL;
/** Filler buys allow this much drift between the decision and the fill. */
const FILLER_BUY_SLIPPAGE_BPS = 2_500;
/** Filler positions held at once. */
const MAX_FILLERS = 2;
/** Cash the riders may not touch, kept so a filler order can always be paid for. */
const FILLER_CASH_RESERVE = SOL / 10n;

// ---------------------------------------------------------------- shared settings
/** Sells are never refused: the position is leaving whatever the fill price. */
const SELL_SLIPPAGE_BPS = 10_000;
/** Slots to wait after an exit before the same coin is entered again. */
const COOLDOWN_SLOTS = 50;
/** Cash held back for transaction fees. */
const FEE_BUFFER = SOL / 4n;

type Role = 'idle' | 'filler' | 'rider';

/** One reserve observation, for the rider start gate's velocity window. */
interface ReservePoint {
  readonly slot: number;
  readonly reserve: bigint;
}

interface Coin {
  readonly mint: string;
  /** CompleteEvent arrived: no more orders on it. */
  complete: boolean;
  /** Latest known real SOL reserve (lamports) and the slot it follows. */
  reserve: bigint;
  reserveSlot: number;
  /** Highest real SOL reserve seen. */
  reserveHigh: bigint;
  /** Latest virtual reserves; vq / vt is the price. */
  vq: bigint;
  vt: bigint;
  /**
   * Highest real SOL reserve a TradeEvent has printed since the rider began, and the slot of that
   * high: the stall clock. Marks are deliberately not folded in here -- a mark carries the bot's
   * own impact, so counting it would let the bot's fills restart its own stall timer, and the clock
   * starts at the entry slot rather than at the coin's first delivery.
   */
  runHighReserve: bigint;
  runHighSlot: number;
  /** Signed quote flow over the tape window (buys positive, sells negative). */
  inflow: bigint;
  /** Ring buffer backing inflow. */
  tape: bigint[];
  /** What the bot is doing in this coin. */
  role: Role;
  /**
   * Lamports the rider's filled buys have actually spent on this coin since it began. Orders still
   * in flight are added on top from the account's pending list, so a refused order never keeps a
   * budget it did not spend and is retried on a later batch.
   */
  riderSpent: bigint;
  /** Reserve and slot when the rider started (promotion included). */
  entryReserve: bigint;
  entrySlot: number;
  /**
   * The reserve stop's basis, booked by the first rider buy that FILLS and 0n until then:
   * ENTRY_RESERVE for a primary tranche, or GATE_STOP_ANCHOR_BPS of the decision reserve for a
   * tranche the second gate bought below the threshold. It never moves during a book.
   */
  stopReserve: bigint;
  /**
   * Batch slot -> the reserve the rider buy was decided at, for the rider buys still in flight. A
   * fill whose `decided_slot` is in this map is a rider tranche, and the only kind of fill that may
   * book the stop basis; the stored reserve is what a second-gate tranche anchors its stop on. An
   * entry is dropped when its order resolves and the map is cleared on begin and on exit, so it only
   * ever holds this coin's unresolved rider tickets.
   */
  riderDecisions: Map<number, bigint>;
  /** Highest price since the rider started, as a rational. */
  runVq: bigint;
  runVt: bigint;
  /** Earliest slot the coin may be entered again, and the reserve it must clear to be. */
  nextEntrySlot: number;
  blockedAtOrBelow: bigint;
  /**
   * Reserve observations over roughly the last RIDER_VELOCITY_SLOTS slots. The rider start gate
   * reads them to measure how fast the reserve has been rising; no exit decision reads this.
   */
  reserveTrail: ReservePoint[];
}

const coins = new Map<string, Coin>();

function coinFor(mint: string, slot: number, vq: bigint, vt: bigint): Coin {
  const existing = coins.get(mint);
  if (existing !== undefined) return existing;
  const fresh: Coin = {
    mint,
    complete: false,
    reserve: 0n,
    reserveSlot: slot,
    reserveHigh: 0n,
    vq,
    vt: vt > 0n ? vt : 1n,
    runHighReserve: 0n,
    runHighSlot: slot,
    inflow: 0n,
    tape: [],
    role: 'idle',
    riderSpent: 0n,
    entryReserve: 0n,
    entrySlot: -1,
    stopReserve: 0n,
    riderDecisions: new Map(),
    runVq: 0n,
    runVt: 1n,
    nextEntrySlot: 0,
    blockedAtOrBelow: 0n,
    reserveTrail: [],
  };
  coins.set(mint, fresh);
  return fresh;
}

/** True when a / b is above c / d, for positive denominators. */
function priceAbove(a: bigint, b: bigint, c: bigint, d: bigint): boolean {
  return a * d > c * b;
}

/** Value in lamports of `tokens` sold into the curve's current virtual reserves, gross of fees. */
function sellProceeds(tokens: bigint, vq: bigint, vt: bigint): bigint {
  return vt + tokens === 0n ? 0n : (tokens * vq) / (vt + tokens);
}

/** Fold one observation of a coin's reserves and price into its record. */
function absorb(c: Coin, reserve: bigint, vq: bigint, vt: bigint, slot: number, signed: bigint | null): void {
  if (slot >= c.reserveSlot) {
    c.reserve = reserve;
    c.reserveSlot = slot;
  }
  if (reserve > c.reserveHigh) c.reserveHigh = reserve;
  // Keep one reserve observation per slot for the rider start gate's velocity window. The trail is
  // bounded below and never feeds a sell.
  const trailHead = c.reserveTrail[c.reserveTrail.length - 1];
  if (trailHead === undefined || trailHead.slot < slot || trailHead.reserve !== reserve) {
    c.reserveTrail.push({ slot, reserve });
    // The cap is in observations, not slots: a busy coin prints many reserve changes per slot, so a
    // trail narrower than a few hundred entries can lose the observation 24 slots back and silently
    // switch the gate off. 512 entries is a few hundred KB across the whole table at most.
    if (c.reserveTrail.length > 512) c.reserveTrail.shift();
  }
  if (vt > 0n) {
    c.vq = vq;
    c.vt = vt;
  }
  if (signed !== null) {
    c.tape.push(signed);
    c.inflow += signed;
    if (c.tape.length > FLOW_TRADES) c.inflow -= c.tape[c.tape.length - FLOW_TRADES - 1] ?? 0n;
    if (c.tape.length > FLOW_TRADES * 2) c.tape = c.tape.slice(-FLOW_TRADES);
  }
}

/**
 * Signed reserve change per slot over the last RIDER_VELOCITY_SLOTS slots: the latest observation at
 * or before slot - RIDER_VELOCITY_SLOTS against the current reserve. 0n when the coin has no
 * observation that old, so a young coin is never gated by a window it cannot have.
 */
function reserveVelocity(c: Coin, slot: number): bigint {
  const horizon = slot - RIDER_VELOCITY_SLOTS;
  let past: ReservePoint | null = null;
  for (const p of c.reserveTrail) {
    if (p.slot <= horizon && (past === null || p.slot > past.slot)) past = p;
  }
  if (past === null || slot <= past.slot) return 0n;
  return (c.reserve - past.reserve) / BigInt(slot - past.slot);
}

/**
 * The rider start gate: a new book may only open on a coin still within RIDER_MIN_NEAR_HIGH_BPS of
 * its own reserve high whose reserve rose no faster than RIDER_MAX_VELOCITY_24 per slot over the
 * last RIDER_VELOCITY_SLOTS slots. It applies to starts only -- idle entries, filler promotions and
 * the preemption scan -- never to an add on a book already open, which keeps the shipped rules.
 */
function riderStartsWell(c: Coin, slot: number): boolean {
  return (
    c.reserve * BPS >= c.reserveHigh * RIDER_MIN_NEAR_HIGH_BPS &&
    reserveVelocity(c, slot) <= RIDER_MAX_VELOCITY_24
  );
}

/**
 * The rider entry test, shared by entries, adds, promotions and the preemption scan. Two paths: the
 * primary one at ENTRY_RESERVE, and the second gate at GATE_RESERVE for a coin that has already run
 * to that floor and is still near its own high. At the shipped constants (both 30 SOL) the two paths
 * are the same test, so the gate is what makes the test hold when ENTRY_RESERVE is moved above the
 * floor. The final clause is the rider start gate: it applies to a book that is not open yet, while
 * an open rider keeps adding under the shipped rules alone.
 */
function riderQualifies(c: Coin, slot: number): boolean {
  const atPrimary = c.reserve >= ENTRY_RESERVE;
  const atGate = c.reserve >= GATE_RESERVE && c.reserveHigh >= GATE_RESERVE;
  return (
    !c.complete &&
    (atPrimary || atGate) &&
    c.reserve * BPS >= c.reserveHigh * NEAR_HIGH_BPS &&
    c.inflow > MIN_INFLOW &&
    slot >= c.nextEntrySlot &&
    c.reserve > c.blockedAtOrBelow &&
    (c.role === 'rider' || riderStartsWell(c, slot))
  );
}

/** Begin (or restart) the rider bookkeeping for a coin on this decision. */
function beginRider(c: Coin, slot: number): void {
  c.role = 'rider';
  c.riderSpent = 0n;
  c.entryReserve = c.reserve;
  c.entrySlot = slot;
  c.stopReserve = 0n;
  c.riderDecisions.clear();
  c.runHighReserve = c.reserve;
  c.runHighSlot = slot;
  c.runVq = c.vq;
  c.runVt = c.vt > 0n ? c.vt : 1n;
}

/** Equity after curve fees, for the stderr diagnostic only. */
function equity(state: BotState): bigint {
  let total = state.cash;
  for (const [mint, holding] of state.positions) {
    const curve = state.curves.get(mint);
    if (curve === undefined || curve.virtual_token_reserves === 0n) continue;
    const gross = sellProceeds(holding.token_amount, curve.virtual_quote_reserves, curve.virtual_token_reserves);
    total += (gross * 9_875n) / BPS;
  }
  return total;
}

/** Read the batch's events and marks into the coin table. */
function observe(batch: Batch): void {
  for (const e of batch.events) {
    if (e.event === 'CreateEvent') {
      const c = coinFor(e.mint, e.slot, BigInt(e.virtual_quote_reserves), BigInt(e.virtual_token_reserves));
      absorb(c, 0n, BigInt(e.virtual_quote_reserves), BigInt(e.virtual_token_reserves), e.slot, null);
    } else if (e.event === 'TradeEvent') {
      const c = coinFor(e.mint, e.slot, BigInt(e.virtual_quote_reserves), BigInt(e.virtual_token_reserves));
      const quote = BigInt(e.quote_amount);
      const reserve = BigInt(e.real_quote_reserves);
      absorb(
        c,
        reserve,
        BigInt(e.virtual_quote_reserves),
        BigInt(e.virtual_token_reserves),
        e.slot,
        e.is_buy ? quote : -quote,
      );
      // The stall clock reads the market tape only: a TradeEvent's recorded reserve. A mark carries
      // the bot's own impact (the reserves a fill or close would meet), so folding marks in would let
      // the bot's own fills restart its own stall timer.
      if (c.role === 'rider' && reserve > c.runHighReserve) {
        c.runHighReserve = reserve;
        c.runHighSlot = e.slot;
      }
    } else {
      coinFor(e.mint, e.slot, 0n, 1n).complete = true;
    }
  }
  // A mark carries the reserves shifted by the bot's own impact, which is what a fill or a close
  // in that coin would meet, so it wins over a recorded trade of the same slot.
  for (const m of batch.marks) {
    const c = coins.get(m.mint);
    if (c === undefined || m.slot < c.reserveSlot) continue;
    absorb(c, BigInt(m.real_quote_reserves), BigInt(m.virtual_quote_reserves), BigInt(m.virtual_token_reserves), m.slot, null);
  }
}

function run(batch: Batch, state: BotState): OrderInput[] {
  observe(batch);
  const { caps } = state.hello;
  const tx = state.txFeeLamports();

  // The stop basis is booked on the FILLS, not on the decisions: a rider buy records its batch slot
  // and decision reserve in the coin's `riderDecisions` map, and the first rider ticket that FILLS
  // books `stopReserve` -- at ENTRY_RESERVE for a primary tranche, at 99% of the decision reserve for
  // a second-gate tranche bought below it. A filled sell that leaves no position closes the book on
  // that coin: its role, the rider's spend and the basis are released at once, so a coin the harness
  // closed on completion does not keep spending against RIDER_SLICE for the rest of the run.
  for (const f of batch.fills) {
    const c = coins.get(f.mint);
    if (c === undefined) continue;
    // The decision slot is spent whatever the order's outcome, so a refused or failed ticket can
    // never book the stop.
    const decidedReserve = f.side === 'buy' ? c.riderDecisions.get(f.decided_slot) : undefined;
    const riderBuy = f.side === 'buy' && decidedReserve !== undefined;
    if (riderBuy) c.riderDecisions.delete(f.decided_slot);
    if (f.status !== 'filled') continue;
    if (f.side === 'buy') {
      if (c.role === 'rider') {
        c.riderSpent += BigInt(f.quote_lamports);
        if (riderBuy && c.stopReserve === 0n) {
          c.stopReserve =
            decidedReserve! >= ENTRY_RESERVE ? ENTRY_RESERVE : (decidedReserve! * GATE_STOP_ANCHOR_BPS) / BPS;
        }
      }
    } else if (state.positions.get(f.mint) === undefined) {
      c.role = 'idle';
      c.riderSpent = 0n;
      c.stopReserve = 0n;
      c.riderDecisions.clear();
    }
  }

  const pendingBuy = new Set<string>();
  const pendingSell = new Set<string>();
  for (const p of state.pending.values()) {
    if (p.order.side === 'buy') pendingBuy.add(p.order.mint);
    else pendingSell.add(p.order.mint);
  }
  const held = state.positions;

  let riders = 0;
  let fillers = 0;
  for (const mint of held.keys()) {
    const c = coins.get(mint);
    if (c?.role === 'rider') riders += 1;
    else if (c?.role === 'filler') fillers += 1;
  }
  for (const mint of pendingBuy) {
    if (held.has(mint)) continue;
    const c = coins.get(mint);
    if (c?.role === 'rider') riders += 1;
    else if (c?.role === 'filler') fillers += 1;
  }

  let free = state.freeCashLamports();
  let openSlots = caps.max_open_positions - state.committedPositionCount();
  const maxOrders = caps.max_orders_per_batch;
  const orders: OrderInput[] = [];

  // ---------------------------------------------------------------- 1. exits
  type Reason = 'stop' | 'floor' | 'crash' | 'stall' | 'fillerTrail' | 'fillerTime' | 'preempt';
  const leaving = new Map<string, Reason>();
  const considerExit = (mint: string, holding: { token_amount: bigint }): void => {
    if (holding.token_amount === 0n || pendingSell.has(mint)) return;
    const c = coins.get(mint);
    if (c === undefined || c.complete) return;
    if (priceAbove(c.vq, c.vt, c.runVq, c.runVt)) {
      c.runVq = c.vq;
      c.runVt = c.vt > 0n ? c.vt : 1n;
    }
    if (c.role === 'filler') {
      if (riderQualifies(c, batch.slot)) {
        beginRider(c, batch.slot);
        riders += 1;
        fillers -= 1;
        return;
      }
      const trail = c.vt > 0n && !priceAbove(c.vq, c.vt, (c.runVq * (BPS - FILLER_TRAIL_BPS)) / BPS, c.runVt);
      const stale = batch.slot - c.entrySlot >= FILLER_MAX_HOLD;
      if (trail) leaving.set(mint, 'fillerTrail');
      else if (stale) leaving.set(mint, 'fillerTime');
      return;
    }
    // Anything the book no longer calls a filler is held like a rider: tokens left behind by a
    // partial or refused sell still get the rider guards.
    // The reserve stop reads the recorded real SOL reserve a fill or close in this coin would meet
    // (the mark when there is one, the tape otherwise) against the booked basis: ENTRY_RESERVE for a
    // primary tranche, 99% of the decision reserve for a second-gate tranche bought below it. It
    // fires at RESERVE_STOP_BPS of that basis, so the 90% floor below it is unreachable while a basis
    // exists and is kept only for a promoted filler with no basis yet.
    const stop = c.stopReserve > 0n && c.reserve * BPS <= c.stopReserve * RESERVE_STOP_BPS;
    const floor = c.entryReserve > 0n && c.reserve * BPS < c.entryReserve * RESERVE_FLOOR_BPS;
    const crash = c.vt > 0n && !priceAbove(c.vq, c.vt, (c.runVq * (BPS - CRASH_GUARD_BPS)) / BPS, c.runVt);
    const stall = batch.slot - c.runHighSlot > STALL_SLOTS;
    if (stop) leaving.set(mint, 'stop');
    else if (floor) leaving.set(mint, 'floor');
    else if (crash) leaving.set(mint, 'crash');
    else if (stall) leaving.set(mint, 'stall');
  };
  // Riders first, then fillers: when a reply cannot carry every sell, the rider is the one that
  // frees capital and a slot for the next pump.
  for (const mint of held.keys()) if (coins.get(mint)?.role !== 'filler') considerExit(mint, held.get(mint)!);
  for (const mint of held.keys()) if (coins.get(mint)?.role === 'filler') considerExit(mint, held.get(mint)!);

  // A rider candidate with no slot free makes room now: the oldest filler is sold this reply, so
  // its slot is open for the rider two slots later (a sell decided now cannot free today's slot).
  if (fillers > 0) {
    let waiting = 0;
    for (const c of coins.values()) {
      if (c.role === 'idle' && !held.has(c.mint) && riderQualifies(c, batch.slot)) waiting += 1;
    }
    if (waiting > openSlots) {
      let oldest: Coin | null = null;
      for (const [mint, c] of coins) {
        if (c.role !== 'filler' || !held.has(mint) || leaving.has(mint) || pendingSell.has(mint)) continue;
        if (oldest === null || c.entrySlot < oldest.entrySlot) oldest = c;
      }
      if (oldest !== null) leaving.set(oldest.mint, 'preempt');
    }
  }

  for (const [mint, reason] of leaving) {
    if (orders.length >= maxOrders) break;
    const holding = held.get(mint);
    const c = coins.get(mint);
    if (holding === undefined || c === undefined) continue;
    orders.push({ side: 'sell', mint, token_amount: holding.token_amount, max_slippage_bps: SELL_SLIPPAGE_BPS });
    if (reason === 'stop' || reason === 'floor' || reason === 'fillerTrail') {
      c.blockedAtOrBelow = (c.reserve * 10_500n) / BPS;
      c.nextEntrySlot = batch.slot + COOLDOWN_SLOTS;
    } else if (reason === 'crash') {
      c.blockedAtOrBelow = (c.reserve * 10_200n) / BPS;
      c.nextEntrySlot = batch.slot + 20;
    } else {
      // stalled, timed out or preempted: a new high is all it takes to come back.
      c.blockedAtOrBelow = c.reserve;
      c.nextEntrySlot = batch.slot + 10;
    }
    c.role = 'idle';
    c.riderSpent = 0n;
    c.stopReserve = 0n;
    c.riderDecisions.clear();
    if (reason === 'fillerTime' || reason === 'fillerTrail' || reason === 'preempt') fillers -= 1;
    else riders -= 1;
    free -= tx;
  }

  // ---------------------------------------------------------------- 2. riders
  // What each coin has already committed: filled rider buys plus the rider buys still in flight.
  const pendingBuyLamports = new Map<string, bigint>();
  for (const p of state.pending.values()) {
    if (p.order.side !== 'buy') continue;
    pendingBuyLamports.set(p.order.mint, (pendingBuyLamports.get(p.order.mint) ?? 0n) + BigInt(p.order.quote_lamports));
  }
  const bookedOn = (c: Coin): bigint => c.riderSpent + (pendingBuyLamports.get(c.mint) ?? 0n);
  let committedToRiders = 0n;
  for (const c of coins.values()) if (c.role === 'rider') committedToRiders += bookedOn(c);

  const candidateList: Coin[] = [];
  for (const c of coins.values()) {
    if (!riderQualifies(c, batch.slot)) continue;
    if (c.role === 'idle' && pendingSell.has(c.mint)) continue;
    candidateList.push(c);
  }
  candidateList.sort((a, b) => (b.reserve > a.reserve ? 1 : b.reserve < a.reserve ? -1 : 0));

  let riderBlocked = false;
  for (const c of candidateList) {
    if (orders.length >= maxOrders) break;
    if (pendingBuy.has(c.mint) && !held.has(c.mint)) continue;
    const inBook = held.has(c.mint);
    if (!inBook) {
      if (openSlots <= 0 || riders >= MAX_RIDERS) {
        if (openSlots <= 0) riderBlocked = true;
        continue;
      }
      openSlots -= 1;
    }
    if (c.role !== 'rider') {
      beginRider(c, batch.slot);
      riders += 1;
    }
    const roomOnCoin = COIN_BUDGET - bookedOn(c);
    if (roomOnCoin <= 0n) continue;
    const roomInSlice = RIDER_SLICE - committedToRiders;
    if (roomInSlice < MIN_RIDER_BUY) {
      if (inBook) continue;
      riderBlocked = true;
      continue;
    }
    let amount = state.maxBuyLamports(c.mint);
    if (amount > roomOnCoin) amount = roomOnCoin;
    if (amount > roomInSlice) amount = roomInSlice;
    // The rider book stops above the filler reserve and the fee buffer.
    const spendable = free - FEE_BUFFER - FILLER_CASH_RESERVE - tx;
    if (amount > spendable) amount = spendable;
    if (amount < MIN_RIDER_BUY) continue;
    orders.push({ side: 'buy', mint: c.mint, quote_lamports: amount, max_slippage_bps: RIDER_BUY_SLIPPAGE_BPS });
    // This ticket's slot, so its fill can be told from a filler's and can book the stop basis.
    c.riderDecisions.set(batch.slot, c.reserve);
    // The slice is charged for the decision now; the order stays charged through the next batches
    // by the pending list, and disappears from it when the fill resolves (refused or filled).
    committedToRiders += amount;
    free -= amount + tx;
  }

  // ---------------------------------------------------------------- 3. a filler round trip
  if (!riderBlocked && fillers < MAX_FILLERS && openSlots > 0 && orders.length < maxOrders) {
    for (const e of batch.events) {
      if (e.event !== 'TradeEvent') continue;
      const c = coins.get(e.mint);
      if (c === undefined || c.complete || c.role !== 'idle') continue;
      if (held.has(e.mint) || pendingBuy.has(e.mint) || pendingSell.has(e.mint)) continue;
      if (c.reserve < FILLER_MIN_RESERVE) continue;
      if (c.reserve * BPS < c.reserveHigh * NEAR_HIGH_BPS) continue;
      if (c.inflow <= 0n) continue;
      if (batch.slot < c.nextEntrySlot || c.reserve <= c.blockedAtOrBelow) continue;
      if (state.maxBuyLamports(e.mint) < FILLER_STAKE) continue;
      if (FILLER_STAKE + tx > free - FEE_BUFFER) break;
      c.role = 'filler';
      c.riderSpent = 0n;
      c.entryReserve = c.reserve;
      c.entrySlot = batch.slot;
      c.stopReserve = 0n;
      c.riderDecisions.clear();
      c.runVq = c.vq;
      c.runVt = c.vt > 0n ? c.vt : 1n;
      orders.push({ side: 'buy', mint: e.mint, quote_lamports: FILLER_STAKE, max_slippage_bps: FILLER_BUY_SLIPPAGE_BPS });
      free -= FILLER_STAKE + tx;
      fillers += 1;
      openSlots -= 1;
      break;
    }
  }

  // ---------------------------------------------------------------- diagnostics
  // One line per fill and one equity line per batch, on stderr only: the replay records it and the
  // robustness reports read it, and nothing here ever feeds back into a decision.
  for (const f of batch.fills) {
    console.error(`fill ${f.slot} ${f.mint} ${f.side} ${f.status} ${f.quote_lamports} ${f.token_amount} ${f.client_id}`);
  }
  console.error(`equity ${batch.slot} ${state.cash} ${equity(state)}`);
  return orders;
}

await runBot({
  onBatch(state, batch) {
    return run(batch, state);
  },
});
