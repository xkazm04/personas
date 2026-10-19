/**
 * The analyze step's "Build Persona" handoff to the matrix build.
 *
 * The step renders a checkbox per parsed tool, trigger and connector, a
 * "N tools / N triggers / N connectors selected for import" summary and a
 * ledger line counting what the user deselected - and the handoff serialized
 * the WHOLE parse anyway, so an unticked node still reached the build.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AgentIR } from '@/lib/types/designTypes';

const parsedResult = {
  name: 'Wf',
  summary: 'A workflow',
  suggested_tools: ['http_request', 'gmail_send', 'slack_post'],
  suggested_triggers: [
    { trigger_type: 'schedule', config: {}, description: 'Every hour' },
    { trigger_type: 'webhook', config: {}, description: 'On hook' },
  ],
  suggested_connectors: [
    { name: 'gmail', credential_fields: [], related_tools: [], related_triggers: [] },
    { name: 'slack', credential_fields: [], related_tools: [], related_triggers: [] },
  ],
} as AgentIR; // test fixture: only the fields the analyze step reads

const wizard = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));

vi.mock('../../hooks/useN8nWizard', () => ({
  useN8nWizard: () => ({
    state: wizard.state,
    dispatch: vi.fn(),
    canGoBack: true,
    goBack: vi.fn(),
    handleNext: vi.fn(),
    processContent: vi.fn(),
    handleReset: vi.fn(),
    analyzing: false,
    connectorsMissing: 0,
    fileInputRef: { current: null },
    direction: 1,
  }),
}));

import N8nImportTab from '../N8nImportTab';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';

const setWorkflowImport = vi.fn();

beforeEach(() => {
  setWorkflowImport.mockReset();
  useAgentStore.setState({ setWorkflowImport } as never);
  useSystemStore.setState({
    setSidebarSection: vi.fn(),
    setIsCreatingPersona: vi.fn(),
  } as never);
  wizard.state = {
    step: 'analyze',
    error: null,
    sessionWarning: null,
    transforming: false,
    confirming: false,
    created: false,
    draft: null,
    parsedResult,
    rawWorkflowJson: '{"nodes":[]}',
    workflowName: 'Wf',
    platform: 'n8n',
    platformNeedsConfirmation: false,
    // The user unticked gmail_send, the webhook trigger and the slack connector.
    selectedToolIndices: new Set([0, 2]),
    selectedTriggerIndices: new Set([0]),
    selectedConnectorNames: new Set(['gmail']),
  };
});

describe('N8nImportTab build handoff', () => {
  it('sends only the ticked tools, triggers and connectors to the build', () => {
    render(<N8nImportTab />);
    fireEvent.click(screen.getByRole('button', { name: /build persona/i }));

    expect(setWorkflowImport).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(setWorkflowImport.mock.calls[0]![0].parserResultJson) as AgentIR;
    expect(sent.suggested_tools).toEqual(['http_request', 'slack_post']);
    expect(sent.suggested_triggers.map((tr) => tr.trigger_type)).toEqual(['schedule']);
    expect(sent.suggested_connectors?.map((c) => c.name)).toEqual(['gmail']);
  });
});
