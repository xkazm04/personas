// Season Ledger: the pure half of the Contest page. No React, no IO; unit-tested
// in __tests__/ledgerModel.test.ts.
//
// Three surfaces joined by a camera: the LEDGER (every contest, one line), the
// CONTEST (seats and the sorting bench) and the VARIANT (one live frame). The
// ledger row reads a contest from its summary alone: `summary.ledger` carries
// the participant seats, the variant stills, the owner's trays, the chain and
// the judges' lead (Rust `view::summary_of`).
import type { ContestLedger } from '@/lib/bindings/ContestLedger';
import type { ContestLedgerVariant } from '@/lib/bindings/ContestLedgerVariant';
import type { ContestPhase } from '@/lib/bindings/ContestPhase';
import type { ContestReviewBucket } from '@/lib/bindings/ContestReviewBucket';
import type { ContestSeat } from '@/lib/bindings/ContestSeat';
import type { ContestSeatState } from '@/lib/bindings/ContestSeatState';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';

import { chainStations, isLivePhase, raceRounds, type ChainStationId, type RosterEntry } from '../model/contestModel';
import { CONTEST_EFFORTS, CONTEST_ENGINES, CONTEST_MODEL_CATALOG, formatSeatSpec, isSpecToken, modelDisplayName, parseSeatSpec } from '../model/seatCatalog';
import type { ContestEffort } from '@/lib/bindings/ContestEffort';
import type { ContestSeatSpec } from '@/lib/bindings/ContestSeatSpec';

export const keyOf = (s: Pick<ContestSummary, 'projectId' | 'contestId'>): string => `${s.projectId}/${s.contestId}`;

// ── Attention: where the owner's eye goes ─────────────────────────────────

export type Attention = 'yours' | 'live' | 'settled';
export const ATTENTION_ORDER: readonly Attention[] = ['yours', 'live', 'settled'];
const ATTENTION_RANK: Record<Attention, number> = { yours: 0, live: 1, settled: 2 };

/** Waiting for the owner, still moving, or settled. */
export function attentionOf(phase: ContestPhase): Attention {
  if (phase === 'review') return 'yours';
  if (isLivePhase(phase) || phase === 'draft') return 'live';
  return 'settled';
}

export type LedgerFilter = 'yours' | 'running' | 'scheduled';

const RUNNING_PHASES: readonly ContestPhase[] = ['running', 'collecting', 'judging'];

export function isRunningPhase(phase: ContestPhase): boolean {
  return RUNNING_PHASES.includes(phase);
}

export function filterMatch(filter: LedgerFilter | null, phase: ContestPhase): boolean {
  switch (filter) {
    case null: return true;
    case 'yours': return phase === 'review';
    case 'running': return isRunningPhase(phase);
    case 'scheduled': return phase === 'queued' || phase === 'draft';
  }
}

export interface LedgerCounts {
  total: number;
  running: number;
  review: number;
  scheduled: number;
  decided: number;
  failed: number;
  /** The oldest contest's date (ISO `YYYY-MM-DD`), or null for none. */
  since: string | null;
}

export function ledgerCounts(contests: readonly ContestSummary[]): LedgerCounts {
  const c: LedgerCounts = { total: contests.length, running: 0, review: 0, scheduled: 0, decided: 0, failed: 0, since: null };
  for (const s of contests) {
    if (isRunningPhase(s.phase)) c.running += 1;
    else if (s.phase === 'review') c.review += 1;
    else if (s.phase === 'queued' || s.phase === 'draft') c.scheduled += 1;
    else if (s.phase === 'decided') c.decided += 1;
    else if (s.phase === 'failed') c.failed += 1;
  }
  const dates = contests.map((s) => s.date).filter(Boolean).sort();
  c.since = dates[0] ?? null;
  return c;
}

/** A contest with its refine rounds: one family, filed as one unit. */
export interface LedgerFamily {
  items: RosterEntry[];
  attention: Attention;
  /** Newest change across the family, epoch ms. */
  updatedAtMs: number;
  /** The root's date, for month grouping. */
  date: string;
}

