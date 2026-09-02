import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExecutionDetailTabs, tabButtonId, tabPanelId } from '../ExecutionDetailTabs';

function renderTabs(idScope: string, over: { hasPipeline?: boolean; executionStatus?: string } = {}) {
  return render(
    <ExecutionDetailTabs
      activeTab="detail"
      setActiveTab={() => {}}
      hasToolSteps
      hasDirectorReview
      hasPipeline={over.hasPipeline ?? true}
      hasChain
      executionStatus={over.executionStatus ?? 'completed'}
      idScope={idScope}
    />,
  );
}

const tabIds = (r: ReturnType<typeof render>) =>
  Array.from(r.container.querySelectorAll('[role="tab"]')).map((n) => n.getAttribute('data-tab-id'));

describe('ExecutionDetailTabs accessibility wiring', () => {
  it('points every tab at the panel it controls', () => {
    renderTabs('exec-1');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBeGreaterThan(1);
    for (const tab of tabs) {
      // Without aria-controls the tablist announces a selection the reader has
      // no way to reach — an incomplete widget, not a styling detail.
      expect(tab.getAttribute('aria-controls')).toBe(tabPanelId('exec-1'));
      expect(tab.id).toBe(tabButtonId('exec-1', tab.getAttribute('data-tab-id') as never));
    }
  });

  it('scopes ids per execution so the nested chain drill-down cannot collide', () => {
    const outer = renderTabs('exec-1');
    const inner = renderTabs('exec-2');
    const outerIds = Array.from(outer.container.querySelectorAll('[role="tab"]')).map((n) => n.id);
    const innerIds = Array.from(inner.container.querySelectorAll('[role="tab"]')).map((n) => n.id);
    expect(outerIds.some((id) => innerIds.includes(id))).toBe(false);
  });
});

describe('ExecutionDetailTabs — the Replay tab is only offered when there is a replay', () => {
  it('offers Replay for a terminal run that started', () => {
    expect(tabIds(renderTabs('exec-r1'))).toContain('replay');
  });

  it('withholds Replay for a run that never started', () => {
    // `hasPipeline` is `!!execution.started_at`. Without it there is no log
    // file and no elapsed time, so the tab opened onto an empty terminal, a
    // dead scrubber and a playhead stuck at zero — an offer the record cannot
    // honour.
    expect(tabIds(renderTabs('exec-r2', { hasPipeline: false }))).not.toContain('replay');
  });

  it('still withholds Replay while the run is live', () => {
    expect(tabIds(renderTabs('exec-r3', { executionStatus: 'running' }))).not.toContain('replay');
  });
});
