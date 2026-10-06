/**
 * The invariants EVERY concept must hold, driven from the registry itself, so a
 * concept added to `concepts.ts` is tested by existing: the brief's survival
 * list (every step and its state, the evidence for the selected step, selecting
 * by click, and the roving-keyboard model) is not negotiable per container.
 *
 * Each concept is mounted in the same one-line host the page uses - the real
 * `useLifecycleView` model behind the real provider - so the model, the warm
 * cache and the i18n namespace are part of what has to keep working. Rendering
 * the page itself would only ever exercise the default concept.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { evidenceItem, soloV0 } from '../../../journey/__tests__/fixtures';
import { LifecycleViewProvider } from '../../context';
import { useLifecycleView } from '../../useLifecycleView';
import { CONCEPTS, type LifecycleConcept } from '../concepts';

const getLifecycle = vi.hoisted(() => vi.fn());
const installLifecycle = vi.hoisted(() => vi.fn());
let activeProjectId = 'p1';

vi.mock('@/api/devTools/lifecycle', () => ({ getLifecycle, installLifecycle }));
vi.mock('@/features/companions/athena/useAskAthena', () => ({ useAskAthena: () => vi.fn() }));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      activeProjectId,
      projects: [{ id: activeProjectId, name: 'Acme', root_path: 'C:/acme', github_url: null }],
    }),
}));

/** The page's own body, with the concept under test in place of the picked one. */
function Host({ View }: { View: LifecycleConcept['View'] }) {
  const model = useLifecycleView();
  return (
    <LifecycleViewProvider model={model}>
      <View />
    </LifecycleViewProvider>
  );
}

const SNAPSHOT = soloV0({
  evidence: [
    evidenceItem('c2', '2026-09-26T10:00:00Z', [['gate', 'done'], ['docs', 'skipped']]),
    evidenceItem('c1', '2026-09-25T10:00:00Z', [['gate', 'skipped']]),
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each(CONCEPTS.map((c) => [c.id, c] as const))('concept %s', (id, concept) => {
  beforeEach(() => {
    // Its own project id, so the module warm cache never leaks between concepts.
    activeProjectId = `p-${id}`;
    getLifecycle.mockResolvedValue({ ...SNAPSHOT, projectId: activeProjectId });
  });

  async function mount() {
    render(<Host View={concept.View} />);
    return screen.findByTestId('lc-journey');
  }

  it('draws every step with its state', async () => {
    await mount();
    const nodes = screen.getAllByTestId(/^lc-node-/);
    expect(nodes).toHaveLength(SNAPSHOT.steps.length);
    expect(screen.getByTestId('lc-node-tests').getAttribute('data-state')).toBe('advisory');
  });

  // The ASSERTION is the information, not the block that carries it: a concept
  // may put the rule in a detail panel (railBelow, crosscheck) or render the
  // whole charter inline, and both satisfy "the selected step's rule and its
  // evidence are on screen". Pinning `lc-step-state` would have made the test a
  // test of one container.
  it('selects a step by click and shows that step rule and evidence', async () => {
    const view = await mount();
    fireEvent.click(screen.getByTestId('lc-node-gate'));
    expect(screen.getByTestId('lc-node-gate').getAttribute('aria-pressed')).toBe('true');
    await screen.findByTestId('lc-state-region');
    expect(view.textContent).toContain('Rule for gate.');
    expect(screen.getAllByText('Skipped').length).toBeGreaterThan(0);
  });

  it('walks the sequence from the keyboard and keeps one tab stop', async () => {
    await mount();
    const track = screen.getByTestId('lc-journey-track');
    fireEvent.click(screen.getByTestId('lc-node-frame'));
    fireEvent.keyDown(track, { key: 'ArrowRight' });
    expect(screen.getByTestId('lc-node-recall').getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(track, { key: 'End' });
    expect(screen.getByTestId('lc-node-record').getAttribute('aria-pressed')).toBe('true');
    const stops = screen.getAllByTestId(/^lc-node-/).filter((n) => n.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
  });

  it('keeps the legend and the actions', async () => {
    await mount();
    expect(screen.getByTestId('lc-legend')).toBeTruthy();
    expect(screen.getByTestId('lc-ask-athena')).toBeTruthy();
  });
});
