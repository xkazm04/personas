/**
 * Unit tests for the Fleet terminal manager's lifecycle bookkeeping — the
 * attach/park/detach/dispose ladder, the parked LRU, and the resize push.
 *
 * xterm and the Tauri IPC surface are mocked at the module boundary: none of
 * the behaviour under test needs a real emulator, and a real one cannot paint
 * in jsdom. What IS real is the manager's own state machine (`registry`,
 * `parked`, `attached`, the cols/rows the child was last told about), which is
 * where every defect this file pins actually lived.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

class FakeTerminal {
  cols = 80;
  rows = 24;
  options: Record<string, unknown> = {};
  unicode = { activeVersion: '6' };
  disposed = false;
  written: string[] = [];
  loadAddon = vi.fn();
  open = vi.fn();
  focus = vi.fn();
  reset = vi.fn();
  hasSelection = vi.fn(() => false);
  getSelection = vi.fn(() => '');
  attachCustomKeyEventHandler = vi.fn();
  onData = vi.fn(() => ({ dispose: vi.fn() }));
  write(chunk: string) {
    this.written.push(chunk);
  }
  dispose() {
    this.disposed = true;
  }
}

const terminals: FakeTerminal[] = [];

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    constructor() {
      const t = new FakeTerminal();
      terminals.push(t);
      return t as unknown as this;
    }
  },
}));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    onContextLoss = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock('@/api/fleet/fleet', () => ({
  writeInput: vi.fn().mockResolvedValue(null),
  resizeSession: vi.fn().mockResolvedValue(null),
  subscribeTerminal: vi.fn().mockResolvedValue(''),
  unsubscribeTerminal: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/api/system/system', () => ({ openExternalUrl: vi.fn().mockResolvedValue(null) }));

import * as fleetApi from '@/api/fleet/fleet';
import {
  attachTerminal,
  configureFleetTerminals,
  detachTerminal,
  disposeTerminal,
  gcTerminals,
  getFleetTerminalStats,
} from '../fleetTerminalManager';

/** Let the manager's rAF-scheduled fit (and the resize push behind it) run. */
const flushFrames = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** The manager's HMR-safe singletons — reset between tests so the parked LRU
 *  starts from a known length instead of inheriting the previous case. */
function resetManager(): void {
  const g = globalThis as Record<string, unknown>;
  (g.__fleetTerminalRegistry__ as Map<string, unknown> | undefined)?.clear();
  (g.__fleetTerminalParked__ as string[] | undefined)?.splice(0);
  g.__fleetTerminalEvictions__ = 0;
}

const parkedList = () => (globalThis as Record<string, unknown>).__fleetTerminalParked__ as string[];
const registryMap = () =>
  (globalThis as Record<string, unknown>).__fleetTerminalRegistry__ as Map<
    string,
    { attached: boolean; term: FakeTerminal }
  >;

function attach(id: string): HTMLDivElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  attachTerminal(id, host);
  return host;
}

beforeEach(() => {
  resetManager();
  terminals.length = 0;
  vi.mocked(fleetApi.resizeSession).mockClear();
  vi.mocked(fleetApi.unsubscribeTerminal).mockClear();
  vi.mocked(fleetApi.subscribeTerminal).mockClear();
});

describe('parked LRU eviction', () => {
  it('drops a parked id whose registry entry is already gone instead of spinning forever', () => {
    // Seed the LRU past MAX_PARKED (6) with ids that have NO registry entry.
    // disposeTerminal early-returns for an unknown id WITHOUT unparking it, so
    // a loop that relies on disposeTerminal to shift the head never terminates.
    parkedList().push('ghost-1', 'ghost-2', 'ghost-3', 'ghost-4', 'ghost-5', 'ghost-6');

    const host = attach('live');
    detachTerminal('live');

    expect(parkedList()).toEqual(['ghost-2', 'ghost-3', 'ghost-4', 'ghost-5', 'ghost-6', 'live']);
    host.remove();
  });

  it('evicts (disposes) the oldest genuinely parked terminal beyond the budget', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    for (const id of ids) {
      const host = attach(id);
      detachTerminal(id);
      host.remove();
    }
    // 7 parked with a budget of 6 → the oldest ('a') is fully disposed.
    expect(parkedList()).toEqual(['b', 'c', 'd', 'e', 'f', 'g']);
    expect(registryMap().has('a')).toBe(false);
    expect(terminals[0]!.disposed).toBe(true);
  });

  it('never evicts a still-attached session that leaked into the parked list', () => {
    const host = attach('watched');
    parkedList().push('watched', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6');
    const other = attach('other');
    detachTerminal('other');

    expect(parkedList()).not.toContain('watched');
    expect(registryMap().get('watched')?.attached).toBe(true);
    detachTerminal('watched');
    host.remove();
    other.remove();
  });
});

