/**
 * Design -> Connectors empty state: a persona with no tools and no saved design
 * must say why it is empty and offer the way out (Responsibilities, where tools
 * come from), not a bare "Connectors" title over an illustration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import type { Persona } from '@/lib/bindings/Persona';
import { useAgentStore } from '@/stores/agentStore';
import { useVaultStore } from '@/stores/vaultStore';
import { useSystemStore } from '@/stores/systemStore';

vi.mock('@/features/agents/sub_connectors/components/connectors/ConnectorVerificationPanel', () => ({
  ConnectorVerificationPanel: () => <div data-testid="stub-verification" />,
}));
vi.mock('@/features/agents/sub_connectors/libs/useConnectorStatuses', () => ({
  useConnectorStatuses: () => ({ requiredCredTypes: [], testConnector: vi.fn(), credentialsLoaded: true }),
}));
vi.mock('@/features/templates/sub_generated/design-preview/ConnectorsSection', () => ({
  ConnectorsSection: () => <div data-testid="stub-recap" />,
}));

import { DesignConnectorsPanel } from '../components/DesignSubtabPanels';

describe('DesignConnectorsPanel empty state', () => {
  beforeEach(() => {
    useVaultStore.setState({ credentials: [], connectorDefinitions: [] });
    useAgentStore.setState({
      selectedPersona: { id: 'p-1', name: 'Blank', tools: [], last_design_result: null } as unknown as Persona,
      toolDefinitions: [],
    });
    useSystemStore.setState({ designSubTab: 'connectors' });
  });

  it('explains why it is empty and offers a next step', () => {
    render(<DesignConnectorsPanel />);
    expect(screen.getByTestId('scenario-empty-state')).toBeInTheDocument();
    expect(screen.getByText(/reaches no tools yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /responsibilities/i })).toBeInTheDocument();
  });

  it('the action switches the Design hub to the Responsibilities sub-tab', () => {
    render(<DesignConnectorsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /responsibilities/i }));
    expect(useSystemStore.getState().designSubTab).toBe('responsibilities');
  });
});
