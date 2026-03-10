/**
 * useAsyncTransform — consolidates CLI stream, background snapshot polling,
 * localStorage persistence, and all async adoption handlers into a single
 * orchestration layer.
 */
import { useCallback, useRef, useState } from 'react';
import { useCorrelatedCliStream } from '@/hooks/execution/useCorrelatedCliStream';
import { useBackgroundSnapshot } from '@/hooks/utility/useBackgroundSnapshot';
import { usePersistedContext } from '@/hooks/utility/usePersistedContext';
import {
  startTemplateAdoptBackground,
  getTemplateAdoptSnapshot,
  clearTemplateAdoptSnapshot,
  cancelTemplateAdopt,
  confirmTemplateAdoptDraft,
  continueTemplateAdopt,
} from '@/api/templateAdopt';
import { usePersonaStore } from '@/stores/personaStore';
import {
  normalizeDraft,
  normalizeDraftFromUnknown,
  stringifyDraft,
} from '@/features/templates/sub_n8n/n8nTypes';
import {
  filterDesignResult,
  applyTriggerConfigs,
  substituteVariables,
} from './templateVariables';
import { applySandboxOverrides } from '@/lib/templates/templateVerification';
import { sendOsNotification, requestNotificationPermission } from '@/lib/utils/osNotification';
import type { SandboxPolicy } from '@/lib/types/templateTypes';
import type { ScanResult } from '@/lib/templates/personaSafetyScanner';
import type { N8nPersonaDraft } from '@/api/n8nTransform';
import type { TransformQuestionResponse } from '@/api/n8nTransform';
import type { AdoptState, PersistedAdoptContext } from './useAdoptReducer';
import { ADOPT_CONTEXT_KEY, ADOPT_CONTEXT_MAX_AGE_MS } from './useAdoptReducer';

/** Remove persisted adoption context from localStorage. Non-critical — silently ignores errors. */
function clearPersistedContext() {
  try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* non-critical */ }
}

// Module-level map of adopt IDs that have an in-flight confirmSave.
// Survives component remounts, preventing duplicate persona creation
// when the wizard unmounts and remounts while a confirm is pending.
// Each entry stores a timeout that auto-cleans stale keys after 2 minutes,
// so a hung or failed call doesn't permanently block retries.
const inflight = new Map<string, ReturnType<typeof setTimeout>>();
const INFLIGHT_TIMEOUT_MS = 120_000;

async function waitForPersonaInStore(personaId: string, attempts = 10, delayMs = 50): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const exists = usePersonaStore.getState().personas.some((persona) => persona.id === personaId);
    if (exists) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

// ── Types ──

interface WizardActions {
  transformStarted: (adoptId: string) => void;
  transformLines: (lines: string[]) => void;
  transformPhase: (phase: 'idle' | 'running' | 'completed' | 'failed') => void;
  transformCompleted: (draft: N8nPersonaDraft) => void;
  transformFailed: (error: string) => void;
  transformCancelled: () => void;
  questionsGenerated: (questions: TransformQuestionResponse[]) => void;
  awaitingAnswers: (questions: TransformQuestionResponse[]) => void;
  confirmStarted: () => void;
  confirmCompleted: () => void;
  confirmFailed: (error: string) => void;
  restoreContext: (templateName: string, designResultJson: string, adoptId: string) => void;
  setAdjustment: (text: string) => void;
  updatePreference: (key: string, value: unknown) => void;
  draftUpdated: (draft: N8nPersonaDraft) => void;
  reset: () => void;
  setError: (error: string) => void;
}

interface UseAsyncTransformOptions {
  state: AdoptState;
  wizard: WizardActions;
  reviewTestCaseName: string | undefined;
  onPersonaCreated: () => void;
  isOpen: boolean;
  sandboxPolicy: SandboxPolicy | null;
  /** Safety scan results — confirmSave is blocked when critical findings exist without override. */
  safetyScan: ScanResult | null;
}

// ── Hook ──

