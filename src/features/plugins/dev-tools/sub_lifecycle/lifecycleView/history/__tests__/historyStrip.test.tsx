import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { mixWithEvidence } from '../../../journey/__tests__/detailFixtures';
import { renderLayer1 } from '../../layer1/__tests__/renderLayer1';
import { LifecycleBody } from '../../LifecycleBody';
import { loadStepChunk } from '../../layer2/stepChunks';
import { __resetHistoryCacheForTests } from '../useLifecycleHistory';
import { gateDetailByMeasure, sixMeasures } from './historyFixtures';

const getLifecycleHistory = vi.hoisted(() => vi.fn());
const getLifecycleStepDetail = vi.hoisted(() => vi.fn());
const setLifecycleStepParams = vi.hoisted(() => vi.fn());
vi.mock('@/api/devTools/lifecycle', () => ({ getLifecycleHistory, getLifecycleStepDetail, setLifecycleStepParams }));

// The screen and Gate chunks are transformed once, up front: a cold transform is not what these tests time.
beforeAll(async () => {
  await Promise.all([loadStepChunk('screen'), loadStepChunk('gate')]);
}, 30_000);

beforeEach(() => {
  __resetHistoryCacheForTests();
  vi.clearAllMocks();
  getLifecycleHistory.mockImplementation(async () => sixMeasures());
  getLifecycleStepDetail.mockImplementation(async (_p: string, stepId: string) => (stepId === 'gate' ? gateDetailByMeasure() : { stepId, runs: [], docs: [], related: [], evidence: [] }));
});

const row = (id: string) => screen.getByTestId(`lc2-cmd-${id}`);
const selected = (id: string) => (row(id).getAttribute('data-kit-state') ?? '').split(' ').includes('selected');

describe('Layer 2 history strip (in the band)', () => {
  it('draws the step’s verdict row and shows a picked Measure’s runs in the command rows', async () => {
    renderLayer1(<LifecycleBody />, mixWithEvidence({ projectId: 'p-strip' }), 'gate');
    const strip = await screen.findByTestId('lc2-strip');
    await waitFor(() => expect(within(strip).getAllByTestId(/^lc2-strip-col-\d+$/)).toHaveLength(6));
    expect(strip.querySelectorAll('[data-history-row="gate"] [data-cell]')).toHaveLength(6);
    await screen.findByTestId('lc2-cmd-eslint');
    expect(selected('eslint')).toBe(false);

    fireEvent.click(screen.getByTestId('lc2-strip-col-2'));

    await waitFor(() => expect(selected('eslint')).toBe(true));
    expect(selected('tsc')).toBe(true);
    expect(selected('clippy')).toBe(false);
    expect(row('eslint').querySelector('[data-outcome="failed"]')).not.toBeNull();
    expect(row('clippy').textContent).toContain('Not in that Measure');
    expect(row('tsc').querySelector('[data-mark]')).not.toBeNull();
    // The band shows that Measure and says so, with the way back.
    expect(screen.getByTestId('lc2-band-travel').textContent).toContain('Viewing the Measure from');
    expect(screen.getByTestId('lc2-header').getAttribute('data-travel')).toBe('then');

    fireEvent.click(screen.getByTestId('lc2-band-now'));
    await waitFor(() => expect(selected('eslint')).toBe(false));
    expect(row('clippy').textContent).not.toContain('Not in that Measure');
  });

  it('keeps Left / Right in the strip for Measures, and Esc there returns to now before leaving the step', async () => {
    renderLayer1(<LifecycleBody />, mixWithEvidence({ projectId: 'p-strip-keys' }), 'gate');
    const picker = await screen.findByTestId('lc2-strip-picker');
    picker.focus();
    fireEvent.keyDown(picker, { key: 'ArrowLeft' });
    fireEvent.keyDown(picker, { key: 'Enter' });
    await waitFor(() => expect(selected('tsc')).toBe(true));
    expect(screen.getByTestId('lc2-screen').getAttribute('data-step')).toBe('gate');

    fireEvent.keyDown(picker, { key: 'Escape' });
    await waitFor(() => expect(selected('tsc')).toBe(false));
    expect(screen.getByTestId('lc2-screen').getAttribute('data-step')).toBe('gate');
  });
});
