// Publishing the canvas scene for Athena (WP3). The three properties that make
// the publisher safe to call on every derive: it debounces, it dedupes, and it
// never publishes the demo scene. Plus the one that makes it USEFUL: the field
// names match the contract documented on `canvas::CanvasScene` in
// `src-tauri/src/companion/canvas.rs`, which the Rust parser reads by name.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// eslint-disable-next-line no-restricted-imports
import { invoke } from '@tauri-apps/api/core';
import { resetInvokeMocks } from '@/test/tauriMock';

import {
  buildScenePayload,
  publishCanvasScene,
  PUBLISH_DEBOUNCE_MS,
  SCENE_KEY,
  __resetScenePublisherForTests,
} from '../lib/scenePublish';
import type { DimNode, Island, Scene } from '../lib/types';

const mocked = vi.mocked(invoke);
let writes: Array<{ key: string; value: string }> = [];

function installIpc(): void {
  mocked.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === 'set_app_setting') {
      writes.push(args as { key: string; value: string });
      return undefined;
    }
    return undefined;
  });
}

const dim = (key: string, status: string, detail: string | null = null, days?: number): DimNode =>
  ({ key, label: key.toUpperCase(), status, detail, reached: 0, steps: 0, days: days ?? null }) as unknown as DimNode;

const island = (slug: string, over: Partial<Island> = {}): Island =>
  ({
    slug,
    name: slug,
    purpose: '',
    x: 0,
    y: 0,
    state: 'warning',
    autoScore: 50,
    prodScore: 50,
    lifecycle: 'Beta',
    automationLabel: 'Assisted',
    blockers: 3,
    nodes: [dim('tests', 'risk', '41% cov'), dim('ideas', 'alert', '42d ago', 42), dim('goals', 'partial', '3 active', 3)],
    fleet: [{ id: 'f1', label: 'a', state: 'running' }, { id: 'f2', label: 'b', state: 'idle' }],
    personasRunning: ['Atlas'],
    attention: true,
    monitorErrors: 7,
    stateSource: 'readiness',
    stats: [],
    ship: { next: 'M3', shipped: 1, total: 4, late: true },
    ...over,
  }) as Island;

const scene = (over: Partial<Scene> = {}): Scene => ({
  islands: [island('proj_1')],
  edges: [],
  demo: false,
  ...over,
});

const families = { relations: 'loaded', scans: 'failed' } as const;

describe('scenePublish — the snapshot Athena reads', () => {
  beforeEach(() => {
    // `invokeWithTimeout` polls for the IPC token on a 20ms interval when it is
    // absent — under fake timers that poll would eat the whole advance budget.
    (globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';
    vi.useFakeTimers();
    resetInvokeMocks();
    writes = [];
    installIpc();
    __resetScenePublisherForTests();
  });
  afterEach(() => {
    __resetScenePublisherForTests();
    vi.useRealTimers();
  });

  it('matches the field names documented on CanvasScene', () => {
    const payload = buildScenePayload({
      scene: scene(),
      families: { ...families },
      kpiByProject: new Map([['proj_1', { total: 6, off: 2 }]]),
    });

    // Envelope (`publishedAt` is stamped at write time, not here).
    expect(Object.keys(payload).sort()).toEqual(['demo', 'families', 'projects', 'version']);
    expect(payload.version).toBe(1);
    expect(payload.demo).toBe(false);
    expect(payload.families).toEqual({ relations: 'loaded', scans: 'failed' });

    // Project — every key the Rust struct declares, spelled the same way.
    const p = payload.projects[0]!;
    expect(Object.keys(p).sort()).toEqual([
      'attention', 'blockers', 'dims', 'fleet', 'goalsOngoing', 'ideasDays',
      'kpiOff', 'kpiTotal', 'monitorErrors', 'name', 'personasRunning', 'ship',
      'slug', 'state',
    ]);
    // Counts, not lists — `fleet` and `personasRunning` are i64 in Rust.
    expect(p.fleet).toBe(2);
    expect(p.personasRunning).toBe(1);
    expect(p.attention).toBe(true);
    expect(p.blockers).toBe(3);
    expect(p.monitorErrors).toBe(7);
    expect(p.ideasDays).toBe(42);
    expect(p.goalsOngoing).toBe(3);
    expect(p.kpiTotal).toBe(6);
    expect(p.kpiOff).toBe(2);
    expect(Object.keys(p.ship!).sort()).toEqual(['late', 'next', 'shipped', 'total']);
    expect(Object.keys(p.dims[0]!).sort()).toEqual(['detail', 'key', 'label', 'status']);
    expect(p.dims[0]).toEqual({ key: 'tests', label: 'TESTS', status: 'risk', detail: '41% cov' });
  });

  it('reports a project with no KPIs / no ship as honestly unknown, not zero', () => {
    const payload = buildScenePayload({
      scene: scene({ islands: [island('bare', { ship: null, monitorErrors: null, nodes: [] })] }),
      families: {},
    });
    const p = payload.projects[0]!;
    expect(p.kpiTotal).toBeNull();
    expect(p.kpiOff).toBeNull();
    expect(p.ship).toBeNull();
    expect(p.monitorErrors).toBeNull();
    expect(p.ideasDays).toBeNull();
  });

  it('debounces a burst of derives into one write, stamped with publishedAt', async () => {
    for (let i = 0; i < 5; i += 1) {
      publishCanvasScene({ scene: scene({ islands: [island('proj_1', { blockers: i })] }), families: {} });
    }
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(PUBLISH_DEBOUNCE_MS + 5);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.key).toBe(SCENE_KEY);
    const doc = JSON.parse(writes[0]!.value);
    expect(doc.version).toBe(1);
    expect(typeof doc.publishedAt).toBe('string');
    // The LAST derive wins, not the first.
    expect(doc.projects[0].blockers).toBe(4);
  });

  it('does not write again when the scene is unchanged', async () => {
    const input = { scene: scene(), families: { ...families } };
    publishCanvasScene(input);
    await vi.advanceTimersByTimeAsync(PUBLISH_DEBOUNCE_MS + 5);
    expect(writes).toHaveLength(1);

    // Same content, fresh objects (the page rebuilds these every derive).
    publishCanvasScene({ scene: scene(), families: { ...families } });
    await vi.advanceTimersByTimeAsync(PUBLISH_DEBOUNCE_MS + 5);
    expect(writes).toHaveLength(1);

    // A real change publishes again.
    publishCanvasScene({ scene: scene({ islands: [island('proj_1', { state: 'critical' })] }), families: { ...families } });
    await vi.advanceTimersByTimeAsync(PUBLISH_DEBOUNCE_MS + 5);
    expect(writes).toHaveLength(2);
  });

  it('never publishes the demo scene', async () => {
    publishCanvasScene({ scene: scene({ demo: true, islands: [island('demo-desktop')] }), families: {} });
    await vi.advanceTimersByTimeAsync(PUBLISH_DEBOUNCE_MS + 50);
    expect(writes).toHaveLength(0);
  });

  it('survives a failed write and retries on the next derive', async () => {
    mocked.mockImplementation(async () => {
      throw new Error('ipc unavailable');
    });
    publishCanvasScene({ scene: scene(), families: {} });
    await vi.advanceTimersByTimeAsync(PUBLISH_DEBOUNCE_MS + 5);

    installIpc();
    // Identical content — a working dedupe would swallow it, but a FAILED
    // publish must not be remembered as published.
    publishCanvasScene({ scene: scene(), families: {} });
    await vi.advanceTimersByTimeAsync(PUBLISH_DEBOUNCE_MS + 5);
    expect(writes).toHaveLength(1);
  });
});
