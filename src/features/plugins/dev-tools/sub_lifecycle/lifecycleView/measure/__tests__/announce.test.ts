import { describe, expect, it } from 'vitest';

import { announce, type AnnounceView, type AnnounceWords } from '../announce';
import { cmd, midMeasure, progress } from './progressFixtures';

const words: AnnounceWords = {
  preparing: 'Measure starting.',
  started: (n) => `Measure started: ${n} commands.`,
  done: (c) => `${c.commandId}: ${c.outcome}.`,
  cancelling: 'Cancelling.',
  ended: 'Measure finished. Gate At risk -> Healthy.',
};

const view = (phase: AnnounceView['phase'], p: AnnounceView['progress'] = null): AnnounceView => ({ phase, progress: p });

describe('the Measure live region', () => {
  it('says the start once, with the command count when the plan is known', () => {
    expect(announce(view('idle'), view('preparing'), words)).toBe('Measure starting.');
    expect(announce(view('preparing'), view('running', midMeasure()), words)).toBe('Measure started: 5 commands.');
    expect(announce(view('idle'), view('running', midMeasure()), words)).toBe('Measure started: 5 commands.');
  });

  it('says each command as it finishes, concisely, and only the new ones', () => {
    const one = progress([cmd({ commandId: 'tsc', kind: 'typecheck', state: 'running' }), cmd({ commandId: 'eslint', kind: 'lint', state: 'pending' })]);
    const two = progress([
      cmd({ commandId: 'tsc', kind: 'typecheck', state: 'done', outcome: 'passed' }),
      cmd({ commandId: 'eslint', kind: 'lint', state: 'running' }),
    ]);
    expect(announce(view('running', one), view('running', two), words)).toBe('tsc: passed.');
    // The same progress again (a refetch that moved nothing) says nothing.
    expect(announce(view('running', two), view('running', two), words)).toBeNull();
  });

  it('says a cancel on its way, then the summary once', () => {
    const p = midMeasure();
    expect(announce(view('running', p), view('cancelling', p), words)).toBe('Cancelling.');
    expect(announce(view('cancelling', p), view('ended', p), words)).toBe('Measure finished. Gate At risk -> Healthy.');
    expect(announce(view('ended', p), view('ended', p), words)).toBeNull();
    expect(announce(view('ended', p), view('idle'), words)).toBeNull();
  });
});
