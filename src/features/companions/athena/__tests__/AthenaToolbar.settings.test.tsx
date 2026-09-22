import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AthenaToolbar } from '../AthenaToolbar';
import { useSystemStore } from '@/stores/systemStore';

vi.mock('@/api/companion', () => ({
  companionListActiveConnectors: vi.fn().mockResolvedValue([]),
  companionListPluginToggles: vi.fn().mockResolvedValue([]),
  companionRemoveConnector: vi.fn(),
  companionSetActiveConnectors: vi.fn(),
  companionSetConnectorEnabled: vi.fn(),
  companionSetPluginEnabled: vi.fn(),
}));

describe('AthenaToolbar settings gear', () => {
  beforeEach(() => {
    useSystemStore.setState({
      sidebarSection: 'home',
      companionsPage: 'athena:memory',
    } as never);
  });

  it('deep-links to Companions > Athena > Setup', () => {
    render(
      <AthenaToolbar
        onOpenBrain={() => {}}
        brainOpen={false}
        disabled={false}
        compact={false}
        onToggleCompact={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId('companion-open-settings'));

    const s = useSystemStore.getState();
    expect(s.sidebarSection).toBe('companions');
    expect(s.companionsPage).toBe('athena:setup');
  });
});
