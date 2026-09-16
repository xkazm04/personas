import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useSystemStore } from '@/stores/systemStore';
import type { DesignSubTab } from '@/lib/types/types';
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
    useSystemStore.setState({ designSubTab: 'prompt' as unknown as DesignSubTab });
    renderHub();
    expect(await screen.findByTestId('panel-manifest')).toBeTruthy();
    expect(screen.getByTestId('design-subtab-manifest').className).toContain('text-primary');
    for (const id of TABS.slice(1)) {
      expect(screen.getByTestId(`design-subtab-${id}`).className).not.toContain('text-primary');
    }
  });

  it('honours a known persisted sub-tab', async () => {
    useSystemStore.setState({ designSubTab: 'brain' });
    renderHub();
    expect(await screen.findByTestId('panel-brain')).toBeTruthy();
    expect(screen.queryByTestId('panel-manifest')).toBeNull();
  });
});
