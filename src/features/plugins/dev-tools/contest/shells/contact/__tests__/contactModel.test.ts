import { describe, expect, it, vi } from 'vitest';

import { summaryFixture } from '../../../__tests__/fixtures';
import {
  bucketForKey,
  chainRail,
  frameMode,
  groupRolls,
  seatSpecForVariant,
  specParts,
  stepKey,
} from '../contactModel';
import { fill } from '../copy';
import { dispatchLoupeKey, type LoupeKeyActions } from '../useLoupeKeys';

describe('groupRolls', () => {
  it('nests refine rounds under their parent, oldest round first', () => {
    const root = summaryFixture({ contestId: 'root' });
    const r3 = summaryFixture({ contestId: 'r3', parentId: 'r2', round: 3 });
    const r2 = summaryFixture({ contestId: 'r2', parentId: 'root', round: 2 });
    const other = summaryFixture({ contestId: 'other' });
    const rolls = groupRolls([r3, other, r2, root]);
    expect(rolls.map((r) => [r.summary.contestId, r.depth])).toEqual([
      ['other', 0],
      ['root', 0],
      ['r2', 1],
      ['r3', 2],
    ]);
  });

  it('keeps an orphaned round as a root and never drops a cycle', () => {
    const orphan = summaryFixture({ contestId: 'kid', parentId: 'gone', round: 2 });
    const a = summaryFixture({ contestId: 'a', parentId: 'b' });
    const b = summaryFixture({ contestId: 'b', parentId: 'a' });
    const ids = groupRolls([orphan, a, b]).map((r) => r.summary.contestId);
    expect(ids).toHaveLength(3);
    expect(ids).toContain('kid');
    expect(ids).toContain('a');
    expect(ids).toContain('b');
  });

  it('does not nest across projects', () => {
    const parent = summaryFixture({ projectId: 'p1', contestId: 'x' });
    const child = summaryFixture({ projectId: 'p2', contestId: 'y', parentId: 'x' });
    expect(groupRolls([parent, child]).map((r) => r.depth)).toEqual([0, 0]);
  });
});

describe('frameMode', () => {
  const base = { present: true, previewUrl: 'http://x/index.html', screenshots: [] as string[] };
  it('prefers a screenshot, then live only when developed, else latent', () => {
    expect(frameMode({ ...base, screenshots: ['s.png'] }, true)).toBe('screenshot');
    expect(frameMode(base, true)).toBe('live');
    expect(frameMode(base, false)).toBe('latent');
    expect(frameMode({ ...base, previewUrl: null }, true)).toBe('latent');
    expect(frameMode({ ...base, present: false }, true)).toBe('missing');
  });
});

describe('stepKey', () => {
  it('wraps around and starts at the first key', () => {
    const keys = ['A/1', 'A/2', 'B/1'];
    expect(stepKey(keys, 'B/1', 1)).toBe('A/1');
    expect(stepKey(keys, 'A/1', -1)).toBe('B/1');
    expect(stepKey(keys, null, 1)).toBe('A/1');
    expect(stepKey([], 'A/1', 1)).toBeNull();
  });
});

describe('specParts and seats', () => {
  it('splits a spec and tolerates odd tokens', () => {
    expect(specParts('claude:claude-opus-5-5@xhigh#b')).toEqual({
      engine: 'claude',
      model: 'claude-opus-5-5',
      effort: 'xhigh',
      label: 'b',
    });
    expect(specParts('weird')).toEqual({ engine: 'weird', model: '', effort: '', label: null });
  });

  it('maps a variant to the participant seat that made it', () => {
    const detail = {
      seats: [
        { seatId: 's1', spec: 'grok:grok-4.6@high', kind: 'judge' as const },
        { seatId: 's1', spec: 'codex:gpt-6-sol@high', kind: 'participant' as const },
      ],
    };
    // Only the fields the helper reads matter here.
    expect(seatSpecForVariant(detail as never, { seatId: 's1' })).toBe('codex:gpt-6-sol@high');
    expect(seatSpecForVariant(detail as never, { seatId: 'nope' })).toBeNull();
  });
});

describe('chainRail', () => {
  it('marks steps done / active / todo, and skips judges when off', () => {
    expect(chainRail('visual', false)).toEqual([
      { step: 'collect', state: 'done' },
      { step: 'visual', state: 'active' },
      { step: 'ready', state: 'todo' },
    ]);
    expect(chainRail('judging', true).map((r) => r.state)).toEqual(['done', 'done', 'active', 'todo']);
    expect(chainRail('ready', true).every((r) => r.state === 'done')).toBe(true);
    expect(chainRail('idle', true).every((r) => r.state === 'todo')).toBe(true);
    expect(chainRail('failed', false).every((r) => r.state === 'failed')).toBe(true);
  });
});

describe('grease pencil keys', () => {
  it('maps the typed glyph to its tray', () => {
    expect(bucketForKey('x')).toBe('failure');
    expect(bucketForKey('~')).toBe('impractical');
    expect(bucketForKey('o')).toBe('shortlist');
    expect(bucketForKey('*')).toBe('winner');
    expect(bucketForKey('q')).toBeNull();
  });

  function actions(): LoupeKeyActions {
    return { step: vi.fn(), mark: vi.fn(), togglePin: vi.fn(), back: vi.fn() };
  }
  const key = (k: string, target: EventTarget | null = null, mods: Partial<KeyboardEvent> = {}) => ({
    key: k,
    target,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...mods,
  });

  it('dispatches loupe keys', () => {
    const a = actions();
    expect(dispatchLoupeKey(key('ArrowRight'), a)).toBe(true);
    expect(a.step).toHaveBeenCalledWith(1);
    expect(dispatchLoupeKey(key('*'), a)).toBe(true);
    expect(a.mark).toHaveBeenCalledWith('winner');
    expect(dispatchLoupeKey(key('p'), a)).toBe(true);
    expect(a.togglePin).toHaveBeenCalled();
    expect(dispatchLoupeKey(key('Escape'), a)).toBe(true);
    expect(a.back).toHaveBeenCalled();
    expect(dispatchLoupeKey(key('q'), a)).toBe(false);
  });

  it('never steals keys from a text field or a modified chord', () => {
    const a = actions();
    const textarea = document.createElement('textarea');
    expect(dispatchLoupeKey(key('x', textarea), a)).toBe(false);
    expect(dispatchLoupeKey(key('ArrowLeft', document.createElement('input')), a)).toBe(false);
    expect(dispatchLoupeKey(key('x', null, { ctrlKey: true }), a)).toBe(false);
    expect(a.mark).not.toHaveBeenCalled();
    expect(a.step).not.toHaveBeenCalled();
  });
});

describe('fill', () => {
  it('substitutes named slots and leaves unknown ones', () => {
    expect(fill('Roll {n} of {m}', { n: 2 })).toBe('Roll 2 of {m}');
  });
});
