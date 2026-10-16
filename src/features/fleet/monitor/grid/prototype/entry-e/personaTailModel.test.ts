import { describe, expect, it } from 'vitest';
import type { CronAgent } from '@/lib/bindings/CronAgent';
import { personaTail, tailSentence, type TailInput, type TailStrings } from './personaTailModel';
import { nextStartMs } from './useMonitorSchedules';

const NOW = Date.parse('2026-10-16T10:00:00Z');
const MIN = 60_000;

const base: TailInput = {
  kind: 'resting', peer: false, runningSince: null, queued: 0,
  lastStatus: 'completed', lastRunAt: new Date(NOW - 120 * MIN).toISOString(), nextMs: null, now: NOW,
};

const m: TailStrings = {
  grid_state_running: 'Running',
  grid_state_failed: 'Failed',
  caption_queued_many: '{count} queued',
  schedule_last_run: 'Last run {when}',
  schedule_last_ok: 'finished OK',
  board_reason_failed: 'Last run failed',
  board_no_runs: 'No recent runs',
  board_pile_off: 'Off',
  board_pile_resting: 'Resting',
  schedule_next: 'next {when}',
};
const tx = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k]));

describe('personaTail: state -> lamp and edge', () => {
  it('lights the lamp only for a need or a run, in the pile tone', () => {
    expect(personaTail({ ...base, kind: 'critical' }).lamp).toEqual({ tone: 'err', lit: true });
    expect(personaTail({ ...base, kind: 'warning' }).lamp).toEqual({ tone: 'warn', lit: true });
    expect(personaTail({ ...base, kind: 'working', runningSince: NOW - 6 * MIN }).lamp).toEqual({ tone: 'run', lit: true });
    expect(personaTail(base).lamp).toEqual({ tone: 'off', lit: false });
    expect(personaTail({ ...base, kind: 'off' }).lamp).toEqual({ tone: 'off', lit: false });
  });

  it('puts the need at the right edge, else the run elapsed, else the off glyph', () => {
    expect(personaTail({ ...base, kind: 'warning' }).figure).toEqual({ kind: 'need' });
    expect(personaTail({ ...base, kind: 'working', runningSince: NOW - 6 * MIN }).figure).toEqual({ kind: 'elapsed', text: '6m' });
    expect(personaTail({ ...base, kind: 'off' }).figure).toEqual({ kind: 'off' });
    expect(personaTail({ ...base, kind: 'off', peer: true }).figure).toBeNull();
    expect(personaTail(base).figure).toBeNull();
  });
});

describe('personaTail: tokens', () => {
  it('leads with the last run outcome and its age', () => {
    expect(personaTail(base).lead).toEqual({ kind: 'last', outcome: 'completed', age: '2h' });
    expect(personaTail({ ...base, lastStatus: 'failed' }).lead).toEqual({ kind: 'last', outcome: 'failed', age: '2h' });
  });

  it('a running line leads with its queue, and moves its elapsed into the lead when a need holds the edge', () => {
    expect(personaTail({ ...base, kind: 'working', runningSince: NOW - 6 * MIN, queued: 1 }).lead).toEqual({ kind: 'run', elapsed: null, queued: 1 });
    expect(personaTail({ ...base, kind: 'working', runningSince: NOW - 6 * MIN }).lead).toBeNull();
    expect(personaTail({ ...base, kind: 'warning', runningSince: NOW - 3 * MIN }).lead).toEqual({ kind: 'run', elapsed: '3m', queued: 0 });
  });

  it('says "never" only when there is no outcome and no age', () => {
    expect(personaTail({ ...base, lastStatus: null, lastRunAt: null }).lead).toEqual({ kind: 'never' });
    expect(personaTail({ ...base, lastStatus: null }).lead).toEqual({ kind: 'last', outcome: 'unknown', age: '2h' });
    expect(personaTail({ ...base, lastRunAt: null }).lead).toEqual({ kind: 'last', outcome: 'completed', age: null });
  });

  it('a peer line carries only its state: no last run, no next start', () => {
    const t = personaTail({ ...base, peer: true, kind: 'working', runningSince: NOW, nextMs: NOW + 30 * MIN });
    expect(t.lead).toEqual({ kind: 'peer', state: 'running' });
    expect(t.next).toBeNull();
  });
});

