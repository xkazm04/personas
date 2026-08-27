import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExecutionDetailTabs, tabButtonId, tabPanelId } from '../ExecutionDetailTabs';

function renderTabs(idScope: string) {
  return render(
    <ExecutionDetailTabs
      activeTab="detail"
      setActiveTab={() => {}}
      hasToolSteps
      hasDirectorReview
      hasPipeline
      hasChain
      executionStatus="completed"
      idScope={idScope}
    />,
  );
}

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
