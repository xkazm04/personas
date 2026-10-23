import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));
vi.mock('@/api/agents/buildSession', () => ({
  updateBuildSessionDisabledDims: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ buildSessionId: null, activeBuildSessionId: null, buildSessions: {} }),
}));

import { useAdoptionDimensionModel } from '../useAdoptionDimensionModel';
import type { PersonaLayoutAdoptionModelProps } from '../personaLayoutAdoptionTypes';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';

// Real template shape (scripts/templates/**): the authored `dimension` and the
// petal the question is SHOWN on (questionToDimension: vault_category, then
// category) disagree for 107 of 236 template questions. This pair is that case.
const onAppsPetal: TransformQuestionResponse = {
  id: 'q_api_key', question: 'Which account?', type: 'text',
  category: 'credentials', dimension: 'task', use_case_id: 'uc_digest',
};
const onErrorPetal: TransformQuestionResponse = {
  id: 'q_threshold', question: 'Alert threshold?', type: 'text',
  category: 'quality', dimension: 'task', use_case_id: 'uc_digest',
};

const props = (): PersonaLayoutAdoptionModelProps => ({
  designResult: { use_cases: [{ id: 'uc_digest', title: 'Morning digest', description: 'd', enabled: true }] },
  templateName: 'Digest',
  selectedUseCaseIds: new Set(['uc_digest']),
  onToggleUseCase: vi.fn(),
  questions: [onAppsPetal, onErrorPetal],
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

describe('turning a petal off drops the questions shown on THAT petal', () => {
  it('disabling Apps stops its question gating Continue', () => {
    const { result } = renderHook(() => useAdoptionDimensionModel(props()));
    expect(result.current.globalRemaining).toBe(2);

    act(() => { result.current.toggleDimDisabled('connector', false); });

    expect(result.current.filteredQuestions.map((q) => q.id)).toEqual(['q_threshold']);
    expect(result.current.globalRemaining).toBe(1);
    expect(result.current.perCapability[0]!.total).toBe(1);
  });

  it('disabling What leaves the questions shown on other petals in place', () => {
    const { result } = renderHook(() => useAdoptionDimensionModel(props()));

    act(() => { result.current.toggleDimDisabled('task', false); });

    // Neither question is on the What petal, so nothing may silently vanish
    // from the gate (a required question skipped without an answer).
    expect(result.current.filteredQuestions.map((q) => q.id)).toEqual(['q_api_key', 'q_threshold']);
    expect(result.current.globalRemaining).toBe(2);
  });
});
