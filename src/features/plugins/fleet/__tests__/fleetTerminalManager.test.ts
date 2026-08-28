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
  /** The child's DECSET 2004 state — what decides whether a paste is framed. */
  modes = { bracketedPasteMode: false };
  dataHandler: ((data: string) => void) | null = null;
  onData = vi.fn((handler: (data: string) => void) => {
    this.dataHandler = handler;
    return { dispose: vi.fn() };
  });
  /** Mirrors xterm's own `paste()` — normalize CRLF/LF to CR, bracket when the
   *  child enabled the mode, emit through onData — so a test can prove the
   *  manager routes through it rather than writing raw bytes to the PTY. */
  paste(data: string) {
    const normalized = data.replace(/\r?\n/g, '\r');
    this.dataHandler?.(
      this.modes.bracketedPasteMode ? `\x1b[200~${normalized}\x1b[201~` : normalized,
    );
  }
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
/** Capture the ONE shared `fleet-session-output` handler so a test can deliver
 *  live PTY chunks into the manager exactly as the backend would. Held in a
 *  vi.hoisted box because a vi.mock factory runs before module-level lets. */
const listenBox = vi.hoisted(() => ({
  handler: null as ((e: { payload: { session_id: string; chunk: string } }) => void) | null,
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_name: string, handler: (e: { payload: { session_id: string; chunk: string } }) => void) => {
    listenBox.handler = handler;
    return Promise.resolve(() => {});
  }),
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
  setFleetTerminalDeadNotice,
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
  (g.__fleetTerminalWebglLru__ as string[] | undefined)?.splice(0);
  g.__fleetTerminalEvictions__ = 0;
  g.__fleetTerminalWebglEvictions__ = 0;
}

const parkedList = () => (globalThis as Record<string, unknown>).__fleetTerminalParked__ as string[];
const registryMap = () =>
  (globalThis as Record<string, unknown>).__fleetTerminalRegistry__ as Map<
    string,
    {
      attached: boolean;
      deadNoticeShown: boolean;
      term: FakeTerminal;
      webgl: { dispose: () => void } | null;
      holder: HTMLDivElement;
    }
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

/**
 * The replay-then-splice handshake — the manager's subtlest logic, and the only
 * part of it whose failure mode is invisible: every one of these interleavings
 * loses or duplicates scrollback in a way that looks like a rendering glitch.
 *
 * The contract hydrate() implements: while a subscribe is in flight, live
 * chunks are HELD (never interleaved with the snapshot); the snapshot is
 * written after a reset; the held chunks are flushed after it, in order; and a
 * newer attach/detach voids an older snapshot resolution outright.
 */
