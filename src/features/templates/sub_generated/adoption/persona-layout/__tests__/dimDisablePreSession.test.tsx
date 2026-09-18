import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

const updateBuildSessionDisabledDims = vi.fn(() => Promise.resolve());
vi.mock('@/api/agents/buildSession', () => ({
  updateBuildSessionDisabledDims: (...a: unknown[]) => updateBuildSessionDisabledDims(...(a as [])),
}));

// The build session the adoption surface writes into. `null` is the state the
// configure step actually runs in: the session is minted on Continue.
const agentState: { buildSessionId: string | null; activeBuildSessionId: string | null; buildSessions: Record<string, unknown> } = {
  buildSessionId: null,
  activeBuildSessionId: null,
  buildSessions: {},
};
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: typeof agentState) => unknown) => sel(agentState),
}));

import { useAdoptionDimensionModel } from '../useAdoptionDimensionModel';
import type { PersonaLayoutAdoptionModelProps } from '../personaLayoutAdoptionTypes';

const USE_CASE = { id: 'uc_digest', title: 'Morning digest', description: 'digest', enabled: true };

const props = (): PersonaLayoutAdoptionModelProps => ({
  designResult: { use_cases: [USE_CASE] },
  templateName: 'Digest',
  selectedUseCaseIds: new Set(['uc_digest']),
  onToggleUseCase: vi.fn(),
  questions: [],
  userAnswers: {},
  onAnswerUpdated: vi.fn(),
  autoDetectedIds: new Set(),
  blockedQuestionIds: new Set(),
  onContinue: vi.fn(),
  onClose: vi.fn(),
  triggerSelections: {},
  onTriggerChange: vi.fn(),
  eventSubsByCap: {},
  onEventSubsChange: vi.fn(),
  dimPolicyByCap: {},
  onDimPolicyChange: vi.fn(),
  manualConnectors: [],
  onManualConnectorsChange: vi.fn(),
  connectorTables: {},
  onConnectorTablesChange: vi.fn(),
  notificationChannels: null,
  onNotificationChannelsChange: vi.fn(),
});

describe('dim-disable before a build session exists', () => {
  beforeEach(() => {
    updateBuildSessionDisabledDims.mockClear();
    agentState.buildSessionId = null;
    agentState.activeBuildSessionId = null;
    agentState.buildSessions = {};
  });

  it('records the disable locally instead of dropping the click', () => {
    const { result } = renderHook(() => useAdoptionDimensionModel(props()));

    act(() => { result.current.toggleDimDisabled('review', false); });

    expect(result.current.disabledDimsForActive.has('review')).toBe(true);
    // Nothing to persist to yet — the click must not silently become an IPC.
    expect(updateBuildSessionDisabledDims).not.toHaveBeenCalled();
  });

  it('flushes the pre-session choice when the session appears', () => {
    const { result, rerender } = renderHook(() => useAdoptionDimensionModel(props()));
    act(() => { result.current.toggleDimDisabled('review', false); });

    agentState.buildSessionId = 'sess-1';
    rerender();

    expect(updateBuildSessionDisabledDims).toHaveBeenCalledTimes(1);
    const [sessionId, json] = updateBuildSessionDisabledDims.mock.calls[0] as [string, string];
    expect(sessionId).toBe('sess-1');
    expect(JSON.parse(json)).toEqual({ uc_digest: ['review'] });
    // And the petal is still off after the flush.
    expect(result.current.disabledDimsForActive.has('review')).toBe(true);
  });

  it('writes straight through once a session exists', () => {
    agentState.buildSessionId = 'sess-2';
    const { result } = renderHook(() => useAdoptionDimensionModel(props()));

    act(() => { result.current.toggleDimDisabled('memory', false); });

    expect(updateBuildSessionDisabledDims).toHaveBeenCalledTimes(1);
    expect(updateBuildSessionDisabledDims.mock.calls[0]![0]).toBe('sess-2');
    expect(result.current.disabledDimsForActive.has('memory')).toBe(true);
  });

  it('re-enabling before the session clears the pending entry', () => {
    const { result, rerender } = renderHook(() => useAdoptionDimensionModel(props()));
    act(() => { result.current.toggleDimDisabled('review', false); });
    act(() => { result.current.toggleDimDisabled('review', true); });

    agentState.buildSessionId = 'sess-3';
    rerender();

    expect(result.current.disabledDimsForActive.has('review')).toBe(false);
    // An empty set persists as null, not "{}" — the session has no disables.
    expect(updateBuildSessionDisabledDims).toHaveBeenCalledWith('sess-3', null);
  });
});