describe('personaTail: schedule absent', () => {
  it('no schedule, a past one, or an off persona: the next start is absent, never invented', () => {
    expect(personaTail(base).next).toBeNull();
    expect(personaTail({ ...base, nextMs: NOW - MIN }).next).toBeNull();
    expect(personaTail({ ...base, kind: 'off', nextMs: NOW + 30 * MIN }).next).toBeNull();
    expect(personaTail({ ...base, nextMs: NOW + 30 * MIN }).next).toBe(NOW + 30 * MIN);
  });

  it('nextStartMs skips disabled triggers and personas and picks the earliest future start', () => {
    const agent = (over: Partial<CronAgent>): CronAgent => ({
      persona_id: 'p1', persona_name: 'P', persona_icon: null, persona_color: null, persona_enabled: true, headless: false,
      trigger_id: 't', cron_expression: '0 * * * *', interval_seconds: null, timezone: null, trigger_enabled: true,
      last_triggered_at: null, next_trigger_at: null, description: '', recent_executions: 0n, recent_failures: 0n, ...over,
    });
    const at = (min: number) => new Date(NOW + min * MIN).toISOString();
    const list = [
      agent({ trigger_id: 'a', next_trigger_at: at(90) }),
      agent({ trigger_id: 'b', next_trigger_at: at(20) }),
      agent({ trigger_id: 'c', next_trigger_at: at(5), trigger_enabled: false }),
      agent({ trigger_id: 'd', next_trigger_at: at(-5) }),
      agent({ persona_id: 'p2', next_trigger_at: at(10), persona_enabled: false }),
    ];
    expect(nextStartMs(list, 'p1', NOW)).toBe(NOW + 20 * MIN);
    expect(nextStartMs(list, 'p2', NOW)).toBeNull();
    expect(nextStartMs(list, 'nobody', NOW)).toBeNull();
    expect(nextStartMs([], 'p1', NOW)).toBeNull();
  });
});

describe('tailSentence: the tooltip carries the whole story', () => {
  it('reason in words, activity, next start', () => {
    const t = personaTail({ ...base, kind: 'warning', nextMs: NOW + 30 * MIN });
    const s = tailSentence('Review waiting', t, m, tx, 'en', NOW);
    expect(s).toMatch(/^Review waiting · Last run 2h · finished OK · next \d{2}:\d{2}$/);
  });

  it('a working line says its run even though the elapsed sits at the edge', () => {
    const t = personaTail({ ...base, kind: 'working', runningSince: NOW - 6 * MIN, queued: 2 });
    expect(tailSentence('Working', t, m, tx, 'en', NOW)).toBe('Working · Running 6m · 2 queued');
  });

  it('leaves out what is absent', () => {
    const t = personaTail({ ...base, lastStatus: null, lastRunAt: null });
    expect(tailSentence('Resting', t, m, tx, 'en', NOW)).toBe('Resting · No recent runs');
    const failed = personaTail({ ...base, kind: 'critical', lastStatus: 'failed', lastRunAt: null });
    expect(tailSentence('Last run failed', failed, m, tx, 'en', NOW)).toBe('Last run failed');
  });
});

describe('running AND needs you: the need glyph is amber, the rest is the run tone (polish P1, item 5)', () => {
  it('keeps the run frame (edge, lamp, sweep) and tones only the need glyph amber', () => {
    const t = personaTail({ ...base, kind: 'warning', runningSince: NOW - 3 * MIN });
    expect(t.tone).toBe('run');
    expect(t.lamp).toEqual({ tone: 'run', lit: true });
    expect(t.signal).toEqual({ tone: 'run', edge: 'is-working', sweep: true, need: 'warn' });
    expect(t.figure).toEqual({ kind: 'need' });
    // The run glyph and its elapsed move to the lead, where `PersonaTail` draws them in the run tone.
    expect(t.lead).toEqual({ kind: 'run', elapsed: '3m', queued: 0 });
  });

  it('a need that is not running is amber throughout, with no wash class and no sweep', () => {
    expect(personaTail({ ...base, kind: 'warning' }).signal).toEqual({ tone: 'warn', edge: 'is-lit', sweep: false, need: 'warn' });
  });

  it('critical keeps its red frame even while it runs', () => {
    const t = personaTail({ ...base, kind: 'critical', runningSince: NOW - 3 * MIN });
    expect(t.signal).toEqual({ tone: 'err', edge: 'is-lit is-critical', sweep: false, need: 'err' });
    expect(t.lamp).toEqual({ tone: 'err', lit: true });
  });

  it('a plain run sweeps in the run tone, rest and off do not', () => {
    expect(personaTail({ ...base, kind: 'working', runningSince: NOW - MIN }).signal).toEqual({ tone: 'run', edge: 'is-working', sweep: true, need: null });
    expect(personaTail(base).signal.sweep).toBe(false);
    expect(personaTail({ ...base, kind: 'off', runningSince: NOW - MIN }).signal).toEqual({ tone: 'off', edge: 'is-off', sweep: false, need: null });
  });
});
