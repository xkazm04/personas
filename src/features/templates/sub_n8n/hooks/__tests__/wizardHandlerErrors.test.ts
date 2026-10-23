import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

/**
 * `invokeWithTimeout` rejects with the serialized AppError OBJECT
 * (`{ error, kind, ... }`), never an `Error`. The wizard's handlers used
 * `err instanceof Error ? err.message : '<generic fallback>'`, so every
 * backend refusal ("Another transform is already running for this session",
 * "Payload too large", a confirm failure) was replaced by the generic line.
 */
const ipcError = (msg: string) => ({ error: msg, kind: 'validation', category: 'validation' });

const api = vi.hoisted(() => ({
  startN8nTransformBackground: vi.fn(),
  continueN8nTransform: vi.fn(),
  cancelN8nTransform: vi.fn(),
  getN8nTransformSnapshot: vi.fn(),
  clearN8nTransformSnapshot: vi.fn(() => Promise.resolve()),
  confirmN8nPersonaDraft: vi.fn(),
}));
const tests = vi.hoisted(() => ({ testN8nDraft: vi.fn() }));

vi.mock('@/api/templates/n8nTransform', () => api);
vi.mock('@/api/agents/tests', () => tests);
vi.mock('@/stores/vaultStore', () => ({
  useVaultStore: { getState: () => ({ connectorDefinitions: [], credentials: [] }) },
}));

import { createTransformHandlers } from '../useN8nWizardTransformHandlers';
import { createLifecycleHandlers } from '../useN8nWizardLifecycleHandlers';
import { useN8nImportReducer, type N8nImportState } from '../useN8nImportReducer';
import type { WizardDeps } from '../n8nWizardTypes';
import type { AgentIR } from '@/lib/types/designTypes';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';

const parsed: AgentIR = {
  structured_prompt: { identity: '', instructions: '', toolGuidance: '', examples: '', errorHandling: '', customSections: [] },
  suggested_tools: [],
  suggested_triggers: [],
  full_prompt_markdown: '',
  summary: '',
};

const draft: N8nPersonaDraft = {
  name: 'P', description: null, system_prompt: 'Do it', structured_prompt: null, icon: null,
  color: null, model_profile: null, max_budget_usd: null, max_turns: null, design_context: null,
};

function makeDeps(overrides: Partial<N8nImportState>) {
  const base = renderHook(() => useN8nImportReducer()).result.current.state;
  const dispatch = vi.fn();
  const deps: WizardDeps = {
    state: { ...base, ...overrides },
    dispatch,
    transform: {
      currentTransformId: null,
      setAnalyzing: vi.fn(),
      startTransformStream: vi.fn(() => Promise.resolve()),
      resetTransformStream: vi.fn(() => Promise.resolve()),
      setIsRestoring: vi.fn(),
    },
    test: { startTestStream: vi.fn(() => Promise.resolve()), resetTestStream: vi.fn(() => Promise.resolve()) },
    session: { clearPersistedContext: vi.fn(), remove: vi.fn() },
    setN8nTransformActive: vi.fn(),
    fetchPersonas: vi.fn(() => Promise.resolve()),
    selectPersona: vi.fn(),
    setConfirmResult: vi.fn(),
    transformLockRef: { current: false },
    confirmingRef: { current: false },
    fileInputRef: { current: null },
  };
  return { deps, dispatch };
}

function errorOf(dispatch: ReturnType<typeof vi.fn>, type: string): unknown {
  const call = dispatch.mock.calls.find(([a]) => (a as { type: string }).type === type);
  return (call?.[0] as { error?: unknown } | undefined)?.error;
}

describe('n8n wizard handlers surface the backend refusal, not a generic line', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('handleTransform', async () => {
    api.startN8nTransformBackground.mockRejectedValue(ipcError('Another transform is already running for this session.'));
    const { deps, dispatch } = makeDeps({ parsedResult: parsed, rawWorkflowJson: '{}' });
    await createTransformHandlers(deps).handleTransform();
    expect(errorOf(dispatch, 'TRANSFORM_FAILED')).toBe('Another transform is already running for this session.');
  });

  it('handleContinueTransform', async () => {
    api.continueN8nTransform.mockRejectedValue(ipcError('Transform not found'));
    const { deps, dispatch } = makeDeps({ backgroundTransformId: 't1', sessionId: 's1' });
    await createTransformHandlers(deps).handleContinueTransform();
    expect(errorOf(dispatch, 'TRANSFORM_FAILED')).toBe('Transform not found');
  });

  it('handleCancelTransform', async () => {
    api.cancelN8nTransform.mockRejectedValue(ipcError('Not authenticated'));
    const { deps, dispatch } = makeDeps({ backgroundTransformId: 't1' });
    await createTransformHandlers(deps).handleCancelTransform();
    expect(errorOf(dispatch, 'SET_ERROR')).toBe('Not authenticated');
  });

  it('handleConfirmSave', async () => {
    api.confirmN8nPersonaDraft.mockRejectedValue(ipcError('Persona name already exists'));
    const { deps, dispatch } = makeDeps({ draft });
    await createLifecycleHandlers(deps).handleConfirmSave();
    expect(errorOf(dispatch, 'CONFIRM_FAILED')).toBe('Persona name already exists');
  });

  it('handleTestDraft', async () => {
    tests.testN8nDraft.mockRejectedValue(ipcError("A draft test with id 'x' is already running"));
    const { deps, dispatch } = makeDeps({ draft });
    await createLifecycleHandlers(deps).handleTestDraft();
    expect(errorOf(dispatch, 'TEST_FAILED')).toBe("A draft test with id 'x' is already running");
  });

  it('keeps the generic fallback when the rejection carries no text', async () => {
    api.startN8nTransformBackground.mockRejectedValue(undefined);
    const { deps, dispatch } = makeDeps({ parsedResult: parsed, rawWorkflowJson: '{}' });
    await createTransformHandlers(deps).handleTransform();
    expect(errorOf(dispatch, 'TRANSFORM_FAILED')).toBe('Failed to generate transformation draft.');
  });
});
