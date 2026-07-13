import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Succeeds ContextCard.test.tsx: the goal/idea coverage badges moved from the
// card onto the ledger row when the Cross-tab ledger replaced the board, but the
// click-through contract they carry (seed the spotlight → open Goals; open the
// idea-triage queue) is the same and still worth pinning.
const setDevToolsTab = vi.fn();
const setPendingGoalSpotlightId = vi.fn();
const openGoalsBoardMock = vi.hoisted(() => vi.fn());

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ setDevToolsTab, setPendingGoalSpotlightId }),
}));

vi.mock('@/features/plugins/companion/guidance/appActions', () => ({
  openGoalsBoard: openGoalsBoardMock,
}));

import { ContextCoverage } from '../contextLedgerShared';

const t = {
  files: 'files',
  uc_title: 'Use cases',
  context_goal_coverage_tooltip: 'Open in Goals',
  context_idea_coverage_tooltip: 'Open triage',
} as unknown as Parameters<typeof ContextCoverage>[0]['t'];

function renderCoverage(over: Partial<Parameters<typeof ContextCoverage>[0]> = {}) {
  return render(
    <ContextCoverage
      fileCount={2}
      useCaseCount={1}
      goalCount={0}
      ideaCount={0}
      kpiCount={0}
      t={t}
      {...over}
    />,
  );
}

describe('ContextCoverage — the ledger row\'s metric cluster', () => {
  beforeEach(() => {
    setDevToolsTab.mockClear();
    setPendingGoalSpotlightId.mockClear();
    openGoalsBoardMock.mockClear();
  });

  it('renders every metric, including the zeroes', () => {
    renderCoverage({ goalCount: 3, ideaCount: 4, kpiCount: 0 });
    // files=2, useCases=1, goals=3, ideas=4, kpis=0 — all five are present.
    for (const n of ['2', '1', '3', '4', '0']) {
      expect(screen.getAllByText(n).length).toBeGreaterThan(0);
    }
  });

  it('a zero-count metric is inert — no jump affordance', () => {
    renderCoverage({ goalCount: 0, ideaCount: 0 });
    expect(screen.queryByTitle('Open in Goals')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Open triage')).not.toBeInTheDocument();
  });

  it('clicking the goal metric seeds the spotlight and opens the Goals board', () => {
    renderCoverage({ goalCount: 2, firstGoalId: 'goal-XYZ' });
    fireEvent.click(screen.getByTitle('Open in Goals'));
    expect(setPendingGoalSpotlightId).toHaveBeenCalledWith('goal-XYZ');
    expect(openGoalsBoardMock).toHaveBeenCalled();
  });

  it('still opens Goals when firstGoalId is absent but goals exist', () => {
    renderCoverage({ goalCount: 1 });
    fireEvent.click(screen.getByTitle('Open in Goals'));
    expect(setPendingGoalSpotlightId).not.toHaveBeenCalled();
    expect(openGoalsBoardMock).toHaveBeenCalled();
  });

  it('clicking the idea metric jumps to the triage queue', () => {
    renderCoverage({ ideaCount: 5 });
    fireEvent.click(screen.getByTitle('Open triage'));
    expect(setDevToolsTab).toHaveBeenCalledWith('idea-triage');
  });

  it('a metric click does not bubble to the row (which would open the context)', () => {
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <ContextCoverage
          fileCount={1}
          useCaseCount={0}
          goalCount={2}
          firstGoalId="g-1"
          ideaCount={0}
          kpiCount={0}
          t={t}
        />
      </div>,
    );
    fireEvent.click(screen.getByTitle('Open in Goals'));
    expect(openGoalsBoardMock).toHaveBeenCalled();
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
