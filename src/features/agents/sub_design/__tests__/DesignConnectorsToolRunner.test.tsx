/**
 * Design -> Connectors mounts the tool runner. sweep #277.
 *
 * `ToolRunnerPanel` / `ToolRunnerModal` implemented `invoke_tool_direct` with a
 * timeout, a persona-bleed guard and honest builtin handling, and had ZERO
 * mounts in `src/` - the sub-tab that lists what an agent reaches offered no
 * way to prove any of it works. These cases pin the mount, the two tool kinds
 * it must handle differently, and the empty case.
 *
 * The heavy neighbours (live connector verification, the design recap) are
 * stubbed: they each pull the vault + verification machinery and are covered by
 * their own tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaToolDefinition } from '@/lib/bindings/PersonaToolDefinition';
import { useAgentStore } from '@/stores/agentStore';
import { useVaultStore } from '@/stores/vaultStore';
import { useToastStore } from '@/stores/toastStore';

vi.mock('@/features/agents/sub_connectors/components/connectors/ConnectorVerificationPanel', () => ({
  ConnectorVerificationPanel: () => <div data-testid="stub-verification" />,
}));
const verificationState = { credentialsLoaded: true };
const testConnectorMock = vi.hoisted(() => vi.fn());
vi.mock('@/features/agents/sub_connectors/libs/useConnectorStatuses', () => ({
  useConnectorStatuses: () => ({
    requiredCredTypes: [],
    testConnector: testConnectorMock,
    credentialsLoaded: verificationState.credentialsLoaded,
  }),
}));
vi.mock('@/features/templates/sub_generated/design-preview/ConnectorsSection', () => ({
  ConnectorsSection: (props: { onTestConnector?: (name: string, credId: string) => void }) => (
    <div data-testid="stub-recap">
      <button data-testid="stub-recap-test" onClick={() => props.onTestConnector?.('gmail', 'cred-1')} />
    </div>
  ),
}));

import { DesignConnectorsPanel } from '../components/DesignSubtabPanels';

function tool(over: Partial<PersonaToolDefinition> = {}): PersonaToolDefinition {
  return {
    id: 'tool-1',
    name: 'fetch_weather',
    description: null,
    script_path: null,
    category: 'api',
    input_schema: null,
    requires_credential_type: 'openweather',
    ...over,
  } as unknown as PersonaToolDefinition;
}

function persona(tools: PersonaToolDefinition[]): Persona {
  return { id: 'p-1', name: 'Weather Bot', tools } as unknown as Persona;
}

function setPersona(tools: PersonaToolDefinition[]): void {
  useAgentStore.setState({ selectedPersona: persona(tools), toolDefinitions: [] });
}

describe('DesignConnectorsPanel design recap waits for the vault', () => {
  const design = JSON.stringify({ suggested_connectors: [{ name: 'gmail' }], suggested_tools: [] });

  beforeEach(() => {
    useVaultStore.setState({ credentials: [], connectorDefinitions: [] });
    useAgentStore.setState({
      selectedPersona: { id: 'p-1', name: 'Mail Bot', tools: [], last_design_result: design } as unknown as Persona,
      toolDefinitions: [],
    });
  });

  it('withholds the recap until the first credential fetch settles', () => {
    // An empty vault before the fetch lands is "not yet", not "none": the recap
    // would paint every proposed connector "Configure credential".
    verificationState.credentialsLoaded = false;
    render(<DesignConnectorsPanel />);
    expect(screen.queryByTestId('stub-recap')).not.toBeInTheDocument();
  });

  it('shows the recap once credentials are loaded', () => {
    verificationState.credentialsLoaded = true;
    render(<DesignConnectorsPanel />);
    expect(screen.getByTestId('stub-recap')).toBeInTheDocument();
  });
});

describe('DesignConnectorsPanel mounts the tool runner', () => {
  beforeEach(() => {
    useVaultStore.setState({ credentials: [], connectorDefinitions: [] });
    setPersona([]);
  });

  it('renders the runner for a persona that carries tools', () => {
    setPersona([tool()]);
    render(<DesignConnectorsPanel />);
    expect(screen.getByTestId('design-connectors-tool-runner')).toBeInTheDocument();
    expect(screen.getByTestId('tool-card-toggle-fetch_weather')).toBeInTheDocument();
  });

  it('offers Run on a credential-backed tool', () => {
    setPersona([tool()]);
    render(<DesignConnectorsPanel />);
    fireEvent.click(screen.getByTestId('tool-card-toggle-fetch_weather'));
    expect(screen.getByTestId('tool-run-fetch_weather')).toBeInTheDocument();
  });

  it('explains a builtin tool instead of offering a Run that would fail', () => {
    // builtin:// tools execute inside persona runs only; a Run here reported a
    // false "misconfigured", which reads as "my persona is broken".
    setPersona([tool({ id: 'tool-2', name: 'memory_write', script_path: 'builtin://memory_write' })]);
    render(<DesignConnectorsPanel />);
    fireEvent.click(screen.getByTestId('tool-card-toggle-memory_write'));
    expect(screen.getByTestId('tool-builtin-note-memory_write')).toBeInTheDocument();
    expect(screen.queryByTestId('tool-run-memory_write')).not.toBeInTheDocument();
  });

  it('shows no runner chrome when the persona has no tools at all', () => {
    setPersona([]);
    render(<DesignConnectorsPanel />);
    expect(screen.queryByTestId('design-connectors-tool-runner')).not.toBeInTheDocument();
  });
});

describe('DesignConnectorsPanel recap Test outcome', () => {
  const design = JSON.stringify({ suggested_connectors: [{ name: 'gmail' }], suggested_tools: [] });

  beforeEach(() => {
    verificationState.credentialsLoaded = true;
    testConnectorMock.mockReset();
    useToastStore.setState({ toasts: [] });
    useVaultStore.setState({ credentials: [], connectorDefinitions: [] });
    useAgentStore.setState({
      selectedPersona: { id: 'p-1', name: 'Mail Bot', tools: [], last_design_result: design } as unknown as Persona,
      toolDefinitions: [],
    });
  });

  it('tells the user when the probe was unreachable', async () => {
    testConnectorMock.mockResolvedValue({ success: false, message: 'offline', state: 'unreachable' });
    render(<DesignConnectorsPanel />);
    fireEvent.click(screen.getByTestId('stub-recap-test'));
    await waitFor(() => expect(testConnectorMock).toHaveBeenCalled());
    await waitFor(() => expect(useToastStore.getState().toasts.some((x) => x.message === 'offline')).toBe(true));
  });

  it('stays quiet for a real verdict (the store repaints the row)', async () => {
    testConnectorMock.mockResolvedValue({ success: false, message: 'bad key', state: 'failed' });
    render(<DesignConnectorsPanel />);
    fireEvent.click(screen.getByTestId('stub-recap-test'));
    await waitFor(() => expect(testConnectorMock).toHaveBeenCalled());
    await Promise.resolve();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
