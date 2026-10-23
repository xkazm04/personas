// The persona line's TAIL (WP11, V1 "Tail"): what a persona is doing, as
// glyph + time tokens after its name, and the lamp + figure at its right
// edge. Pure: every value comes from a read the board already holds, and a
// value nobody filled is ABSENT here, never invented.
//
//   kind, lamp, edge   the Board's pile (`personaLinePileKey`)
//   running for        card.runningSince  <- PROCESS_ACTIVITY "started"
//   queued             card.queued        <- QUEUE_STATUS "queued"
//   last run outcome   card.recentStatuses[0] <- get_persona_summaries.health
//   last run age       agentStore.personaLastRun <- get_persona_summaries.lastRunAt
//   next start         overviewStore.cronAgents <- list_cron_agents (`useMonitorSchedules`)
//   peer               the device snapshot carries running / enabled only: no
//                      last run, no schedule, so both are absent on a peer line
//
// PRIORITY when the column is narrow (the line draws it, `PersonaTail`): the
// lead token (last run, or the run's queue) never shrinks and is never cut;
// the next start drops WHOLE before the name truncates. The full sentence
// (reason in words, activity, next start) is always in the tooltip.

import type { PileKey } from '../../skin/piles';
import type { Lamp, LineSignal, Tone } from './tone';
import { compactAge, lineSignal } from './tone';

export type Outcome = 'completed' | 'failed' | 'cancelled' | 'unknown';

/** The first token after the name. */
export type LeadToken =
  | { kind: 'run'; elapsed: string | null; queued: number }
  | { kind: 'last'; outcome: Outcome; age: string | null }
  | { kind: 'never' }
  | { kind: 'peer'; state: 'running' | 'off' | 'resting' }
  | null;

/** The right edge's one figure. */
export type TailFigure = { kind: 'elapsed'; text: string } | { kind: 'need' } | { kind: 'off' } | null;

export interface Tail {
  kind: PileKey;
  /** Edge, lamp, run glyph and sweep tone: `signal.tone`. */
  tone: Tone;
  /** The line's whole state treatment, from the one rule (`tone.ts` `lineSignal`). */
  signal: LineSignal;
  lamp: Lamp;
  lead: LeadToken;
  /** Epoch ms of the next scheduled start, or null when none is known. */
  next: number | null;
  figure: TailFigure;
}

export interface TailInput {
  kind: PileKey;
  peer: boolean;
  runningSince: number | null;
  queued: number;
  /** `card.recentStatuses[0]`, newest first. */
  lastStatus: string | null;
  /** ISO `lastRunAt`, or null when the summary carries none. */
  lastRunAt: string | null;
  nextMs: number | null;
  now: number;
}

