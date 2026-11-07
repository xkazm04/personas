/**
 * DW-181: Run analysis says which agent it checked.
 *
 * With the page on all agents the handler checks only the first agent and the
 * result line never said so, so a clean result read as a clean fleet. With no
 * agents at all the button did nothing and showed nothing.
 *
 * The harness wires the real hook into the real panel the way
 * ObservabilityDashboard does. `analysisTargetId` is the one new seam: returned
 * by useHealingPanelState (the agent the last run actually analysed) and passed
 * through as a prop of the same name.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/en';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { useHealingPanelState } from '../../libs/useHealingPanelState';
import { useObservabilityWords } from '../../libs/useObservabilityWords';
import { HealingIssuesPanel } from '../HealingIssuesPanel';

const ALPHA = { id: 'persona-a', name: 'Alpha Agent' };
const BRAVO = { id: 'persona-b', name: 'Bravo Agent' };
const RESULT = { failures_analyzed: 2, issues_created: 0, auto_fixed: 0 };

type Trigger = (id: string) => Promise<typeof RESULT | null>;

function Harness({ selectedPersonaId, personas, triggerHealing }: {
  selectedPersonaId: string | null;
  personas: { id: string; name: string }[];
  triggerHealing: Trigger;
}) {
  const w = useObservabilityWords();
  const healing = useHealingPanelState({
    healingIssues: [],
    triggerHealing,
    selectedPersonaId,
    personas,
    fetchHealingTimeline: () => {},
  });
  const seam = { analysisTargetId: (healing as unknown as { analysisTargetId?: string | null }).analysisTargetId };
  return (
    <HealingIssuesPanel
      healingIssues={[]}
      healingRunning={false}
      handleRunAnalysis={healing.handleRunAnalysis}
      resolveHealingIssue={() => {}}
      setSelectedIssue={healing.setSelectedIssue}
      issueFilter={healing.issueFilter}
      setIssueFilter={healing.setIssueFilter}
      issueCounts={healing.issueCounts}
      sortedFilteredIssues={healing.sortedFilteredIssues}
      analysisResult={healing.analysisResult}
      setAnalysisResult={() => healing.setAnalysisResult(null)}
      analysisError={healing.analysisError}
      setAnalysisError={() => healing.setAnalysisError(null)}
      viewMode={healing.healingViewMode}
      setViewMode={healing.setHealingViewMode}
      timelineEvents={[]}
      timelineLoading={false}
      issuesLoading={false}
      selectedPersonaId={selectedPersonaId}
      personas={personas}
      w={w}
      {...seam}
    />
  );
}

const runButton = () => screen.getByTestId('obs-run-analysis') as HTMLButtonElement;

/** The result line is the block that holds the outcome text and its dismiss button. */
async function resultLine() {
  const dismiss = await screen.findByRole('button', { name: en.common.dismiss });
  const line = dismiss.closest('p, div');
  expect(line?.textContent).toContain(en.overview.healing_issues_panel.analysis_complete_prefix);
  return line!;
}

describe('Health issues: Run analysis names what it checked', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['overview']);
  });

  it('on all agents the result line names the agent actually analysed, the first one', async () => {
    const trigger = vi.fn<Trigger>().mockResolvedValue(RESULT);
    render(<Harness selectedPersonaId={null} personas={[ALPHA, BRAVO]} triggerHealing={trigger} />);

    fireEvent.click(runButton());
    await waitFor(() => expect(trigger).toHaveBeenCalledWith(ALPHA.id));

    const line = await resultLine();
    expect(line.textContent).toContain(ALPHA.name);
    expect(line.textContent).not.toContain(BRAVO.name);
  });

  it('scoped to one agent the result line names that agent', async () => {
    const trigger = vi.fn<Trigger>().mockResolvedValue(RESULT);
    render(<Harness selectedPersonaId={BRAVO.id} personas={[ALPHA, BRAVO]} triggerHealing={trigger} />);

    fireEvent.click(runButton());
    await waitFor(() => expect(trigger).toHaveBeenCalledWith(BRAVO.id));

    const line = await resultLine();
    expect(line.textContent).toContain(BRAVO.name);
    expect(line.textContent).not.toContain(ALPHA.name);
  });

  it('a result keeps naming the agent it was run on after the scope changes', async () => {
    const trigger = vi.fn<Trigger>().mockResolvedValue(RESULT);
    const { rerender } = render(<Harness selectedPersonaId={null} personas={[ALPHA, BRAVO]} triggerHealing={trigger} />);

    fireEvent.click(runButton());
    await resultLine();

    await act(async () => {
      rerender(<Harness selectedPersonaId={BRAVO.id} personas={[ALPHA, BRAVO]} triggerHealing={trigger} />);
    });

    const line = await resultLine();
    expect(line.textContent).toContain(ALPHA.name);
    expect(line.textContent).not.toContain(BRAVO.name);
  });

  it('with agents to check the button is live', () => {
    render(<Harness selectedPersonaId={null} personas={[ALPHA]} triggerHealing={vi.fn<Trigger>()} />);
    expect(runButton().disabled).toBe(false);
  });

  it('with no agents the button is disabled and the screen says why', () => {
    const trigger = vi.fn<Trigger>();
    render(<Harness selectedPersonaId={null} personas={[]} triggerHealing={trigger} />);

    expect(runButton().disabled).toBe(true);
    expect(screen.getByText((text) => text.includes(en.overview.health.no_agents))).toBeTruthy();

    fireEvent.click(runButton());
    expect(trigger).not.toHaveBeenCalled();
  });
});
