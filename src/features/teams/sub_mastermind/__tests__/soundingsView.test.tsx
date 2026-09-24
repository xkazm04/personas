// Soundings view — mounted for real: the three levels by keyboard, the Improve
// door reaching the page's handler, and Athena's canvas actions answered.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetCanvasActionsForTests, dispatchCanvasAction } from '../lib/canvasActionStore';
import type { DimKey } from '../lib/dimRegistry';
import type { DimNode, DimStatus, Island, Scene } from '../lib/types';
import SoundingsView from '../soundings/SoundingsView';

const node = (key: DimKey, status: DimStatus, action: DimNode['action'] = null): DimNode =>
  ({ key, label: `L-${key}`, status, detail: `${key} tool`, reached: 1, steps: 2, action, rowKey: key });

const island = (slug: string, name: string, nodes: DimNode[], over: Partial<Island> = {}): Island => ({
  slug, name, purpose: '', x: 0, y: 0, state: 'healthy', autoScore: 70, prodScore: 60, lifecycle: 'live', automationLabel: '',
  blockers: 0, nodes, fleet: [], personasRunning: [], runners: [], attention: false, monitorErrors: 0, stateSource: 'readiness',
  stats: [], ship: null, ...over,
});

const scene: Scene = {
  demo: false,
  islands: [
    island('alpha', 'Alpha', [node('db', 'alert', 'deploy'), node('ci', 'solid')]),
    island('beta', 'Beta', [node('db', 'solid'), node('ci', 'risk')], { fleet: [{ id: 's1', label: 'otter', state: 'awaiting_input' }] }),
  ],
  edges: [{ from: 'alpha', to: 'beta', kind: 'relation', strength: 1, label: 'api' }],
};

const rect = { x: 0, y: 0, top: 0, left: 0, right: 1192, bottom: 552, width: 1192, height: 552, toJSON: () => ({}) };
const original = HTMLElement.prototype.getBoundingClientRect;
beforeAll(() => { HTMLElement.prototype.getBoundingClientRect = () => rect as DOMRect; });
afterAll(() => { HTMLElement.prototype.getBoundingClientRect = original; });
beforeEach(() => __resetCanvasActionsForTests());

function mount() {
  const handlers = {
    onDimOpen: vi.fn(),
    onFleetOpen: vi.fn(),
    onPersonasOpen: vi.fn(),
    onShipOpen: vi.fn(),
    onFactoryOpen: vi.fn(),
    onDispatchFleet: vi.fn(),
    onOpenTerminal: vi.fn(),
    canOpenTerminal: () => true,
  };
  const utils = render(<SoundingsView scene={scene} {...handlers} />);
  return { ...utils, handlers, root: () => screen.getByTestId('mm-soundings') };
}

describe('SoundingsView', () => {
  it('draws one buoy per project, and walks L0 -> L1 -> L2 and back by keyboard', async () => {
    const { root, handlers } = mount();
    expect(screen.getByTestId('sd-buoy-alpha')).toBeTruthy();
    expect(screen.getByTestId('sd-buoy-beta')).toBeTruthy();
    expect(root().dataset.level).toBe('0');

    // Alpha has the alert: it ranks first, so Enter opens it.
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(root().dataset.level).toBe('1'));
    expect(screen.getByTestId('sd-strip')).toBeTruthy();
    expect(screen.getByTestId('sd-frame-db')).toBeTruthy();

    // Enter lifts the focused (most urgent) reading into the card.
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(root().dataset.level).toBe('2'));
    await waitFor(() => expect(document.getElementById('sd-card-title')?.textContent).toBe('L-db'));

    // The Improve door is the page's own handler.
    fireEvent.click(screen.getByTestId('sd-improve'));
    expect(handlers.onDimOpen).toHaveBeenCalledWith('alpha', expect.objectContaining({ key: 'db' }), expect.objectContaining({ clientX: expect.any(Number) }));

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(root().dataset.level).toBe('1'));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(root().dataset.level).toBe('0'));
  });

  it('A goes to the agent waiting for input', async () => {
    const { root } = mount();
    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => expect(root().dataset.level).toBe('1'));
    expect(screen.getByTestId('sd-strip').getAttribute('aria-label')).toMatch(/^Beta/);
  });

  it('answers Athena: camera.focus opens the station, island.read returns the model', async () => {
    const { root } = mount();
    let focus: Awaited<ReturnType<typeof dispatchCanvasAction>> | undefined;
    await act(async () => { focus = await dispatchCanvasAction({ kind: 'camera.focus', slug: 'beta' }); });
    expect(focus?.ok).toBe(true);
    expect(root().dataset.level).toBe('1');

    let read: Awaited<ReturnType<typeof dispatchCanvasAction>> | undefined;
    await act(async () => { read = await dispatchCanvasAction({ kind: 'island.read', slug: 'alpha' }); });
    expect(read?.ok).toBe(true);
    expect((read?.payload as { name: string }).name).toBe('Alpha');

    let missing: Awaited<ReturnType<typeof dispatchCanvasAction>> | undefined;
    await act(async () => { missing = await dispatchCanvasAction({ kind: 'camera.focus', slug: 'nope' }); });
    expect(missing).toMatchObject({ ok: false, reason: 'unknown_slug' });
  });
});