/** `12s`, `4m`, `1h 20m`: the run's elapsed time (the board's `shortElapsed`). */
export function elapsedText(fromMs: number, now: number): string {
  const s = Math.max(0, Math.round((now - fromMs) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function outcomeOf(status: string | null): Outcome {
  return status === 'completed' || status === 'failed' || status === 'cancelled' ? status : 'unknown';
}

export function personaTail(i: TailInput): Tail {
  const needs = i.kind === 'critical' || i.kind === 'warning';
  const running = i.runningSince !== null && i.kind !== 'off';
  const signal = lineSignal(i.kind, running);
  const tone = signal.tone;
  const lamp: Lamp = { tone, lit: i.kind !== 'resting' && i.kind !== 'off' };
  const figure: TailFigure = needs ? { kind: 'need' }
    : running ? { kind: 'elapsed', text: elapsedText(i.runningSince as number, i.now) }
      : i.kind === 'off' && !i.peer ? { kind: 'off' } : null;

  let lead: LeadToken = null;
  if (i.peer) {
    lead = { kind: 'peer', state: i.kind === 'working' ? 'running' : i.kind === 'off' ? 'off' : 'resting' };
  } else if (running) {
    // The elapsed time lives at the right edge unless a need took that place.
    const elapsed = needs ? elapsedText(i.runningSince as number, i.now) : null;
    lead = elapsed !== null || i.queued > 0 ? { kind: 'run', elapsed, queued: i.queued } : null;
  } else if (i.kind !== 'off') {
    const lastMs = i.lastRunAt ? Date.parse(i.lastRunAt) : NaN;
    const age = Number.isFinite(lastMs) ? compactAge(Math.max(0, i.now - lastMs)) : null;
    lead = i.lastStatus !== null || age !== null ? { kind: 'last', outcome: outcomeOf(i.lastStatus), age } : { kind: 'never' };
  }

  // An off persona (or one whose project is off) will not start, whatever its trigger says.
  const next = i.peer || i.kind === 'off' || i.nextMs === null || i.nextMs <= i.now ? null : i.nextMs;
  return { kind: i.kind, tone, signal, lamp, lead, next, figure };
}

/** `14:30` today, `Tue 14:30` within the week, `13 Oct` beyond it, in the reader's language. */
export function clockText(ms: number, language: string, now: number): string {
  const d = new Date(ms);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const opts: Intl.DateTimeFormatOptions = sameDay ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    : ms - now < 6 * 86_400_000 ? { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
      : { day: 'numeric', month: 'short' };
  return new Intl.DateTimeFormat(language, opts).format(d);
}

/** The `t.monitor` keys the sentence speaks with (all existing keys). */
export interface TailStrings {
  grid_state_running: string;
  grid_state_failed: string;
  caption_queued_many: string;
  schedule_last_run: string;
  schedule_last_ok: string;
  board_reason_failed: string;
  board_no_runs: string;
  board_pile_off: string;
  board_pile_resting: string;
  schedule_next: string;
}

type Tx = (template: string, vars: Record<string, string | number>) => string;

/** What the lead token says, in words. */
export function leadWords(lead: LeadToken, m: TailStrings, tx: Tx): string | null {
  if (!lead) return null;
  switch (lead.kind) {
    case 'run': {
      const run = lead.elapsed ? `${m.grid_state_running} ${lead.elapsed}` : m.grid_state_running;
      return lead.queued > 0 ? `${run} · ${tx(m.caption_queued_many, { count: lead.queued })}` : run;
    }
    case 'last': {
      const said = lead.outcome === 'completed' ? m.schedule_last_ok : lead.outcome === 'failed' ? m.grid_state_failed : null;
      if (!lead.age) return lead.outcome === 'failed' ? m.board_reason_failed : said;
      const when = tx(m.schedule_last_run, { when: lead.age });
      return said ? `${when} · ${said}` : when;
    }
    case 'never':
      return m.board_no_runs;
    case 'peer':
      return lead.state === 'running' ? m.grid_state_running : lead.state === 'off' ? m.board_pile_off : m.board_pile_resting;
  }
}

/**
 * The line's whole story as ONE sentence for its tooltip and accessible name:
 * the state (the need's reason in words, else the pile), what it is doing,
 * and when it next starts. A part with nothing behind it is left out.
 */
export function tailSentence(state: string, tail: Tail, m: TailStrings, tx: Tx, language: string, now: number): string {
  // A working line's lead may be empty (its elapsed is the right-edge figure): say the run here.
  // A peer's lead is its state word, which `state` already says.
  const activity = tail.lead?.kind === 'peer' ? null : tail.figure?.kind === 'elapsed'
    ? leadWords({ kind: 'run', elapsed: tail.figure.text, queued: tail.lead?.kind === 'run' ? tail.lead.queued : 0 }, m, tx)
    : leadWords(tail.lead, m, tx);
  const next = tail.next !== null ? tx(m.schedule_next, { when: clockText(tail.next, language, now) }) : null;
  return [state, activity !== state ? activity : null, next].filter((p): p is string => !!p).join(' · ');
}
