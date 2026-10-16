import { describe, expect, it } from 'vitest';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import { lineEdgeClass } from './LineParts';
import { sessionSentence, sessionTail, type SessionStrings } from './sessionTailModel';

const NOW = Date.parse('2026-10-16T10:00:00Z');
const tail = (state: FleetSessionState, exitCode: number | null = null, minutes = 22) =>
  sessionTail({ state, exitCode, startedAt: NOW - minutes * 60_000, now: NOW });

describe('sessionTail: state -> lamp and edge (the persona line\'s grammar)', () => {
  it('a running session keeps only the run edge and lights the run lamp', () => {
    const t = tail('running');
    expect(t.kind).toBe('working');
    expect(lineEdgeClass(t.kind)).toBe('is-working');
    expect(t.lamp).toEqual({ tone: 'run', lit: true });
    expect(t.word).toBe(false);
  });

  it('awaiting input and stale need you: lit edge, lit amber lamp, the word shown', () => {
    for (const s of ['awaiting_input', 'stale'] as const) {
      const t = tail(s);
      expect(t.kind).toBe('warning');
      expect(lineEdgeClass(t.kind)).toBe('is-lit');
      expect(t.lamp).toEqual({ tone: 'warn', lit: true });
      expect(t.word).toBe(true);
    }
  });

  it('a failed exit is critical: the stronger edge and a lit error lamp', () => {
    const t = tail('exited', 1);
    expect(t.kind).toBe('critical');
    expect(lineEdgeClass(t.kind)).toBe('is-lit is-critical');
    expect(t.lamp).toEqual({ tone: 'err', lit: true });
  });

  it('queued, idle and finished rest: no edge, a dark lamp in sessionLamp\'s tone', () => {
    expect(tail('queued').lamp).toEqual({ tone: 'off', lit: false });
    expect(tail('idle').lamp).toEqual({ tone: 'off', lit: false });
    expect(tail('finished').lamp).toEqual({ tone: 'off', lit: false });
    for (const s of ['queued', 'idle', 'finished'] as const) expect(lineEdgeClass(tail(s).kind)).toBe('');
  });

  it('a clean exit and an expired row are drawn off', () => {
    expect(lineEdgeClass(tail('exited', 0).kind)).toBe('is-off');
    expect(lineEdgeClass(tail('expired').kind)).toBe('is-off');
    expect(tail('exited', 0).lamp.lit).toBe(false);
  });

  it('the figure is the session age, compact', () => {
    expect(tail('idle', null, 22).age).toBe('22m');
    expect(tail('idle', null, 180).age).toBe('3h');
  });
});

const M: SessionStrings = {
  node_symbol_origin: 'Dispatched by {origin}',
  node_symbol_project: 'Project {name}',
  node_symbol_elapsed: 'Running for {time}',
  remote_on_device: 'On {device}',
};
const tx = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k]));

describe('sessionSentence', () => {
  it('says the whole line in one sentence, in reading order', () => {
    expect(sessionSentence({ label: 'Bump vite', stateLabel: 'Running', originLabel: 'Dev runner', project: 'personas', age: '4m' }, M, tx))
      .toBe('Bump vite · Running · Dispatched by Dev runner · Project personas · Running for 4m');
  });

  it('leaves out a part with nothing behind it, and names a device', () => {
    expect(sessionSentence({ label: 'Docs pass', stateLabel: null, device: 'Studio', age: '1h' }, M, tx))
      .toBe('Docs pass · On Studio · Running for 1h');
  });
});

describe('sessions speak the persona line\'s one rule (polish P1, item 5)', () => {
  it('a running session sweeps in the run tone; one waiting on you is amber with no sweep', () => {
    expect(tail('running').signal).toEqual({ tone: 'run', edge: 'is-working', sweep: true, need: null });
    expect(tail('awaiting_input').signal).toEqual({ tone: 'warn', edge: 'is-lit', sweep: false, need: 'warn' });
    expect(tail('exited', 1).signal).toEqual({ tone: 'err', edge: 'is-lit is-critical', sweep: false, need: 'err' });
  });

  it('the edge the line draws is the rule\'s edge, and the tone the lamp\'s', () => {
    for (const s of ['running', 'awaiting_input', 'stale', 'queued', 'finished'] as const) {
      const t = tail(s);
      expect(t.signal.edge).toBe(lineEdgeClass(t.kind, t.kind === 'working'));
      if (t.lamp.lit) expect(t.signal.tone).toBe(t.tone);
    }
  });
});
