import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';

vi.mock('@tauri-apps/api/app', () => ({ getVersion: () => Promise.resolve('1.0.0') }));
const announce = vi.fn();
vi.mock('@/features/shared/components/feedback/AriaLiveProvider', () => ({
  announceImperative: (m: string) => announce(m),
}));

import Sidebar from '../Sidebar';
import { useSystemStore } from '@/stores/systemStore';

describe('Sidebar focus transfer', () => {
  beforeEach(() => {
    announce.mockClear();
    act(() => { useSystemStore.getState().setSidebarSection('personas'); });
  });

  it('moves focus to the L2 heading and announces the section', async () => {
    render(<Sidebar />);
    const heading = document.querySelector('[data-sidebar-l2-heading]');
    expect(heading).toBeTruthy();
    expect(document.activeElement).not.toBe(heading);

    act(() => { useSystemStore.getState().setSidebarSection('overview'); });
    await waitFor(() => {
      expect(document.activeElement).toBe(document.querySelector('[data-sidebar-l2-heading]'));
    });
    expect(announce).toHaveBeenCalled();
  });

  it('announces without throwing for a section that has no L2 rail', async () => {
    render(<Sidebar />);
    act(() => { useSystemStore.getState().setSidebarSection('studio'); });
    await waitFor(() => expect(announce).toHaveBeenCalled());
    expect(document.querySelector('[data-sidebar-l2-heading]')).toBeNull();
  });
});