export function useAsyncTransform({
  state,
  wizard,
  reviewTestCaseName,
  onPersonaCreated,
  isOpen,
  sandboxPolicy,
  safetyScan,
}: UseAsyncTransformOptions) {
  const fetchPersonas = usePersonaStore((s) => s.fetchPersonas);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const setTemplateAdoptActive = usePersonaStore((s) => s.setTemplateAdoptActive);
  const confirmingRef = useRef(false);
  const transformStartingRef = useRef(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // ── CLI stream ──

  const {
    runId: currentAdoptId,
    start: startAdoptStream,
    reset: resetAdoptStream,
    setLines: setStreamLines,
    setPhase: setStreamPhase,
  } = useCorrelatedCliStream({
    outputEvent: 'template-adopt-output',
    statusEvent: 'template-adopt-status',
    idField: 'adopt_id',
    onFailed: (message) => wizard.transformFailed(message),
  });

  // ── Restore persisted context ──

  const handleRestoreContext = useCallback(
    (parsed: PersistedAdoptContext) => {
      setIsRestoring(true);
      wizard.restoreContext(parsed.templateName || '', parsed.designResultJson || '', parsed.adoptId);
      void startAdoptStream(parsed.adoptId);
    },
    [wizard.restoreContext, startAdoptStream],
  );

  usePersistedContext<PersistedAdoptContext>({
    key: ADOPT_CONTEXT_KEY,
    maxAge: ADOPT_CONTEXT_MAX_AGE_MS,
    enabled: isOpen,
    validate: useCallback((parsed: PersistedAdoptContext) => parsed?.adoptId || null, []),
    getSavedAt: useCallback((parsed: PersistedAdoptContext) => parsed.savedAt, []),
    onRestore: handleRestoreContext,
  });

  // ── Snapshot callbacks ──

  const handleSnapshotLines = useCallback(
    (lines: string[]) => {
      wizard.transformLines(lines);
      setStreamLines(lines);
    },
    [wizard.transformLines, setStreamLines],
  );

  const handleSnapshotPhase = useCallback(
    (phase: 'running' | 'completed' | 'failed') => {
      wizard.transformPhase(phase);
      setStreamPhase(phase);
    },
    [wizard.transformPhase, setStreamPhase],
  );

  const handleSnapshotDraft = useCallback(
    (draft: N8nPersonaDraft) => {
      try {
        wizard.transformCompleted(normalizeDraft(draft));
        void sendOsNotification('Persona Ready', 'Your persona has been built and is ready for review.');
      } catch (err) {
        clearPersistedContext();
        wizard.transformFailed(
          err instanceof Error
            ? `Draft normalization failed: ${err.message}`
            : 'Draft normalization failed. Please retry adoption.',
        );
      }
      setIsRestoring(false);
      setTemplateAdoptActive(false);
    },
    [wizard.transformCompleted, wizard.transformFailed, setTemplateAdoptActive],
  );

  const handleSnapshotCompletedNoDraft = useCallback(() => {
    setIsRestoring(false);
    setTemplateAdoptActive(false);
    clearPersistedContext();
    wizard.transformFailed('Transform completed but no draft was generated. Please try again.');
  }, [wizard.transformFailed, setTemplateAdoptActive]);

  const handleSnapshotFailed = useCallback(
    (error: string) => {
      setIsRestoring(false);
      setTemplateAdoptActive(false);
      clearPersistedContext();
      wizard.transformFailed(error);
    },
    [wizard.transformFailed, setTemplateAdoptActive],
  );

  const handleSnapshotSessionLost = useCallback(() => {
    setIsRestoring(false);
    setTemplateAdoptActive(false);
    clearPersistedContext();
    wizard.transformFailed('Adoption session lost. The backend may have restarted. Please try again.');
  }, [wizard.transformFailed, setTemplateAdoptActive]);

  const handleSnapshotQuestions = useCallback(
    (questions: unknown[]) => {
      const mapped = questions
        .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object')
        .map((q) => ({
          id: String(q.id ?? ''),
          question: String(q.question ?? ''),
          type: (q.type === 'select' || q.type === 'text' || q.type === 'boolean' ? q.type : 'text') as 'select' | 'text' | 'boolean',
          options: Array.isArray(q.options) ? q.options.map(String) : undefined,
          default: typeof q.default === 'string' ? q.default : undefined,
          context: typeof q.context === 'string' ? q.context : undefined,
          category: typeof q.category === 'string' ? q.category : undefined,
        }));
      // Use awaitingAnswers to transition to tune step and pause the transform
      if (mapped.length > 0) wizard.awaitingAnswers(mapped);
    },
    [wizard.awaitingAnswers],
  );

  useBackgroundSnapshot({
    snapshotId: state.backgroundAdoptId,
    getSnapshot: getTemplateAdoptSnapshot,
    onLines: handleSnapshotLines,
    onPhase: handleSnapshotPhase,
    onDraft: handleSnapshotDraft,
    onCompletedNoDraft: handleSnapshotCompletedNoDraft,
    onFailed: handleSnapshotFailed,
    onSessionLost: handleSnapshotSessionLost,
    onQuestions: handleSnapshotQuestions,
  });

  // ── Async handlers ──

  const startTransform = useCallback(async () => {
    if (transformStartingRef.current || state.transforming || state.confirming) return;
    if (!state.designResult || !state.designResultJson?.trim()) {
      wizard.setError('Template has no design data. Cannot adopt.');
      return;
    }

    transformStartingRef.current = true;

    // Request notification permission early so it's available when transform completes
    requestNotificationPermission();

    const filtered = filterDesignResult(
      state.designResult,
      {
        selectedToolIndices: state.selectedToolIndices,
        selectedTriggerIndices: state.selectedTriggerIndices,
        selectedConnectorNames: state.selectedConnectorNames,
        selectedChannelIndices: state.selectedChannelIndices,
        selectedEventIndices: state.selectedEventIndices,
      },
      state.connectorSwaps,
    );
    filtered.suggested_triggers = applyTriggerConfigs(filtered.suggested_triggers, state.triggerConfigs);
    const substituted = substituteVariables(filtered, state.variableValues);
    const designResultJson = JSON.stringify(substituted);

    const adoptId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const previousDraftJson = state.draft ? stringifyDraft(state.draft) : null;

    try {
      setIsRestoring(false);
      await startAdoptStream(adoptId);
      wizard.transformStarted(adoptId);
      setTemplateAdoptActive(true);

      try {
        const context: PersistedAdoptContext = {
          adoptId,
          templateName: state.templateName,
          designResultJson,
          savedAt: Date.now(),
        };
        window.localStorage.setItem(ADOPT_CONTEXT_KEY, JSON.stringify(context));
      } catch { /* intentional: non-critical — localStorage cleanup */ }

      // Enforce sandbox policy overrides on user-selected preferences
      const enforced = applySandboxOverrides(sandboxPolicy, {
        maxConcurrent: 1,
        requireApproval: state.requireApproval,
        maxBudgetUsd: null,
      });

      const hasAnswers = Object.keys(state.userAnswers).length > 0;
      const userAnswersJson = JSON.stringify({
        ...(hasAnswers ? state.userAnswers : {}),
        _selections: {
          useCases: [...state.selectedUseCaseIds],
          toolCount: state.selectedToolIndices.size,
          triggerCount: state.selectedTriggerIndices.size,
          connectorNames: [...state.selectedConnectorNames],
        },
        _preferences: {
          humanReview: {
            required: enforced.requireApproval,
            autoApprove: state.autoApproveSeverity,
            timeout: state.reviewTimeout,
          },
          memory: {
            enabled: state.memoryEnabled,
            scope: state.memoryScope,
          },
        },
        // Phase A — pass database config so LLM CLI can handle schema design
        _database: {
          mode: state.databaseMode,
          selectedTableNames: state.selectedTableNames,
        },
        // Phase B — pass template adoption_questions as context for LLM to consider
        // The LLM decides which questions to generate; these are provided as hints
        _templateQuestions: state.designResult?.adoption_questions ?? [],
        // Phase C (Area #9) — pass credential mapping so backend knows which credentials to bind
        _credentialMap: state.connectorCredentialMap,
      });

      const connectorSwapsJson =
        Object.keys(state.connectorSwaps).length > 0
          ? JSON.stringify(state.connectorSwaps)
          : null;

      await startTemplateAdoptBackground(
        adoptId,
        state.templateName,
        designResultJson,
        state.adjustmentRequest.trim() || null,
        previousDraftJson,
        userAnswersJson,
        connectorSwapsJson,
      );

      if (state.adjustmentRequest.trim()) wizard.setAdjustment('');
    } catch (err) {
      setTemplateAdoptActive(false);
      clearPersistedContext();
      void resetAdoptStream();
      wizard.transformFailed(err instanceof Error ? err.message : 'Failed to start template adoption.');
    } finally {
      transformStartingRef.current = false;
    }
  }, [state, wizard, startAdoptStream, resetAdoptStream, setTemplateAdoptActive]);

  const cancelTransform = useCallback(async () => {
    try {
      const adoptId = state.backgroundAdoptId || currentAdoptId;
      if (adoptId) {
        try { await cancelTemplateAdopt(adoptId); } catch { /* intentional: non-critical — best-effort cancellation; clean up snapshot */
          void clearTemplateAdoptSnapshot(adoptId).catch(() => {}); }
      }
      clearPersistedContext();
      void resetAdoptStream();
      setIsRestoring(false);
      setTemplateAdoptActive(false);
      wizard.transformCancelled();
    } catch {
      // intentional: non-critical — ensure cancellation completes even if cleanup fails
      setIsRestoring(false);
      setTemplateAdoptActive(false);
      wizard.transformCancelled();
    }
  }, [state.backgroundAdoptId, currentAdoptId, wizard, resetAdoptStream, setTemplateAdoptActive]);

  const continueTransform = useCallback(async () => {
    const adoptId = state.backgroundAdoptId;
    if (!adoptId || state.transforming || state.confirming) return;

    const hasAnswers = Object.keys(state.userAnswers).length > 0;
    const userAnswersJson = hasAnswers ? JSON.stringify(state.userAnswers) : '{}';

    try {
      wizard.transformStarted(adoptId);
      setTemplateAdoptActive(true);
      await continueTemplateAdopt(adoptId, userAnswersJson);
    } catch (err) {
      setTemplateAdoptActive(false);
      wizard.transformFailed(err instanceof Error ? err.message : 'Failed to continue template adoption.');
    }
  }, [state.backgroundAdoptId, state.transforming, state.confirming, state.userAnswers, wizard, setTemplateAdoptActive]);

  const confirmSave = useCallback(async () => {
    if (confirmingRef.current) return;

    // Block adoption when safety scanner found critical findings and user hasn't acknowledged
    if (safetyScan && safetyScan.critical.length > 0 && !state.safetyCriticalOverride) {
      wizard.setError(
        `Safety scan found ${safetyScan.critical.length} critical finding(s): ${safetyScan.critical.map((f) => f.title).join(', ')}. Acknowledge the findings to proceed.`,
      );
      return;
    }

    const payloadJson = state.draft ? stringifyDraft(state.draft) : state.draftJson.trim();
    if (!payloadJson || state.transforming || state.confirming || state.draftJsonError) return;

    // Module-level idempotency guard: survives remounts unlike the ref.
    // Uses backgroundAdoptId (unique per adoption) as the idempotency key.
    const idempotencyKey = state.backgroundAdoptId ?? `anon-${Date.now()}`;
    if (inflight.has(idempotencyKey)) return;
    const autoCleanup = setTimeout(() => inflight.delete(idempotencyKey), INFLIGHT_TIMEOUT_MS);
    inflight.set(idempotencyKey, autoCleanup);

    confirmingRef.current = true;
    try {
      wizard.confirmStarted();

      let parsed: unknown;
      try { parsed = JSON.parse(payloadJson); } catch (parseErr) {
        throw new Error(`Draft JSON is malformed: ${parseErr instanceof Error ? parseErr.message : 'parse error'}`);
      }

      const normalized = normalizeDraftFromUnknown(parsed);
      if (!normalized) {
        throw new Error('Draft JSON is invalid. Please fix draft fields.');
      }

      // Enforce sandbox budget cap on the final draft
      if (sandboxPolicy) {
        const budgetEnforced = applySandboxOverrides(sandboxPolicy, {
          maxConcurrent: 1,
          requireApproval: false,
          maxBudgetUsd: normalized.max_budget_usd,
        });
        normalized.max_budget_usd = budgetEnforced.maxBudgetUsd;
      }

      const response = await confirmTemplateAdoptDraft(stringifyDraft(normalized), reviewTestCaseName);
      wizard.updatePreference('partialEntityErrors', response.entity_errors ?? []);
      await fetchPersonas();
      const personaAvailable = await waitForPersonaInStore(response.persona.id);
      if (personaAvailable) {
        selectPersona(response.persona.id);
      }

      if (response.entity_errors?.length) {
        const failedNames = response.entity_errors.map((e) => `${e.entity_type} "${e.entity_name}"`).join(', ');
        console.warn(`[adopt] Persona created with ${response.entity_errors.length} entity errors: ${failedNames}`);
      }
      wizard.confirmCompleted();

      if (state.backgroundAdoptId) {
        void clearTemplateAdoptSnapshot(state.backgroundAdoptId).catch(() => {});
      }
      clearPersistedContext();
      // Emit tour event so the guided tour can advance
      usePersonaStore.getState().emitTourEvent('tour:template-adopted');
      usePersonaStore.getState().setTourCreatedPersona(response.persona.id);
      onPersonaCreated();
    } catch (err) {
      wizard.confirmFailed(err instanceof Error ? err.message : 'Failed to create persona.');
    } finally {
      confirmingRef.current = false;
      const timer = inflight.get(idempotencyKey);
      if (timer) clearTimeout(timer);
      inflight.delete(idempotencyKey);
    }
  }, [state, wizard, fetchPersonas, selectPersona, onPersonaCreated, reviewTestCaseName, safetyScan]);

  /** Clean up all async state (for close / reset). */
  const cleanupAll = useCallback(async () => {
    const snapshotId = state.backgroundAdoptId || currentAdoptId;
    if (snapshotId) void clearTemplateAdoptSnapshot(snapshotId).catch(() => {});
    clearPersistedContext();
    void resetAdoptStream();
    setTemplateAdoptActive(false);
  }, [state.backgroundAdoptId, currentAdoptId, resetAdoptStream, setTemplateAdoptActive]);

  return {
    currentAdoptId,
    isRestoring,
    startTransform,
    cancelTransform,
    continueTransform,
    confirmSave,
    cleanupAll,
  };
}