export interface LedgerGroup {
  attention: Attention;
  families: LedgerFamily[];
  /** Rows whose own attention is this group's. */
  own: number;
  /** Earlier or later rounds filed here with their family. */
  related: number;
}

/**
 * Contests as attention groups of families. A family (a contest and its refine
 * rounds) files under its most urgent member, so a round waiting for review
 * pulls its shortlisted parent into "Needs your verdict". A family is kept
 * when ANY member matches the text and the filter; its other rounds stay
 * visible for context. Waiting and live groups sort newest change first; the
 * settled group newest date first.
 */
export function ledgerGroups(
  contests: readonly ContestSummary[],
  filter: LedgerFilter | null,
  query: string,
  searchText: (s: ContestSummary) => string,
): LedgerGroup[] {
  const families: LedgerFamily[] = [];
  for (const entry of raceRounds(contests)) {
    const last = families[families.length - 1];
    if (entry.depth === 0 || !last) families.push({ items: [entry], attention: 'settled', updatedAtMs: 0, date: '' });
    else last.items.push(entry);
  }
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const textOk = (s: ContestSummary) => {
    if (words.length === 0) return true;
    const hay = searchText(s).toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  const byAttention: Record<Attention, LedgerFamily[]> = { yours: [], live: [], settled: [] };
  for (const f of families) {
    if (!f.items.some((it) => textOk(it.summary))) continue;
    if (!f.items.some((it) => filterMatch(filter, it.summary.phase))) continue;
    const rank = Math.min(...f.items.map((it) => ATTENTION_RANK[attentionOf(it.summary.phase)]));
    f.attention = ATTENTION_ORDER[rank]!;
    f.updatedAtMs = Math.max(...f.items.map((it) => it.summary.updatedAtMs || 0));
    f.date = f.items[0]!.summary.date;
    byAttention[f.attention].push(f);
  }
  byAttention.yours.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  byAttention.live.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  byAttention.settled.sort((a, b) => b.date.localeCompare(a.date) || b.updatedAtMs - a.updatedAtMs);
  return ATTENTION_ORDER.filter((a) => byAttention[a].length > 0).map((attention) => {
    const fams = byAttention[attention];
    const all = fams.reduce((n, f) => n + f.items.length, 0);
    const own = fams.reduce((n, f) => n + f.items.filter((it) => attentionOf(it.summary.phase) === attention).length, 0);
    return { attention, families: fams, own, related: all - own };
  });
}

/** The ledger's rows in display order (what ↑/↓ walks). */
export function ledgerOrder(groups: readonly LedgerGroup[]): string[] {
  return groups.flatMap((g) => g.families.flatMap((f) => f.items.map((it) => keyOf(it.summary))));
}

/** `YYYY-MM` of an ISO date, for the settled group's month headers. */
export const monthOf = (date: string): string => date.slice(0, 7);

// ── Seats: strands and dials ──────────────────────────────────────────────

export const participantSeats = (seats: readonly ContestSeat[]): ContestSeat[] =>
  seats.filter((s) => s.kind === 'participant');

/** Seconds a seat has run: live for a running seat, its wall time otherwise. */
export function seatElapsedS(seat: Pick<ContestSeat, 'state' | 'startedAtMs' | 'wallS'>, nowMs: number): number | null {
  if (seat.state === 'running' && seat.startedAtMs) return Math.max(0, (nowMs - seat.startedAtMs) / 1000);
  return seat.wallS;
}

export function ceilingS(ledger: Pick<ContestLedger, 'timeoutMin'>): number | null {
  return ledger.timeoutMin > 0 ? ledger.timeoutMin * 60 : null;
}

export type StrandKind = 'queued' | 'running' | 'done' | 'out';

export function strandKind(state: ContestSeatState): StrandKind {
  switch (state) {
    case 'idle':
    case 'queued': return 'queued';
    case 'running': return 'running';
    case 'completed': return 'done';
    default: return 'out';
  }
}

/**
 * How far along its time limit a seat's strand is drawn, 0..1. A running seat
 * stops just short of the end (it has not finished); a timed-out seat is at
 * the end; a seat with no known time or limit is at 0.
 */
export function strandFraction(seat: Pick<ContestSeat, 'state' | 'startedAtMs' | 'wallS'>, ceiling: number | null, nowMs: number): number {
  if (seat.state === 'timed-out') return 1;
  const el = seatElapsedS(seat, nowMs);
  if (el === null || !ceiling) return 0;
  const f = Math.min(1, el / ceiling);
  return seat.state === 'running' ? Math.min(f, 0.985) : f;
}

/** A seat that ran reports numbers worth adding up; a queued one's are stale. */
export const hasRun = (seat: Pick<ContestSeat, 'state'>): boolean => seat.state !== 'queued' && seat.state !== 'idle';

/** Sum of the reported costs of seats that ran; null when none reported one. */
export function reportedCost(seats: readonly ContestSeat[]): number | null {
  let total = 0;
  let known = 0;
  for (const s of seats) {
    if (s.costUsd !== null && hasRun(s)) {
      total += s.costUsd;
      known += 1;
    }
  }
  return known ? total : null;
}

/** The longest seat's time and the turns the seats reported. */
export function wallOf(seats: readonly ContestSeat[], nowMs: number): { longestS: number | null; turns: number } {
  const walls = seats.map((s) => seatElapsedS(s, nowMs)).filter((v): v is number => v !== null);
  const turns = seats.reduce((n, s) => n + (hasRun(s) && s.turns !== null ? s.turns : 0), 0);
  return { longestS: walls.length ? Math.max(...walls) : null, turns };
}

// ── Variants: trays and micro-stills ──────────────────────────────────────

/** A variant's tray: the owner's bucket, else the verdict contest.json
 *  recorded (a contest decided from the CLI has no review.json). */
export function ledgerBucket(
  summary: Pick<ContestSummary, 'winner' | 'shortlist'>,
  variant: Pick<ContestLedgerVariant, 'key' | 'bucket'>,
): ContestReviewBucket | null {
  if (variant.bucket) return variant.bucket;
  if (summary.winner === variant.key) return 'winner';
  if (summary.shortlist.includes(variant.key)) return 'shortlist';
  return null;
}

export type MicroCell =
  | { kind: 'still'; variant: ContestLedgerVariant; bucket: ContestReviewBucket | null }
  | { kind: 'empty'; out: boolean };

export interface MicroGroup {
  seat: ContestSeat;
  cells: MicroCell[];
}

/** One group of cells per seat: each delivered variant, then an empty cell
 *  per variant still owed (struck through when the seat stopped short). */
export function microGroups(summary: ContestSummary): MicroGroup[] {
  const { ledger } = summary;
  const bySeat = new Map<string, ContestLedgerVariant[]>();
  for (const v of ledger.variants) {
    const list = bySeat.get(v.seatId) ?? [];
    list.push(v);
    bySeat.set(v.seatId, list);
  }
  const perSeat = Math.max(1, summary.variantsPerSeat || 3);
  return ledger.seats.map((seat) => {
    const variants = [...(bySeat.get(seat.seatId) ?? [])].sort((a, b) => a.n - b.n);
    const out = strandKind(seat.state) === 'out';
    const cells: MicroCell[] = variants.map((variant) => ({ kind: 'still', variant, bucket: ledgerBucket(summary, variant) }));
    for (let i = variants.length; i < perSeat; i += 1) cells.push({ kind: 'empty', out });
    return { seat, cells };
  });
}

/** Cell size so every seat's cells fit the variants column: at most `baseW`
 *  wide, never under 20 px, 16:10. */
export function microSize(groups: readonly MicroGroup[], columnW: number, baseW: number): { w: number; h: number } {
  const slots = groups.reduce((n, g) => n + g.cells.length, 0) || 1;
  const gaps = (slots - groups.length) * 3 + Math.max(0, groups.length - 1) * 8;
  const w = Math.max(20, Math.min(baseW, Math.floor((columnW - 2 - gaps) / slots)));
  return { w, h: Math.round(w / 1.6) };
}

// ── The verdict line ──────────────────────────────────────────────────────

export type Verdict =
  | { kind: 'decided'; key: string | null; name: string | null; spec: string | null }
  | { kind: 'shortlisted'; keys: string[]; child: ContestSummary | null }
  | { kind: 'review-empty' }
  | { kind: 'review'; sorted: number; total: number; buckets: (ContestReviewBucket | null)[]; lead: { key: string; mean: number } | null; ownWinner: string | null }
  | { kind: 'failed'; station: ChainStationId | null; delivered: number; seats: number; child: ContestSummary | null }
  | { kind: 'queued'; startMs: number | null }
  | { kind: 'live'; phase: 'running' | 'collecting' | 'judging' | 'queued'; delivered: number; expected: number; building: number; waiting: number }
  | { kind: 'draft' };

/** A variant's name, said once: the builder's concept, else its title, else its key. */
export function variantName(v: Pick<ContestLedgerVariant, 'concept' | 'title' | 'key'>): string {
  return v.concept.trim() || v.title.trim() || v.key;
}

/** When the contest starts or started: a start still ahead, else the first
 *  seat that left the queue, else a start already past. */
export function startOf(ledger: Pick<ContestLedger, 'notBeforeMs' | 'seats'>, nowMs: number): { ms: number; upcoming: boolean } | null {
  if (ledger.notBeforeMs !== null && ledger.notBeforeMs > nowMs) return { ms: ledger.notBeforeMs, upcoming: true };
  const starts = ledger.seats.map((s) => s.startedAtMs).filter((v): v is number => v !== null && v > 0);
  if (starts.length) return { ms: Math.min(...starts), upcoming: false };
  return ledger.notBeforeMs !== null ? { ms: ledger.notBeforeMs, upcoming: false } : null;
}

export function verdictOf(summary: ContestSummary, children: readonly ContestSummary[], nowMs: number): Verdict {
  const { ledger, phase } = summary;
  const child = children.length ? children[children.length - 1]! : null;
  const delivered = ledger.variants.length;
  switch (phase) {
    case 'decided': {
      const v = ledger.variants.find((x) => x.key === summary.winner);
      return { kind: 'decided', key: summary.winner, name: v ? variantName(v) : null, spec: summary.winnerSeatSpec };
    }
    case 'shortlisted':
      return { kind: 'shortlisted', keys: summary.shortlist, child };
    case 'review': {
      if (delivered === 0) return { kind: 'review-empty' };
      const buckets = ledger.variants.map((v) => ledgerBucket(summary, v));
      const ownWinner = ledger.variants.find((_, i) => buckets[i] === 'winner')?.key ?? null;
      return {
        kind: 'review',
        sorted: buckets.filter(Boolean).length,
        total: delivered,
        buckets,
        lead: ledger.judgesLead ? { key: ledger.judgesLead.key, mean: ledger.judgesLead.mean } : null,
        ownWinner,
      };
    }
    case 'failed': {
      const station = chainStations(ledger.chain, ledger.judgesEnabled, phase).find((s) => s.status === 'failed')?.id ?? null;
      return { kind: 'failed', station, delivered: new Set(ledger.variants.map((v) => v.seatId)).size, seats: ledger.seats.length, child };
    }
    case 'queued': {
      const start = startOf(ledger, nowMs);
      if (start?.upcoming) return { kind: 'queued', startMs: start.ms };
      return live(summary, 'queued');
    }
    case 'running':
    case 'collecting':
    case 'judging':
      return live(summary, phase);
    case 'draft':
      return { kind: 'draft' };
  }
}

function live(summary: ContestSummary, phase: 'running' | 'collecting' | 'judging' | 'queued'): Verdict {
  const seats = summary.ledger.seats;
  return {
    kind: 'live',
    phase,
    delivered: summary.ledger.variants.length,
    expected: seats.length * (summary.variantsPerSeat || 3),
    building: seats.filter((s) => s.state === 'running').length,
    waiting: seats.filter((s) => s.state === 'queued' || s.state === 'idle').length,
  };
}

/** The refine rounds of a contest, oldest round first. */
export function childrenOf(contests: readonly ContestSummary[], s: Pick<ContestSummary, 'projectId' | 'contestId'>): ContestSummary[] {
  return contests
    .filter((c) => c.parentId === s.contestId && c.projectId === s.projectId)
    .sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
}

export function parentOf(contests: readonly ContestSummary[], s: Pick<ContestSummary, 'projectId' | 'parentId'>): ContestSummary | null {
  if (!s.parentId) return null;
  return contests.find((c) => c.projectId === s.projectId && c.contestId === s.parentId) ?? null;
}

// ── Live line and season ──────────────────────────────────────────────────

export interface RunningSeat {
  summary: ContestSummary;
  seat: ContestSeat;
}

/** Every seat building right now, the longest-running first. */
export function runningSeats(contests: readonly ContestSummary[]): RunningSeat[] {
  const out: RunningSeat[] = [];
  for (const summary of contests) for (const seat of summary.ledger.seats) if (seat.state === 'running') out.push({ summary, seat });
  return out.sort((a, b) => (a.seat.startedAtMs ?? 0) - (b.seat.startedAtMs ?? 0));
}

/** The next scheduled start, when nothing is building. */
export function nextStart(contests: readonly ContestSummary[], nowMs: number): { summary: ContestSummary; ms: number } | null {
  let best: { summary: ContestSummary; ms: number } | null = null;
  for (const summary of contests) {
    if (summary.phase !== 'queued') continue;
    const start = startOf(summary.ledger, nowMs);
    if (start?.upcoming && (!best || start.ms < best.ms)) best = { summary, ms: start.ms };
  }
  return best;
}

/** Reported spend across contests; null when no contest reported a cost. */
export function seasonSpend(contests: readonly ContestSummary[]): number | null {
  let total: number | null = null;
  for (const s of contests) {
    const c = reportedCost(s.ledger.seats);
    if (c !== null) total = total === null ? c : total + c;
  }
  return total;
}

/** The head of a long title: up to the first colon, dash or comma. */
export function shortTitle(title: string, max = 36): string {
  const head = title.split(/:\s|\s[—–-]\s|,\s/)[0] ?? title;
  return head.length > max ? `${head.slice(0, max - 2)}…` : head;
}

// ── Estimates: the cost before the trigger ────────────────────────────────

/** A spec without its `#label`: two seats of one kind share a history. */
export function baseSpec(spec: string): string {
  return spec.replace(/#.*$/, '');
}

interface PastRun {
  cost: number | null;
  wallS: number | null;
  perSeat: number;
  state: ContestSeatState;
}

/** Past settled runs of a seat; `loose` pools the same model at any effort. */
function history(spec: string, contests: readonly ContestSummary[], loose: boolean): PastRun[] {
  const base = baseSpec(spec);
  const parsed = parseSeatSpec(base);
  const modelKey = parsed ? `${parsed.engine}:${parsed.model}@` : null;
  const out: PastRun[] = [];
  for (const s of contests) {
    for (const seat of s.ledger.seats) {
      const b = baseSpec(seat.spec);
      if (loose ? !(modelKey && b.startsWith(modelKey)) : b !== base) continue;
      if (seat.state === 'queued' || seat.state === 'idle' || seat.state === 'running') continue;
      if (seat.wallS === null && seat.costUsd === null) continue;
      out.push({ cost: seat.costUsd, wallS: seat.wallS, perSeat: s.variantsPerSeat || 3, state: seat.state });
    }
  }
  return out;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export interface SeatEstimate {
  spec: string;
  runs: number;
  /** Median past cost per variant × variants, or null when unpriced. */
  cost: number | null;
  costLow: number | null;
  costHigh: number | null;
  /** Codex reports no cost; a seat without history on a reporting engine is merely unknown. */
  reportsCost: boolean;
  wallS: number | null;
  /** Past runs that did not finish cleanly. */
  failures: number;
  /** 'model' when priced from the same model at another effort. */
  basis: 'exact' | 'model' | null;
}

/** What one seat is likely to cost and take, from this machine's past runs. */
export function seatEstimate(spec: string, contests: readonly ContestSummary[], variantsPerSeat: number, timeoutMin: number): SeatEstimate {
  let runs = history(spec, contests, false);
  let basis: SeatEstimate['basis'] = runs.length ? 'exact' : null;
  if (!runs.length) {
    runs = history(spec, contests, true);
    if (runs.length) basis = 'model';
  }
  const perVariant = runs.filter((r) => r.cost !== null).map((r) => r.cost! / r.perSeat);
  const walls = runs.filter((r) => r.wallS !== null).map((r) => r.wallS!);
  const costPer = median(perVariant);
  const engine = parseSeatSpec(baseSpec(spec))?.engine ?? null;
  const wall = median(walls);
  return {
    spec,
    runs: runs.length,
    cost: costPer === null ? null : costPer * variantsPerSeat,
    costLow: perVariant.length ? Math.min(...perVariant) * variantsPerSeat : null,
    costHigh: perVariant.length ? Math.max(...perVariant) * variantsPerSeat : null,
    reportsCost: engine !== 'codex',
    wallS: wall === null ? null : Math.min(wall, timeoutMin * 60),
    failures: runs.filter((r) => r.state !== 'completed').length,
    basis,
  };
}

export interface PanelEstimate {
  seats: SeatEstimate[];
  cost: number | null;
  costLow: number | null;
  costHigh: number | null;
  unpriced: number;
  /** The slowest seat bounds the contest. */
  wallS: number | null;
  runs: number;
}

export function panelEstimate(specs: readonly ContestSeatSpec[], contests: readonly ContestSummary[], variantsPerSeat: number, timeoutMin: number): PanelEstimate {
  const seats = specs.map((s) => seatEstimate(formatSeatSpec(s), contests, variantsPerSeat, timeoutMin));
  const priced = seats.filter((s) => s.cost !== null);
  const walls = seats.map((s) => s.wallS).filter((v): v is number => v !== null);
  return {
    seats,
    cost: priced.length ? priced.reduce((n, s) => n + s.cost!, 0) : null,
    costLow: sumKnown(priced.map((s) => s.costLow)),
    costHigh: sumKnown(priced.map((s) => s.costHigh)),
    unpriced: seats.length - priced.length,
    wallS: walls.length ? Math.max(...walls) : null,
    runs: seats.reduce((n, s) => n + s.runs, 0),
  };
}

/** The sum of known figures; null when any is unknown (a range is all or nothing). */
function sumKnown(xs: readonly (number | null)[]): number | null {
  if (!xs.length || xs.some((x) => x === null)) return null;
  return xs.reduce<number>((n, x) => n + (x as number), 0);
}

/** Panels the owner actually ran, newest first: one-click starting points. */
export function recentPanels(contests: readonly ContestSummary[], max = 5): { seats: string[]; from: ContestSummary }[] {
  const seen = new Set<string>();
  const out: { seats: string[]; from: ContestSummary }[] = [];
  for (const s of contests) {
    const seats = [...new Set(s.seatSpecs.map(baseSpec))];
    const sig = [...seats].sort().join('|');
    if (!seats.length || seen.has(sig)) continue;
    seen.add(sig);
    out.push({ seats, from: s });
    if (out.length >= max) break;
  }
  return out;
}

// ── Setup: type a seat ────────────────────────────────────────────────────

const EFFORT_ALIASES: Record<ContestEffort, readonly string[]> = {
  low: ['low', 'lo'],
  medium: ['medium', 'med', 'mid'],
  high: ['high', 'hi', 'h'],
  xhigh: ['xhigh', 'extra', 'x', 'xh', 'xtra'],
  max: ['max', 'maximum'],
};

export interface SeatSuggestion extends ContestSeatSpec {
  /** A model id typed by hand that is not in the catalog. */
  custom: boolean;
}

/**
 * Seats for a typed query: "opus x" → Opus 5.5 at Extra high, "sol" → GPT-6
 * Sol at each effort (High first). Words match a model's name or id by prefix
 * and an effort by its aliases or its shown word. A first word that names no
 * catalog model is offered as a custom model id on each engine.
 */
export function seatSuggestions(query: string, effortWords: Record<ContestEffort, string>, max = 7): SeatSuggestion[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const effortHits = (e: ContestEffort, w: string) =>
    EFFORT_ALIASES[e].some((a) => a.startsWith(w)) || effortWords[e].toLowerCase().startsWith(w);
  const scored: { s: SeatSuggestion; score: number }[] = [];
  let anyModel = false;
  for (const engine of CONTEST_ENGINES) {
    CONTEST_MODEL_CATALOG[engine].forEach((model, mi) => {
      const name = modelDisplayName(model).toLowerCase();
      const hay = [engine, ...name.split(/[\s-]+/), name.replace(/\s+/g, ''), name.replace(/\s+/g, '-'), model.toLowerCase()];
      if (words.some((w) => hay.some((x) => x.startsWith(w)))) anyModel = true;
      for (const effort of CONTEST_EFFORTS) {
        let ok = true;
        let effortHit = false;
        let modelHit = false;
        for (const w of words) {
          if (hay.some((x) => x.startsWith(w))) modelHit = true;
          else if (effortHits(effort, w)) effortHit = true;
          else {
            ok = false;
            break;
          }
        }
        if (!ok || !modelHit) continue;
        const effortRank = effortHit ? 0 : ['high', 'xhigh', 'max', 'medium', 'low'].indexOf(effort) + 1;
        scored.push({ s: { engine, model, effort, label: null, custom: false }, score: (effortHit ? 10 : 0) - effortRank - mi * 0.01 });
      }
    });
  }
  scored.sort((a, b) => b.score - a.score);
  const list = scored.slice(0, max).map((x) => x.s);
  const first = words[0]!;
  if (!anyModel && isSpecToken(first)) {
    const effort = words.slice(1).map((w) => CONTEST_EFFORTS.find((e) => effortHits(e, w))).find(Boolean) ?? 'high';
    for (const engine of CONTEST_ENGINES) list.push({ engine, model: first, effort, label: null, custom: true });
  }
  return list;
}

// ── The contest level: bench and scoreboard ───────────────────────────────

export type BenchTray = ContestReviewBucket | 'unsorted';
export const BENCH_ORDER: readonly BenchTray[] = ['unsorted', 'winner', 'shortlist', 'impractical', 'failure'];

/**
 * Card width for the bench: as few rows as keep cards readable. An empty tray
 * collapses to a 40 px strip; a tray's cards wrap into `rows` rows.
 */
export function benchLayout(counts: readonly number[], mainW: number, wide: boolean): { rows: number; cols: number[]; cardW: number } {
  const maxW = wide ? 250 : 200;
  const tryRows = (rows: number) => {
    let units = 0;
    let fixed = (counts.length - 1) * 6;
    const cols = counts.map((n) => {
      if (!n) {
        fixed += 40;
        return 0;
      }
      const c = Math.ceil(n / rows);
      units += c;
      fixed += 14 + (c - 1) * 6;
      return c;
    });
    return { rows, cols, cardW: Math.min(maxW, Math.floor((mainW - fixed) / Math.max(1, units))) };
  };
  const one = tryRows(1);
  if (one.cardW >= (wide ? 190 : 150)) return one;
  const two = tryRows(2);
  if (two.cardW >= 120) return two;
  return tryRows(3);
}

/** Heat-map strength for a 0-10 score: 4 % at 4 and below, 28 % at 10. */
export function heatPercent(v: number | null | undefined): number {
  if (v === null || v === undefined || !Number.isFinite(v)) return 0;
  const t = Math.max(0, Math.min(1, (v - 4) / 6));
  return Math.round(4 + t * 24);
}

export const SCORE_DIMS = ['wow', 'clarity', 'wayfinding', 'interaction', 'craft', 'concept', 'utility'] as const;

/** The seat spec for a manually added model id, at the default effort. */
export function customSeat(engine: ContestSeatSpec['engine'], model: string, effort: ContestEffort = 'high'): ContestSeatSpec {
  return { engine, model, effort, label: null };
}
