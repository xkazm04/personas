import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';

import { useAthenaStore } from '@/features/companions/athena/athenaStore';

import { estateDetail, estateSnapshot } from '../../../../journey/__tests__/docsFixtures';
import { renderLayer1 } from '../../../layer1/__tests__/renderLayer1';
import { LifecycleBody } from '../../../LifecycleBody';
import { loadStepChunk } from '../../../layer2/stepChunks';

const getLifecycleStepDetail = vi.hoisted(() => vi.fn());
const getLifecycleHistory = vi.hoisted(() => vi.fn(async () => ({ measures: [], stepIds: ['gate', 'tests'] })));
vi.mock('@/api/devTools/lifecycle', () => ({ getLifecycleStepDetail, setLifecycleStepParams: vi.fn(), getLifecycleHistory }));

// The screen and the Docs chunk are transformed once, up front: under a full parallel run the first
// test's cold import outlasted its five-second budget.
beforeAll(async () => { await Promise.all([loadStepChunk('screen'), loadStepChunk('docs')]); }, 30_000);

beforeEach(() => {
  vi.clearAllMocks();
  useAthenaStore.setState({ pendingChatPrompt: null });
  getLifecycleStepDetail.mockImplementation(async (_p: string, stepId: string) => (stepId === 'docs' ? estateDetail() : { stepId, runs: [], docs: [], related: [], evidence: [] }));
});

// The detail cache is module-scoped and keyed by project, so each test names its own project.
async function openDocs(projectId: string) {
  renderLayer1(<LifecycleBody />, estateSnapshot(projectId), 'docs');
  // The first open of a file pays for the preset chunk's import; under a full parallel run that can pass a second.
  return screen.findByTestId('lcx7-estate', {}, { timeout: 5000 });
}

const cell = (path: string) => screen.getByTestId(`lcx7-cell-${path}`);

