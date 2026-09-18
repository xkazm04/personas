import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { StyleCandidate } from '@/lib/bindings/StyleCandidate';
import type { StyleToneDraft } from '@/lib/bindings/StyleToneDraft';
import type { TwinStyleDims } from '@/lib/bindings/TwinStyleDims';

const mockRoll = vi.fn();
const mockMaterialize = vi.fn();
const mockApply = vi.fn();
vi.mock('@/api/twin/twin', () => ({
  rollTwinStyles: (...a: unknown[]) => mockRoll(...a),
  materializeTwinStyle: (...a: unknown[]) => mockMaterialize(...a),
  applyTwinStyle: (...a: unknown[]) => mockApply(...a),
}));

const mockFetchTones = vi.fn().mockResolvedValue(undefined);
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: <T,>(selector: (s: Record<string, unknown>) => T): T =>
    selector({ fetchTwinTones: mockFetchTones }),
}));

const T = {
  twin: {
    style: {
      presets: new Proxy(
        {},
        { get: (_target, id) => ({ name: `name:${String(id)}`, summary: 's', avoid: 'Never x' }) },
      ),
    },
  },
};
vi.mock('@/i18n/useTranslation', () => ({ useTranslation: () => ({ t: T, tx: (s: string) => s }) }));

vi.mock('@/lib/silentCatch', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/silentCatch');
  return { ...actual, toastCatch: () => () => {}, silentCatch: () => () => {} };
});

import { useStyleStudio } from '../useStyleStudio';

const D = (n: number): TwinStyleDims => ({
  formality: n,
  warmth: n,
  humor: n,
  energy: n,
  length: n,
  directness: n,
  expressiveness: 2,
  detail: n,
});
const cand = (id: string, n: number): StyleCandidate => ({
  id,
  name: `c${id}`,
  summary: 's',
  avoid: 'Never',
  dims: D(n),
  sample: 'hi',
});
const draft = (channel: string): StyleToneDraft => ({
  channel,
  voiceDirectives: `v-${channel}`,
  examples: ['a'],
  constraints: [],
  lengthHint: 'short',
  dims: D(3),
});

const CHANNELS = ['generic', 'email', 'discord'];

function setup() {
  return renderHook(() => useStyleStudio('t1', CHANNELS));
}

beforeEach(() => {
  mockRoll.mockReset();
  mockMaterialize.mockReset();
  mockApply.mockReset();
  mockFetchTones.mockClear();
});