describe('eviction accounting', () => {
  it('counts a real budget eviction so a too-low MAX_PARKED is distinguishable from a replay bug', () => {
    expect(getFleetTerminalStats().evictions).toBe(0);

    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    for (const id of ids) {
      const host = attach(id);
      detachTerminal(id);
      host.remove();
    }

    // 8 parked against a budget of 6 → exactly two terminals cost us their
    // scrollback. Without this number, the operator's "it went blank and
    // replayed" is indistinguishable from a bug in hydrate().
    const stats = getFleetTerminalStats();
    expect(stats.evictions).toBe(2);
    expect(stats.parked).toBe(stats.maxParked);
    expect(stats.live).toBe(stats.maxParked);
  });

  it('does not count the bookkeeping shifts as evictions', () => {
    // A ghost id (no registry entry) and a leaked attached id are both shifted
    // out of the LRU by hand. Neither cost a terminal, so neither may inflate
    // the instrument — a counter that fires on repairs would send an operator
    // hunting a budget that was never hit.
    const host = attach('watched');
    parkedList().push('ghost-1', 'watched', 'p1', 'p2', 'p3', 'p4', 'p5');
    const other = attach('other');
    detachTerminal('other');

    expect(getFleetTerminalStats().evictions).toBe(0);
    detachTerminal('watched');
    host.remove();
    other.remove();
  });
});

describe('resize push', () => {
  it('pushes once per real grid change and skips the no-op re-push', async () => {
    const host = attach('r1');
    const m = registryMap().get('r1')!;
    await flushFrames();

    // Attach reconciles the size once.
    expect(vi.mocked(fleetApi.resizeSession).mock.calls).toEqual([['r1', 80, 24]]);

    // A layout/font event that leaves cols x rows alone must not reach the
    // child: every delivered resize makes it reflow and repaint the screen.
    configureFleetTerminals({ fontSize: 15 });
    await flushFrames();
    expect(vi.mocked(fleetApi.resizeSession).mock.calls).toEqual([['r1', 80, 24]]);

    // A genuine grid change is still pushed.
    m.term.cols = 100;
    configureFleetTerminals({ fontSize: 16 });
    await flushFrames();
    expect(vi.mocked(fleetApi.resizeSession).mock.calls).toEqual([
      ['r1', 80, 24],
      ['r1', 100, 24],
    ]);

    detachTerminal('r1');
    host.remove();
  });

  it('re-reconciles the size on a fresh attach even into identical geometry', async () => {
    const host = attach('r2');
    await flushFrames();
    detachTerminal('r2');
    vi.mocked(fleetApi.resizeSession).mockClear();

    attach('r2');
    await flushFrames();
    expect(vi.mocked(fleetApi.resizeSession).mock.calls).toEqual([['r2', 80, 24]]);
    detachTerminal('r2');
    host.remove();
  });
});

describe('disposeTerminal', () => {
  it('unsubscribes the backend stream when disposing a still-attached terminal', () => {
    const host = attach('gc-me');
    expect(registryMap().get('gc-me')?.attached).toBe(true);
    vi.mocked(fleetApi.unsubscribeTerminal).mockClear();

    gcTerminals(new Set<string>());

    expect(vi.mocked(fleetApi.unsubscribeTerminal)).toHaveBeenCalledWith('gc-me');
    expect(registryMap().has('gc-me')).toBe(false);
    host.remove();
  });

  it('does not unsubscribe again for a terminal that was already detached', () => {
    const host = attach('done');
    detachTerminal('done');
    vi.mocked(fleetApi.unsubscribeTerminal).mockClear();

    disposeTerminal('done');

    expect(vi.mocked(fleetApi.unsubscribeTerminal)).not.toHaveBeenCalled();
    host.remove();
  });
});
