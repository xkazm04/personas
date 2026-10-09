import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';

import { healthyMix } from '../../../journey/__tests__/fixtures';
import { Layer1 } from '../../layer1/Layer1';
import { renderLayer1 } from '../../layer1/__tests__/renderLayer1';
import { TimeTravelProvider } from '../timeTravel';
import { __resetHistoryCacheForTests } from '../useLifecycleHistory';
import { historyOf, sixMeasures } from './historyFixtures';

const getLifecycleHistory = vi.hoisted(() => vi.fn());
vi.mock('@/api/devTools/lifecycle', () => ({ getLifecycleHistory }));
vi.mock('../../layer2/stepChunks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../layer2/stepChunks')>()),
  prefetchStepChunksOnIdle: () => () => {},
}));

beforeEach(() => {
  __resetHistoryCacheForTests();
  getLifecycleHistory.mockReset();
  getLifecycleHistory.mockImplementation(async () => sixMeasures());
});

function mount(snap: LifecycleSnapshot = healthyMix()) {
  return renderLayer1(
    <TimeTravelProvider projectId={snap.projectId} ready>
      <Layer1 />
    </TimeTravelProvider>,
    snap,
  );
}

const card = (id: string) => document.querySelector<HTMLElement>(`[data-card="${id}"]`)!;
const band = () => screen.getByTestId('lc1-status');

async function figure() {
  return screen.findByTestId('lc-history-figure');
}

describe('history figure', () => {
  it('draws one column per Measure, oldest first, with the caption and what changed', async () => {
    mount();
    await figure();
    expect(screen.getAllByTestId(/^lc-history-col-\d+$/)).toHaveLength(6);
    expect(screen.getByTestId('lc-history-col-0').getAttribute('data-measure')).toBe('m-h1');
    expect(screen.getByTestId('lc-history').textContent).toContain("judged with today's step settings");
    const gateRow = document.querySelector('[data-history-row="gate"]')!;
    expect([...gateRow.querySelectorAll('[data-cell]')].map((c) => c.getAttribute('data-cell'))).toEqual(['green', 'green', 'red', 'amber', 'green', 'amber']);
    const changed = screen.getByTestId('lc-history-changed');
    expect(changed.textContent).toContain('Since the previous Measure:');
    expect(changed.querySelector('[data-change="verdict"]')!.getAttribute('data-tone')).toBe('bad');
    expect(changed.querySelector('[data-change="coverage"]')!.textContent).toBe('coverage +2 pts');
  });

  it('travels on click: the rail, the band and the line show that Measure; Esc returns to now', async () => {
    mount();
    await figure();
    fireEvent.click(screen.getByTestId('lc-history-col-2'));

    expect(band().getAttribute('data-travel')).toBe('past');
    expect((await screen.findByTestId('lc-travel-lead')).getAttribute('data-measure')).toBe('m-h3');
    expect(screen.getByTestId('lc-node-gate').getAttribute('data-health')).toBe('red');
    expect(card('gate').getAttribute('data-travel')).toBe('then');
    expect(card('land').getAttribute('data-travel')).toBe('untracked');
    expect(card('land').getAttribute('data-highlight')).toBe('none');
    expect(screen.getByTestId('lc-history-changed').textContent).toContain('Against the Measure before it:');
    expect(screen.getByTestId('lc-history-col-2').getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(band().getAttribute('data-travel')).toBeNull());
    expect(screen.getByTestId('lc-node-gate').getAttribute('data-health')).toBe('amber');
    expect(card('land').getAttribute('data-travel')).toBeNull();
  });

  it('walks with the keyboard: Left moves the cursor, Enter travels, Left / Right move the travel, the newest is now', async () => {
    mount();
    await figure();
    const picker = screen.getByTestId('lc-history-picker');
    picker.focus();
    fireEvent.keyDown(picker, { key: 'ArrowLeft' });
    expect(band().getAttribute('data-travel')).toBeNull();
    fireEvent.keyDown(picker, { key: 'Enter' });
    expect((await screen.findByTestId('lc-travel-lead')).getAttribute('data-measure')).toBe('m-h5');
    fireEvent.keyDown(picker, { key: 'ArrowLeft' });
    expect(screen.getByTestId('lc-travel-lead').getAttribute('data-measure')).toBe('m-h4');
    expect(screen.getByTestId('lc-node-gate').getAttribute('data-health')).toBe('amber');
    fireEvent.keyDown(picker, { key: 'ArrowRight' });
    fireEvent.keyDown(picker, { key: 'ArrowRight' });
    await waitFor(() => expect(band().getAttribute('data-travel')).toBeNull());
    fireEvent.keyDown(picker, { key: 'Home' });
    fireEvent.keyDown(picker, { key: ' ' });
    expect((await screen.findByTestId('lc-travel-lead')).getAttribute('data-measure')).toBe('m-h1');
    fireEvent.keyDown(picker, { key: 'Escape' });
    await waitFor(() => expect(band().getAttribute('data-travel')).toBeNull());
  });

  it('returns with Back to now, and notes an untracked step in its peek', async () => {
    mount();
    await figure();
    fireEvent.click(screen.getByTestId('lc-history-col-3'));
    fireEvent.focus(screen.getByTestId('lc-node-land'));
    expect((await screen.findByTestId('lc1-peek-untracked')).textContent).toContain('Not tracked in history');
    fireEvent.click(await screen.findByTestId('lc-travel-back'));
    await waitFor(() => expect(band().getAttribute('data-travel')).toBeNull());
  });

  it('says history starts after the second Measure, in the same frame', async () => {
    getLifecycleHistory.mockImplementation(async () => historyOf([{ gate: ['green', 100, 1], tests: ['amber', 60, 1] }]));
    mount(healthyMix({ projectId: 'p-one' }));
    expect((await screen.findByTestId('lc-history-empty')).textContent).toContain('History starts after the second Measure');
    expect(screen.queryByTestId('lc-history-picker')).toBeNull();
  });

  it('shows a failed read as an inline banner with Retry, the rail untouched', async () => {
    getLifecycleHistory.mockRejectedValueOnce(new Error('database is locked'));
    mount(healthyMix({ projectId: 'p-fail' }));
    const failed = await screen.findByTestId('lc-history-failed');
    expect(screen.getAllByTestId(/^lc-node-/)).toHaveLength(10);
    fireEvent.click(within(failed).getByRole('button', { name: /retry/i }));
    await figure();
  });

  it('holds the frame at one height in every state', async () => {
    let resolve!: (v: unknown) => void;
    getLifecycleHistory.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    mount(healthyMix({ projectId: 'p-ghost' }));
    const body = () => document.querySelector<HTMLElement>('[data-history-state]')!;
    expect(body().getAttribute('data-history-state')).toBe('loading');
    expect(screen.getByTestId('lc-history-ghost')).toBeTruthy();
    const height = body().style.height;
    await waitFor(() => expect(getLifecycleHistory).toHaveBeenCalled());
    resolve(sixMeasures());
    await figure();
    expect(body().style.height).toBe(height);
  });
});
