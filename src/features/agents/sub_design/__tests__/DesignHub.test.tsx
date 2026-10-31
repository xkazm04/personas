import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useSystemStore } from '@/stores/systemStore';
import type { PersonaDraft } from '@/features/agents/sub_editor';
import { DesignHub } from '../DesignHub';

vi.mock('../components/DesignLifePanels', () => ({
  DesignManifestPanel: () => <div data-testid="panel-manifest" />,
  DesignResponsibilitiesPanel: () => <div data-testid="panel-responsibilities" />,
  DesignBrainPanel: () => <div data-testid="panel-brain" />,
}));
vi.mock('../components/DesignSubtabPanels', () => ({
  DesignConnectorsPanel: () => <div data-testid="panel-connectors" />,
}));

const TABS = ['manifest', 'responsibilities', 'brain', 'connectors'] as const;

function renderHub() {
  // Cast: DesignHub ignores its props (all panels read the store).
  return render(<DesignHub draft={{} as PersonaDraft} patch={() => {}} modelDirty={false} />);
}

describe('DesignHub sub-tab fallback', () => {
  beforeEach(() => {
    useSystemStore.setState({ designSubTab: 'manifest' });
  });

  it('renders all four sub-tabs', () => {
    renderHub();
    for (const id of TABS) expect(screen.getByTestId(`design-subtab-${id}`)).toBeTruthy();
  });

  it('lands an unknown persisted sub-tab on manifest instead of blanking', async () => {
    // Cast: 'prompt' was a sub-tab before the manifest rebase; an older build
    // can still have it persisted, which is exactly the case under test.
    useSystemStore.setState(
      { designSubTab: 'prompt' } as unknown as Parameters<typeof useSystemStore.setState>[0],
    );
    renderHub();
    expect(await screen.findByTestId('panel-manifest')).toBeTruthy();
    expect(screen.getByTestId('design-subtab-manifest').className).toContain('text-primary');
    for (const id of TABS.slice(1)) {
      expect(screen.getByTestId(`design-subtab-${id}`).className).not.toContain('text-primary');
    }
  });

  it('exposes the sub-tabs as a WAI-ARIA tab set with arrow-key movement', () => {
    renderHub();
    expect(screen.getByRole('tablist')).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    const selected = tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true');
    expect(selected.map((tab) => tab.dataset.testid)).toEqual(['design-subtab-manifest']);
    // The swapped region is the declared panel of the selected tab.
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0]!.id);
    expect(tabs[0]!.getAttribute('aria-controls')).toBe(panel.id);
    // Roving tabindex: only the selected tab is a Tab stop.
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1]);
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' });
    expect(useSystemStore.getState().designSubTab).toBe('responsibilities');
    fireEvent.keyDown(tabs[0]!, { key: 'End' });
    expect(useSystemStore.getState().designSubTab).toBe('connectors');
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowLeft' });
    expect(useSystemStore.getState().designSubTab).toBe('connectors');
  });

  it('honours a known persisted sub-tab', async () => {
    useSystemStore.setState({ designSubTab: 'brain' });
    renderHub();
    expect(await screen.findByTestId('panel-brain')).toBeTruthy();
    expect(screen.queryByTestId('panel-manifest')).toBeNull();
  });
});
