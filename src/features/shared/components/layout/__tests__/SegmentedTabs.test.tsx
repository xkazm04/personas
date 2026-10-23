import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SegmentedTabs, segmentedTabPanelProps } from '../SegmentedTabs';

const TABS = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
] as const;

function danglingControls(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[role="tab"][aria-controls]'))
    .map((tab) => tab.getAttribute('aria-controls') ?? '')
    .filter((id) => !container.ownerDocument.getElementById(id));
}

describe('SegmentedTabs aria-controls', () => {
  for (const variant of ['pill', 'segment'] as const) {
    it(`${variant}: claims no panel when the caller declared none`, () => {
      const { container } = render(
        <SegmentedTabs tabs={[...TABS]} activeTab="a" onTabChange={() => {}} variant={variant} />,
      );
      expect(screen.getAllByRole('tab')).toHaveLength(2);
      expect(danglingControls(container)).toEqual([]);
      expect(container.querySelector('[aria-controls]')).toBeNull();
    });

    it(`${variant}: points at the panel the caller renders with idPrefix`, () => {
      render(
        <>
          <SegmentedTabs tabs={[...TABS]} activeTab="b" onTabChange={() => {}} variant={variant} idPrefix="demo" />
          <div {...segmentedTabPanelProps('demo', 'b')} role="tabpanel">panel</div>
        </>,
      );
      const active = screen.getByRole('tab', { selected: true });
      expect(active.getAttribute('aria-controls')).toBe('demo-panel-b');
      expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(active.id);
    });
  }
});
