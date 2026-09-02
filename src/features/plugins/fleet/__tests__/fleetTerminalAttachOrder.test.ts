/**
 * The attach path's ordering contract: the shared output listener is REGISTERED
 * before the first subscribe is issued.
 *
 * `attachTerminal` used to fire `ensureSharedOutputListener()` unawaited and
 * call `hydrate()` in the same tick. Rust flips `subscribed = true` atomically
 * under the ring lock and returns the snapshot in the same call
 * (`src-tauri/src/commands/fleet/registry.rs::subscribe_output`), so the instant
 * that call resolves the backend is emitting `fleet-session-output` — into a JS
 * listener that had not finished registering. Those chunks were dropped with no
 * error, no telemetry and no gap in the pane the operator was watching: the
 * snapshot painted, the terminal looked healthy, and the first seconds of live
 * output simply never existed. It bit on the app's FIRST attach and after every
 * listener failure/retry.
 *
 * These tests model that ordering faithfully rather than asserting on
 * implementation details: `listen()` resolves only when the test says so, and a
 * backend emission is delivered to whatever handler is registered AT THAT
 * INSTANT — dropped otherwise, which is exactly what the real event bus does.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

class FakeTerminal {
  cols = 80;
  rows = 24;
  options: Record<string, unknown> = {};
  unicode = { activeVersion: '6' };
  written: string[] = [];
  loadAddon = vi.fn();
  open = vi.fn();
  focus = vi.fn();
  reset = vi.fn();
  hasSelection = vi.fn(() => false);
  getSelection = vi.fn(() => '');
  attachCustomKeyEventHandler = vi.fn();
  modes = { bracketedPasteMode: false };
  onData = vi.fn(() => ({ dispose: vi.fn() }));
  write(chunk: string) {
    this.written.push(chunk);
  }
  dispose() {}
}

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    constructor() {
      return new FakeTerminal() as unknown as this;
    }
  },
}));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); } }));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    onContextLoss = vi.fn();
    dispose = vi.fn();
  },
}));

/**
 * A `listen()` the test controls. The handler is wired ONLY when the returned
 * promise resolves — which is what makes the pre-registration window real
 * instead of a formality the mock papers over.
 */
const listenBox = vi.hoisted(() => ({
  handler: null as ((e: { payload: { session_id: string; chunk: string } }) => void) | null,
  resolve: null as (() => void) | null,
  reject: null as ((e: Error) => void) | null,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(
    (_name: string, handler: (e: { payload: { session_id: string; chunk: string } }) => void) =>
      new Promise<() => void>((res, rej) => {
        listenBox.resolve = () => {
          listenBox.handler = handler;
          res(() => {});
        };
        listenBox.reject = (e: Error) => rej(e);
      }),
  ),
}));

vi.mock('@/api/fleet/fleet', () => ({
  writeInput: vi.fn().mockResolvedValue(null),
  resizeSession: vi.fn().mockResolvedValue(null),
  subscribeTerminal: vi.fn().mockResolvedValue('SNAP'),
  unsubscribeTerminal: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/api/system/system', () => ({ openExternalUrl: vi.fn().mockResolvedValue(null) }));

import * as fleetApi from '@/api/fleet/fleet';
import {
  attachTerminal,
  detachTerminal,
  setFleetTerminalListenerNotice,
} from '../fleetTerminalManager';

/** What the backend does: dispatch to whoever is listening right now. */
const backendEmits = (sessionId: string, chunk: string) =>
  listenBox.handler?.({ payload: { session_id: sessionId, chunk } });

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const registryMap = () =>
  (globalThis as Record<string, unknown>).__fleetTerminalRegistry__ as Map<
    string,
    { term: FakeTerminal }
  >;

beforeEach(() => {
  const g = globalThis as Record<string, unknown>;
  (g.__fleetTerminalRegistry__ as Map<string, unknown> | undefined)?.clear();
  (g.__fleetTerminalParked__ as string[] | undefined)?.splice(0);
  (g.__fleetTerminalWebglOrder__ as string[] | undefined)?.splice(0);
  (g.__fleetTerminalWebglLru__ as string[] | undefined)?.splice(0);
  g.__fleetTerminalOutputListener__ = undefined;
  listenBox.handler = null;
  listenBox.resolve = null;
  listenBox.reject = null;
  vi.mocked(fleetApi.subscribeTerminal).mockClear();
});

function attach(id: string): HTMLDivElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  attachTerminal(id, host);
  return host;
}

describe('attach ordering — listener before subscribe', () => {
  it('does not issue the subscribe until the shared output listener has registered', async () => {
    const host = attach('order-1');
    await settle();

    // The window the defect lived in. Subscribing here means the backend starts
    // emitting into a listener that does not exist yet.
    expect(fleetApi.subscribeTerminal).not.toHaveBeenCalled();

    listenBox.resolve!();
    await settle();

    expect(fleetApi.subscribeTerminal).toHaveBeenCalledTimes(1);
    expect(fleetApi.subscribeTerminal).toHaveBeenCalledWith('order-1');

    detachTerminal('order-1');
    host.remove();
  });

  it('renders a chunk the backend emits the instant the subscribe resolves', async () => {
    const host = attach('order-2');
    listenBox.resolve!();
    await settle();

    // Rust flipped `subscribed` under the ring lock when the subscribe above
    // resolved; this is the very next chunk off the PTY.
    backendEmits('order-2', 'FIRST-LIVE-CHUNK');

    const m = registryMap().get('order-2')!;
    expect(m.term.written).toEqual(['SNAP', 'FIRST-LIVE-CHUNK']);

    detachTerminal('order-2');
    host.remove();
  });

  it('queues a chunk that arrives while the listener is still registering, behind the snapshot', async () => {
    const host = attach('order-3');
    // Handler is not wired yet, so nothing can be delivered — but the gate is
    // already closed, which is what keeps ordering exact once it opens.
    backendEmits('order-3', 'DROPPED-BY-THE-BUS');

    listenBox.resolve!();
    // Deliver before the subscribe's snapshot has settled.
    await Promise.resolve();
    backendEmits('order-3', 'EARLY-LIVE');
    await settle();

    const m = registryMap().get('order-3')!;
    // Snapshot first, then the held chunk — never interleaved.
    expect(m.term.written[0]).toBe('SNAP');
    expect(m.term.written).toContain('EARLY-LIVE');
    expect(m.term.written.indexOf('EARLY-LIVE')).toBeGreaterThan(0);

    detachTerminal('order-3');
    host.remove();
  });

  it('still hydrates, and warns behind the snapshot, when the registration fails', async () => {
    setFleetTerminalListenerNotice('OUTPUT-STALLED');
    const host = attach('order-5');
    listenBox.reject!(new Error('listen failed'));
    await settle();

    // A pane with no live listener must still paint what the ring already
    // holds — the failure path must not become a blank box on top of a blackout.
    const m = registryMap().get('order-5')!;
    expect(fleetApi.subscribeTerminal).toHaveBeenCalledTimes(1);
    expect(m.term.written[0]).toBe('SNAP');
    // ...and the warning lands AFTER the snapshot, not under the reset that
    // would have erased it.
    expect(m.term.written.join('')).toContain('OUTPUT-STALLED');
    expect(m.term.written.join('').indexOf('OUTPUT-STALLED')).toBeGreaterThan(0);

    setFleetTerminalListenerNotice('');
    detachTerminal('order-5');
    host.remove();
  });
});
