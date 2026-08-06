import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CompanionToolbar } from '../CompanionToolbar';
import { useSystemStore } from '@/stores/systemStore';

vi.mock('@/api/companion', () => ({
  companionListActiveConnectors: vi.fn().mockResolvedValue([]),
  companionListPluginToggles: vi.fn().mockResolvedValue([]),
  companionRemoveConnector: vi.fn(),
  companionSetActiveConnectors: vi.fn(),
  companionSetConnectorEnabled: vi.fn(),
  companionSetPluginEnabled: vi.fn(),
}));

describe('CompanionToolbar settings gear', () => {
  beforeEach(() => {
    useSystemStore.setState({
      sidebarSection: 'home',
      pluginTab: 'browse',
      companionPluginTab: 'memory',
    } as never);
  });

  it('deep-links to Plugins > Companion > Setup', () => {
    render(
      <CompanionToolbar
        onOpenBrain={() => {}}
        brainOpen={false}
        disabled={false}
        compact={false}
        onToggleCompact={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId('companion-open-settings'));

    const s = useSystemStore.getState();
    expect(s.sidebarSection).toBe('plugins');
    expect(s.pluginTab).toBe('companion');
    expect(s.companionPluginTab).toBe('setup');
  });
});