describe('docs: the estate', () => {
  it('draws every doc as a cell in its folder, folders worst first', async () => {
    const estate = await openDocs('p-estate');
    const folders = within(estate).getAllByRole('group').map((g) => g.getAttribute('data-testid'));
    expect(folders).toEqual([
      'lcx7-dir-docs/features', 'lcx7-dir-docs/concepts', 'lcx7-dir-docs/architecture', 'lcx7-dir-docs/development', 'lcx7-dir-docs/design', 'lcx7-dir-root',
    ]);
    expect(within(estate).getAllByRole('option')).toHaveLength(40);
    expect(screen.getByTestId('lcx7-dir-docs/features').textContent).toContain('2 broken');
    expect(cell('docs/features/vault/vault.md').getAttribute('data-status')).toBe('broken');
  });

  it('a status chip fades every other doc in place and narrows the list', async () => {
    await openDocs('p-chip');
    fireEvent.click(within(screen.getByTestId('lcx7-chip-stale').closest('button')!).getByText('Stale'));
    expect(cell('docs/concepts/decision-mirror.md').getAttribute('data-out')).toBeNull();
    expect(cell('docs/features/vault/vault.md').getAttribute('data-out')).toBe('true');
    expect(screen.queryByTestId('lc2-docs-broken')).toBeNull();
    expect(screen.getByTestId('lc2-docs-stale')).toBeTruthy();
    expect(screen.getByTestId('lcx7-shown').textContent).toBe('5 of 40 docs shown');
    fireEvent.click(screen.getByTestId('lcx7-clear'));
    expect(screen.getByTestId('lc2-docs-broken')).toBeTruthy();
    expect(screen.getByTestId('lcx7-shown').textContent).toBe('');
  });

  it('the search keeps the docs whose path has every term', async () => {
    await openDocs('p-search');
    fireEvent.change(screen.getByTestId('lcx7-search'), { target: { value: 'golden' } });
    const stale = screen.getByTestId('lc2-docs-stale');
    expect(stale.textContent).toContain('toasts.md');
    expect(stale.textContent).not.toContain('decision-mirror.md');
    expect(screen.getByTestId('lcx7-shown').textContent).toBe('2 of 40 docs shown');
  });

  it('a clicked cell opens its doc in the list, even a clean one behind the fold', async () => {
    await openDocs('p-pick');
    expect(screen.queryByTestId('lcx7-detail-README.md')).toBeNull();
    fireEvent.click(cell('README.md'));
    expect(await screen.findByTestId('lcx7-detail-README.md')).toBeTruthy();
    expect(cell('README.md').getAttribute('data-selected')).toBe('true');
  });

  it('the map is one tab stop: arrows walk the docs, Down jumps a folder, Enter opens the doc', async () => {
    const estate = await openDocs('p-mapkeys');
    const active = () => document.getElementById(estate.getAttribute('aria-activedescendant')!)!.getAttribute('aria-label');
    expect(active()).toContain('docs/features/fleet/fleet.md');
    fireEvent.keyDown(estate, { key: 'ArrowRight' });
    expect(active()).toContain('docs/features/vault/vault.md');
    fireEvent.keyDown(estate, { key: 'ArrowDown' });
    expect(active()).toContain('docs/concepts/');
    fireEvent.keyDown(estate, { key: 'Enter' });
    expect(screen.getAllByTestId(/^lcx7-detail-docs\/concepts\//)).toHaveLength(1);
  });

  it('the share is drawn against the line with what is left out', async () => {
    await openDocs('p-share');
    const share = screen.getByTestId('lc2-docs-share');
    expect(share.textContent).toContain('82%');
    expect(share.textContent).toContain('of 39 verifiable docs');
    expect(screen.getByTestId('lcx7-share-need').textContent).toBe('4 more clean docs reach the line');
    expect(screen.getByTestId('lcx7-share-excluded').textContent).toContain('1 unverifiable doc is left out');
    expect(screen.getByTestId('lcx7-share-track').querySelector('[data-line="90"]')).toBeTruthy();
  });
});

describe('docs: the resolution list', () => {
  it('a row opens to every broken reference, and Ask Athena names the doc and all of them', async () => {
    await openDocs('p-row');
    const press = within(screen.getByTestId('lc2-doc-row-docs/features/fleet/fleet.md')).getAllByRole('button')[0]!;
    fireEvent.click(press);
    expect(press.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('lcx7-refs-docs/features/fleet/fleet.md').textContent).toContain('src/features/fleet/FleetGrid.tsx');
    expect(screen.getByTestId('lcx7-sources-docs/features/fleet/fleet.md').textContent).toContain('src/features/fleet/fleetModel.ts');
    fireEvent.click(screen.getByTestId('lcx7-ask-docs/features/fleet/fleet.md'));
    const sent = useAthenaStore.getState().pendingChatPrompt;
    expect(sent?.source).toBe('lifecycle');
    expect(sent?.text).toContain('docs/features/fleet/fleet.md');
    expect(sent?.text).toContain('src/features/fleet/FleetGrid.tsx');
  });

  it('Up and Down move between rows, Enter opens one', async () => {
    await openDocs('p-keys');
    const presses = () => [...screen.getByTestId('lc2-docs-resolution').querySelectorAll<HTMLElement>('[data-doc-row] .k-row__press')];
    const [first, second] = presses();
    first!.focus();
    fireEvent.keyDown(first!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);
    // Enter on a button is a click.
    fireEvent.click(first!);
    expect(first!.getAttribute('aria-expanded')).toBe('true');
  });

  it('marks the docs the backlog already has, and shows the items tied to their docs', async () => {
    await openDocs('p-backlog');
    expect(screen.getByTestId('lcx7-filed-mark-docs/features/vault/vault.md')).toBeTruthy();
    expect(screen.queryByTestId('lcx7-filed-mark-docs/features/fleet/fleet.md')).toBeNull();
    const fix = screen.getByTestId('lcx7-fix');
    expect(within(fix).getByTestId('lcx7-backlog-rot-toasts').textContent).toContain('docs/concepts/golden-paths/toasts.md');
    expect(within(fix).getByTestId('lcx7-backlog-rot-old').textContent).toContain('Names no doc on this list');
    expect(within(fix).queryByTestId('lcx7-backlog-ov-docs')).toBeNull();
  });

  it('Fix in bulk hands every broken and stale doc to Athena', async () => {
    await openDocs('p-bulk');
    const button = screen.getByTestId('lcx7-fix-all');
    expect(button.textContent).toContain('Fix 7 docs with Athena');
    fireEvent.click(button);
    const text = useAthenaStore.getState().pendingChatPrompt?.text ?? '';
    expect(text).toContain('docs/features/vault/vault.md');
    expect(text).toContain('docs/architecture/warm-verification-service.md');
    expect(text).not.toContain('README.md');
  });

  it('the change log is the step evidence, by day', async () => {
    await openDocs('p-log');
    const log = screen.getByTestId('lc2-docs-log');
    expect(within(log).getAllByRole('region').length).toBeGreaterThanOrEqual(3);
    expect(log.textContent).toContain('Document the gate daemon');
    expect(log.textContent).toContain('Updated the warm verification doc');
    expect(log.textContent).not.toContain('Add the fleet grid');
  });
});