describe('useStyleStudio', () => {
  it('pick preset -> materializing -> preview -> accept applies only ticked channels', async () => {
    let resolve: (d: StyleToneDraft[]) => void = () => {};
    mockMaterialize.mockReturnValue(
      new Promise<StyleToneDraft[]>((r) => {
        resolve = r;
      }),
    );
    const { result } = setup();

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.pickPreset('executive-brief');
    });
    expect(result.current.phase).toBe('materializing');
    expect(result.current.chosen).toMatchObject({
      source: 'preset',
      presetId: 'executive-brief',
      name: 'name:executive-brief',
    });

    const [, style, targets] = mockMaterialize.mock.calls[0];
    expect(style.dims.formality).toBe(5);
    expect(targets.map((t: { channel: string }) => t.channel)).toEqual(CHANNELS);

    await act(async () => {
      resolve(CHANNELS.map(draft));
      await pending;
    });
    expect(result.current.phase).toBe('preview');
    expect([...result.current.selectedChannels].sort()).toEqual([...CHANNELS].sort());

    act(() => result.current.toggleChannel('email'));
    mockApply.mockResolvedValue([]);
    await act(async () => {
      await result.current.accept();
    });

    expect(mockApply).toHaveBeenCalledTimes(1);
    const applied = mockApply.mock.calls[0][2] as StyleToneDraft[];
    expect(applied.map((d) => d.channel)).toEqual(['generic', 'discord']);
    expect(mockFetchTones).toHaveBeenCalledWith('t1');
    expect(result.current.phase).toBe('browse');
    expect(result.current.drafts).toEqual([]);
  });

  it('accept with no channel ticked writes nothing', async () => {
    mockMaterialize.mockResolvedValueOnce([draft('generic')]);
    const { result } = setup();
    await act(async () => {
      await result.current.pickPreset('witty-wry');
    });
    act(() => result.current.toggleChannel('generic'));
    await act(async () => {
      await result.current.accept();
    });
    expect(mockApply).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('preview');
  });

  it('keeps previous candidates and reports inline when a reroll fails', async () => {
    mockRoll.mockResolvedValueOnce([cand('a', 1), cand('b', 3), cand('c', 5)]);
    const { result } = setup();
    await act(async () => {
      await result.current.roll();
    });
    expect(result.current.phase).toBe('candidates');

    mockRoll.mockRejectedValueOnce(new Error('model down'));
    await act(async () => {
      await result.current.roll();
    });
    expect(result.current.phase).toBe('candidates');
    expect(result.current.candidates.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(result.current.error?.step).toBe('roll');
  });

  it('returns to browse when the first roll fails', async () => {
    mockRoll.mockRejectedValueOnce(new Error('nope'));
    const { result } = setup();
    await act(async () => {
      await result.current.roll();
    });
    expect(result.current.phase).toBe('browse');
    expect(result.current.error?.step).toBe('roll');
  });

  it('reroll sends pins and every seen candidate as avoid', async () => {
    mockRoll.mockResolvedValueOnce([cand('a', 1), cand('b', 3), cand('c', 5)]);
    const { result } = setup();
    await act(async () => {
      await result.current.roll();
    });
    expect(mockRoll.mock.calls[0][2]).toEqual([]);

    act(() => result.current.togglePin('humor', 4));
    mockRoll.mockResolvedValueOnce([cand('d', 2), cand('e', 4), cand('f', 2)]);
    await act(async () => {
      await result.current.roll();
    });

    const [twinId, pins, avoid] = mockRoll.mock.calls[1];
    expect(twinId).toBe('t1');
    expect(pins).toMatchObject({ humor: 4, formality: null });
    expect(avoid).toEqual([D(1), D(3), D(5)]);

    mockRoll.mockResolvedValueOnce([cand('g', 1), cand('h', 1), cand('i', 1)]);
    await act(async () => {
      await result.current.roll();
    });
    expect(mockRoll.mock.calls[2][2]).toHaveLength(6);
  });

  it('toggling the same pin twice releases it', () => {
    const { result } = setup();
    act(() => result.current.togglePin('warmth', 5));
    expect(result.current.pins.warmth).toBe(5);
    act(() => result.current.togglePin('warmth', 5));
    expect(result.current.pins.warmth).toBeNull();
  });

  it('a candidate pick returns to the candidates on back()', async () => {
    mockRoll.mockResolvedValueOnce([cand('a', 1), cand('b', 3), cand('c', 5)]);
    mockMaterialize.mockResolvedValueOnce(CHANNELS.map(draft));
    const { result } = setup();
    await act(async () => {
      await result.current.roll();
    });
    await act(async () => {
      await result.current.pickCandidate('b');
    });
    expect(result.current.phase).toBe('preview');
    expect(result.current.chosen).toMatchObject({ source: 'rolled', presetId: null, name: 'cb' });
    act(() => result.current.back());
    expect(result.current.phase).toBe('candidates');
  });

  it('a failed materialize returns to where it came from', async () => {
    mockMaterialize.mockRejectedValueOnce(new Error('x'));
    const { result } = setup();
    await act(async () => {
      await result.current.pickPreset('witty-wry');
    });
    expect(result.current.phase).toBe('browse');
    expect(result.current.error?.step).toBe('materialize');
  });

  it('a later roll supersedes an earlier one', async () => {
    let first: (c: StyleCandidate[]) => void = () => {};
    mockRoll.mockReturnValueOnce(
      new Promise<StyleCandidate[]>((r) => {
        first = r;
      }),
    );
    mockRoll.mockResolvedValueOnce([cand('new', 2), cand('n2', 4), cand('n3', 1)]);
    const { result } = setup();
    let p1: Promise<void> = Promise.resolve();
    act(() => {
      p1 = result.current.roll();
    });
    await act(async () => {
      await result.current.roll();
    });
    await act(async () => {
      first([cand('old', 5), cand('o2', 5), cand('o3', 5)]);
      await p1;
    });
    expect(result.current.candidates[0].id).toBe('new');
  });

  it('a failed apply stays on the preview with its drafts', async () => {
    mockMaterialize.mockResolvedValueOnce(CHANNELS.map(draft));
    mockApply.mockRejectedValueOnce(new Error('db'));
    const { result } = setup();
    await act(async () => {
      await result.current.pickPreset('warm-helpful');
    });
    await act(async () => {
      await result.current.accept();
    });
    expect(result.current.phase).toBe('preview');
    expect(result.current.drafts).toHaveLength(3);
    expect(result.current.error?.step).toBe('apply');
  });
});