describe('hydration handshake', () => {
  /** Deliver a live PTY chunk through the ONE shared output listener. */
  const emit = (sessionId: string, chunk: string) =>
    listenBox.handler?.({ payload: { session_id: sessionId, chunk } });

  /** Let the promise chains inside hydrate() settle. */
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it('writes the snapshot first, then the chunks that arrived while it was in flight', async () => {
    let resolveSnapshot!: (s: string) => void;
    vi.mocked(fleetApi.subscribeTerminal).mockImplementationOnce(
      () => new Promise<string>((r) => (resolveSnapshot = r)),
    );

    const host = attach('h-order');
    const m = registryMap().get('h-order')!;

    // Held, not written — interleaving these with the snapshot is what
    // produces duplicated or out-of-order scrollback.
    emit('h-order', 'LIVE-A');
    emit('h-order', 'LIVE-B');
    expect(m.term.written).toEqual([]);

    resolveSnapshot('SNAP');
    await settle();

    expect(m.term.reset).toHaveBeenCalledTimes(1);
    expect(m.term.written).toEqual(['SNAP', 'LIVE-A', 'LIVE-B']);

    detachTerminal('h-order');
    host.remove();
  });

  it('voids a snapshot that resolves after the pane has detached', async () => {
    let resolveSnapshot!: (s: string) => void;
    vi.mocked(fleetApi.subscribeTerminal).mockImplementationOnce(
      () => new Promise<string>((r) => (resolveSnapshot = r)),
    );

    const host = attach('h-void');
    const m = registryMap().get('h-void')!;
    emit('h-void', 'LIVE-A');

    // The operator switched away mid-fetch. Painting the snapshot now would
    // write the ring tail into a terminal nobody is watching, and the NEXT
    // attach would replay it again on top.
    detachTerminal('h-void');
    resolveSnapshot('SNAP');
    await settle();

    expect(m.term.written).toEqual([]);
    expect(m.term.reset).not.toHaveBeenCalled();
    host.remove();
  });

  it('drops a superseded snapshot when a second attach starts before the first resolves', async () => {
    let resolveFirst!: (s: string) => void;
    let resolveSecond!: (s: string) => void;
    vi.mocked(fleetApi.subscribeTerminal)
      .mockImplementationOnce(() => new Promise<string>((r) => (resolveFirst = r)))
      .mockImplementationOnce(() => new Promise<string>((r) => (resolveSecond = r)));

    const host1 = attach('h-gen');
    detachTerminal('h-gen');
    const host2 = attach('h-gen');
    const m = registryMap().get('h-gen')!;

    // Rapid switching: the FIRST subscribe lands late. hydrationGen has moved
    // on twice, so its snapshot is stale by definition and must be discarded —
    // writing it would show the older ring tail under the newer one.
    resolveFirst('STALE-SNAP');
    await settle();
    expect(m.term.written).toEqual([]);

    resolveSecond('FRESH-SNAP');
    await settle();
    expect(m.term.written).toEqual(['FRESH-SNAP']);

    detachTerminal('h-gen');
    host1.remove();
    host2.remove();
  });

  it('stops hydrating when subscribe rejects, so later chunks render instead of piling up', async () => {
    vi.mocked(fleetApi.subscribeTerminal).mockRejectedValueOnce(
      new Error('session not found: h-rej'),
    );

    const host = attach('h-rej');
    const m = registryMap().get('h-rej')!;
    emit('h-rej', 'QUEUED-BEFORE-FAILURE');
    await settle();

    // The queue is dropped with the failed hydration (there is no snapshot to
    // splice it onto). What must NOT happen is `hydrating` staying true — that
    // would make every subsequent chunk accumulate in pendingLive forever,
    // leaving a permanently blank terminal fed by a growing array.
    expect(m.term.written).toEqual([]);

    emit('h-rej', 'AFTER-FAILURE');
    expect(m.term.written).toEqual(['AFTER-FAILURE']);

    detachTerminal('h-rej');
    host.remove();
  });

  it('paints a dead-session notice into the terminal when subscribe rejects', async () => {
    setFleetTerminalDeadNotice('Session is gone.');
    vi.mocked(fleetApi.subscribeTerminal).mockRejectedValueOnce(new Error('session not found'));

    const host = attach('h-dead');
    const m = registryMap().get('h-dead')!;
    await settle();

    // The whole defect: this used to be an empty black box, indistinguishable
    // from a session that had simply printed nothing yet.
    expect(m.term.written.join('')).toContain('Session is gone.');

    detachTerminal('h-dead');
    host.remove();
    setFleetTerminalDeadNotice('');
  });

  it('does not stack the notice on a repeated failure, and clears it once the session answers', async () => {
    setFleetTerminalDeadNotice('Session is gone.');
    vi.mocked(fleetApi.subscribeTerminal)
      .mockRejectedValueOnce(new Error('gone'))
      .mockRejectedValueOnce(new Error('gone again'))
      .mockResolvedValueOnce('BACK');

    const host = attach('h-dead2');
    const m = registryMap().get('h-dead2')!;
    await settle();
    // Re-attach into the same container without detaching: a second failure
    // must not append a second tombstone under the first.
    attachTerminal('h-dead2', host);
    await settle();

    const notices = m.term.written.filter((w) => w.includes('Session is gone.'));
    expect(notices).toHaveLength(1);

    // Third attach succeeds — reset() wipes the tombstone, and the flag must
    // reopen so a LATER death is reported again.
    attachTerminal('h-dead2', host);
    await settle();
    expect(m.deadNoticeShown).toBe(false);

    detachTerminal('h-dead2');
    host.remove();
    setFleetTerminalDeadNotice('');
  });

  it('paints nothing when no translated notice has been pushed in', async () => {
    // The manager has no `t`. Rather than fall back to hardcoded English it
    // stays silent until the pane hands it a translated string.
    setFleetTerminalDeadNotice('');
    vi.mocked(fleetApi.subscribeTerminal).mockRejectedValueOnce(new Error('nope'));

    const host = attach('h-quiet');
    const m = registryMap().get('h-quiet')!;
    await settle();

    expect(m.term.written).toEqual([]);
    detachTerminal('h-quiet');
    host.remove();
  });

  it('ignores chunks for a session with no terminal in the registry', () => {
    // The backend only emits for subscribed sessions, but a dispose racing an
    // in-flight chunk must be a no-op rather than a throw inside the ONE shared
    // listener — a throw there would take down delivery for every session.
    expect(() => emit('nobody-home', 'x')).not.toThrow();
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

describe('accelerated-renderer budget', () => {
  const glLru = () => (globalThis as Record<string, unknown>).__fleetTerminalWebglLru__ as string[];

  it('bounds how many ATTACHED terminals hold a GL context at once', () => {
    // Eight panes live at once — the grid overlay does exactly this when many
    // sessions go `awaiting_input` together. Before the budget every one of
    // them loaded a renderer and the PLATFORM decided which context to revoke.
    const hosts = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'].map((id) => attach(id));

    const stats = getFleetTerminalStats();
    expect(stats.maxWebgl).toBe(6);
    expect(stats.webgl).toBe(6);
    expect(glLru()).toEqual(['g3', 'g4', 'g5', 'g6', 'g7', 'g8']);
    // The two oldest were dropped to the DOM fallback, deliberately, and counted.
    expect(registryMap().get('g1')?.webgl).toBeNull();
    expect(registryMap().get('g2')?.webgl).toBeNull();
    expect(stats.webglEvictions).toBe(2);
    // The terminal that just asked is never its own victim.
    expect(registryMap().get('g8')?.webgl).not.toBeNull();

    hosts.forEach((h) => h.remove());
  });

  it('disposes the evicted addon rather than orphaning the context', () => {
    const hosts = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'].map((id) => attach(id));
    const victim = registryMap().get('d1')?.webgl;
    expect(victim).toBeTruthy();
    const disposeSpy = vi.spyOn(victim!, 'dispose');

    hosts.push(attach('d7'));

    expect(disposeSpy).toHaveBeenCalled();
    expect(registryMap().get('d1')?.webgl).toBeNull();
    hosts.forEach((h) => h.remove());
  });

  it('re-attaching an accelerated session refreshes its place in the LRU', () => {
    const hosts = ['t1', 't2', 't3', 't4', 't5', 't6'].map((id) => attach(id));
    // t1 is the oldest — touch it, and t2 becomes the next victim instead.
    hosts.push(attach('t1'));
    hosts.push(attach('t7'));

    expect(registryMap().get('t1')?.webgl).not.toBeNull();
    expect(registryMap().get('t2')?.webgl).toBeNull();
    expect(glLru()).toEqual(['t3', 't4', 't5', 't6', 't1', 't7']);
    hosts.forEach((h) => h.remove());
  });

  it('returns the budget when a pane detaches, so parked terminals cost no context', () => {
    const hosts = ['p1', 'p2'].map((id) => attach(id));
    expect(getFleetTerminalStats().webgl).toBe(2);

    detachTerminal('p1');

    expect(getFleetTerminalStats().webgl).toBe(1);
    expect(glLru()).toEqual(['p2']);
    hosts.forEach((h) => h.remove());
  });
});

describe('attach ownership', () => {
  it('ignores a detach from a pane that no longer holds the terminal', () => {
    const paneA = document.createElement('div');
    const paneB = document.createElement('div');
    document.body.append(paneA, paneB);
    attachTerminal('owned', paneA);
    attachTerminal('owned', paneB); // B takes the holder
    vi.mocked(fleetApi.unsubscribeTerminal).mockClear();

    // A unmounts first. Without an owner token this ran the FULL teardown on
    // the terminal B is still showing: unsubscribe, drop the renderer, unparent.
    detachTerminal('owned', paneA);

    expect(vi.mocked(fleetApi.unsubscribeTerminal)).not.toHaveBeenCalled();
    expect(registryMap().get('owned')?.attached).toBe(true);
    expect(registryMap().get('owned')?.holder.parentElement).toBe(paneB);
    expect(parkedList()).not.toContain('owned');

    paneA.remove();
    paneB.remove();
  });

  it('still tears down when the owning pane detaches', () => {
    const paneA = document.createElement('div');
    const paneB = document.createElement('div');
    document.body.append(paneA, paneB);
    attachTerminal('owned2', paneA);
    attachTerminal('owned2', paneB);
    vi.mocked(fleetApi.unsubscribeTerminal).mockClear();

    detachTerminal('owned2', paneB);

    expect(vi.mocked(fleetApi.unsubscribeTerminal)).toHaveBeenCalledWith('owned2');
    expect(registryMap().get('owned2')?.attached).toBe(false);
    expect(parkedList()).toContain('owned2');

    paneA.remove();
    paneB.remove();
  });

  it('detaches unconditionally when no owner token is passed', () => {
    const host = attach('unowned');
    vi.mocked(fleetApi.unsubscribeTerminal).mockClear();

    detachTerminal('unowned');

    expect(vi.mocked(fleetApi.unsubscribeTerminal)).toHaveBeenCalledWith('unowned');
    expect(registryMap().get('unowned')?.attached).toBe(false);
    host.remove();
  });
});

describe('clipboard paste framing', () => {
  const readText = vi.fn<() => Promise<string>>();

  beforeEach(() => {
    readText.mockReset();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText, writeText: vi.fn().mockResolvedValue(undefined) },
    });
    vi.mocked(fleetApi.writeInput).mockClear();
  });

  /** Right-click is one of the two paste doors (Ctrl+Shift+V / Cmd+V is the
   *  other, and both land in the same function). */
  function rightClickPaste(id: string): void {
    registryMap().get(id)!.holder.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
  }

  /** Let the clipboard promise chain settle. */
  const flushMicrotasks = () => new Promise<void>((r) => setTimeout(r, 0));

  it('frames a multi-line paste so the shell inserts the lines instead of running them', async () => {
    const host = attach('paste-bracketed');
    registryMap().get('paste-bracketed')!.term.modes.bracketedPasteMode = true;
    readText.mockResolvedValue('foo\nbar\nbaz');

    rightClickPaste('paste-bracketed');
    await flushMicrotasks();

    // Every line after the first used to EXECUTE, because a bare newline at a
    // shell prompt is a submit. The brackets are what make it an insert.
    expect(vi.mocked(fleetApi.writeInput)).toHaveBeenCalledWith(
      'paste-bracketed',
      '\x1b[200~foo\rbar\rbaz\x1b[201~',
    );
    host.remove();
  });

  it('keeps the trailing newline the operator copied when the child brackets pastes', async () => {
    const host = attach('paste-trailing');
    registryMap().get('paste-trailing')!.term.modes.bracketedPasteMode = true;
    readText.mockResolvedValue('deploy --prod\n');

    rightClickPaste('paste-trailing');
    await flushMicrotasks();

    expect(vi.mocked(fleetApi.writeInput)).toHaveBeenCalledWith(
      'paste-trailing',
      '\x1b[200~deploy --prod\r\x1b[201~',
    );
    host.remove();
  });

  it('still strips the trailing newline for a child that has NOT enabled bracketed paste', async () => {
    const host = attach('paste-plain');
    readText.mockResolvedValue('echo hi\n');

    rightClickPaste('paste-plain');
    await flushMicrotasks();

    expect(vi.mocked(fleetApi.writeInput)).toHaveBeenCalledWith('paste-plain', 'echo hi');
    host.remove();
  });

  it('does nothing for an empty clipboard', async () => {
    const host = attach('paste-empty');
    readText.mockResolvedValue('');

    rightClickPaste('paste-empty');
    await flushMicrotasks();

    expect(vi.mocked(fleetApi.writeInput)).not.toHaveBeenCalled();
    host.remove();
  });
});
