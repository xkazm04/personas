/**
 * A tab-list read that fails AFTER tabs are showing keeps the old strip (a
 * failed read is not "no tabs"), so the strip itself must say the list may be
 * stale and offer the retry. With no tabs the page's empty state carries the
 * failure and the strip renders nothing.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import TabStrip from '../webview/TabStrip';
import type { BrowserTab } from '../types';

const TAB: BrowserTab = {
  id: 1,
  url: 'https://app.example.com',
  title: 'App',
  origin: 'https://app.example.com',
  focused: true,
  lease: null,
  can_go_back: false,
  can_go_forward: false,
};

describe('TabStrip tab-list failure', () => {
  it('shows the failure beside existing tabs and retries on press', () => {
    const onRetry = vi.fn();
    render(
      <TabStrip
        tabs={[TAB]}
        activeTabId={1}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        error="The tab list could not be read."
        onRetry={onRetry}
      />,
    );
    expect(screen.getByTestId('webview-tab-1')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('The tab list could not be read.');
    fireEvent.click(screen.getByTestId('webview-tabs-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('says nothing when the last read succeeded', () => {
    render(<TabStrip tabs={[TAB]} activeTabId={1} onSelect={vi.fn()} onClose={vi.fn()} error={null} />);
    expect(screen.queryByTestId('webview-tabs-error')).toBeNull();
  });

  it('leaves the no-tabs failure to the page empty state', () => {
    const { container } = render(
      <TabStrip tabs={[]} activeTabId={null} onSelect={vi.fn()} onClose={vi.fn()} error="boom" />,
    );
    expect(container.innerHTML).toBe('');
  });
});
