import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Wrench,
  Zap,
  Plug,
  Bell,
  AlertCircle,
  Download,
  Check,
  RefreshCw,
} from 'lucide-react';
import {
  startTemplateAdoptBackground,
  getTemplateAdoptSnapshot,
  clearTemplateAdoptSnapshot,
  cancelTemplateAdopt,
  confirmTemplateAdoptDraft,
  generateTemplateAdoptQuestions,
} from '@/api/design';
import type { N8nPersonaDraft } from '@/api/design';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import type { ConnectorReadinessStatus } from '@/lib/types/designTypes';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { usePersonaStore } from '@/stores/personaStore';
import { useCorrelatedCliStream } from '@/hooks/execution/useCorrelatedCliStream';
import {
  useAdoptReducer,
  ADOPT_STEP_META,
  ADOPT_CONTEXT_KEY,
  ADOPT_CONTEXT_MAX_AGE_MS,
  type PersistedAdoptContext,
} from './useAdoptReducer';
import { ConnectorReadiness, deriveConnectorReadiness } from './ConnectorReadiness';
import { AdoptConfirmStep } from './AdoptConfirmStep';
import { N8nTransformProgress } from '@/features/templates/sub_n8n/N8nTransformProgress';
import { ConfigureStep } from '@/features/shared/components/ConfigureStep';
import { DraftEditStep } from '@/features/shared/components/draft-editor';
import {
  normalizeDraft,
  normalizeDraftFromUnknown,
  stringifyDraft,
} from '@/features/templates/sub_n8n/n8nTypes';

function parseJsonSafe<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

interface AdoptionWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  review: PersonaDesignReview | null;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  onPersonaCreated: () => void;
}

export default function AdoptionWizardModal({
  isOpen,
  onClose,
  review,
  credentials,
  connectorDefinitions,
  onPersonaCreated,
}: AdoptionWizardModalProps) {
  const fetchPersonas = usePersonaStore((s) => s.fetchPersonas);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const setTemplateAdoptActive = usePersonaStore((s) => s.setTemplateAdoptActive);
  const { state, dispatch, goBack } = useAdoptReducer();
  const backdropRef = useRef<HTMLDivElement>(null);
  const pollTimerRef = useRef<number | null>(null);
  const hasRestoredRef = useRef(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // Reset restoration guard on unmount so next open can restore
  useEffect(() => {
    return () => { hasRestoredRef.current = false; };
  }, []);

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
    lineField: 'line',
    statusField: 'status',
    errorField: 'error',
    onFailed: (message) => dispatch({ type: 'TRANSFORM_FAILED', error: message }),
  });

  // ── Restore persisted context on open ──

  useEffect(() => {
    if (!isOpen) return;
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;

    const raw = window.localStorage.getItem(ADOPT_CONTEXT_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as PersistedAdoptContext;
      if (!parsed?.adoptId) {
        window.localStorage.removeItem(ADOPT_CONTEXT_KEY);
        return;
      }

      // Discard stale contexts (older than 10 minutes)
      if (parsed.savedAt && Date.now() - parsed.savedAt > ADOPT_CONTEXT_MAX_AGE_MS) {
        window.localStorage.removeItem(ADOPT_CONTEXT_KEY);
        return;
      }

      setIsRestoring(true);
      dispatch({
        type: 'RESTORE_CONTEXT',
        adoptId: parsed.adoptId,
        templateName: parsed.templateName || '',
        designResultJson: parsed.designResultJson || '',
      });

      void startAdoptStream(parsed.adoptId);
    } catch {
      window.localStorage.removeItem(ADOPT_CONTEXT_KEY);
    }
  }, [isOpen, startAdoptStream, dispatch]);

  // ── Initialize when modal opens with a review (skip if restored) ──

  useEffect(() => {
    if (!isOpen || !review) return;
    // Don't overwrite restored state
    if (state.backgroundAdoptId) return;

    const designResult = parseJsonSafe<DesignAnalysisResult | null>(review.design_result, null);
    if (!designResult) return;

    dispatch({
      type: 'INIT',
      templateName: review.test_case_name,
      reviewId: review.id,
      designResult,
      designResultJson: review.design_result ?? '',
    });
  }, [isOpen, review, dispatch, state.backgroundAdoptId]);

  // ── Poll for snapshot updates ──

  const notFoundCountRef = useRef(0);

  useEffect(() => {
    if (!state.backgroundAdoptId) return;

    notFoundCountRef.current = 0;

    const syncSnapshot = async () => {
      try {
        const snapshot = await getTemplateAdoptSnapshot(state.backgroundAdoptId!);
        notFoundCountRef.current = 0;

        const lines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
        dispatch({ type: 'TRANSFORM_LINES', lines });
        setStreamLines(lines);

        if (snapshot.status === 'running' || snapshot.status === 'completed' || snapshot.status === 'failed') {
          dispatch({ type: 'TRANSFORM_PHASE', phase: snapshot.status });
          setStreamPhase(snapshot.status);
        }

        if (snapshot.draft) {
          try {
            const normalized = normalizeDraft(snapshot.draft as N8nPersonaDraft);
            dispatch({ type: 'TRANSFORM_COMPLETED', draft: normalized });
          } catch {
            dispatch({ type: 'TRANSFORM_COMPLETED', draft: snapshot.draft as N8nPersonaDraft });
          }
          setIsRestoring(false);
          setTemplateAdoptActive(false);
        } else if (snapshot.status === 'completed') {
          // Status completed but no draft
          setIsRestoring(false);
          setTemplateAdoptActive(false);
          try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
          dispatch({
            type: 'TRANSFORM_FAILED',
            error: 'Transform completed but no draft was generated. Please try again.',
          });
        }

        if (snapshot.status === 'failed') {
          setIsRestoring(false);
          setTemplateAdoptActive(false);
          try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
          dispatch({
            type: 'TRANSFORM_FAILED',
            error: snapshot.error || 'Template adoption failed.',
          });
        }

        // Stop polling once we reach a terminal state
        if (snapshot.status === 'completed' || snapshot.status === 'failed') {
          if (pollTimerRef.current !== null) {
            window.clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
          return;
        }
      } catch {
        notFoundCountRef.current += 1;
        if (notFoundCountRef.current >= 3) {
          setIsRestoring(false);
          setTemplateAdoptActive(false);
          try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
          dispatch({
            type: 'TRANSFORM_FAILED',
            error: 'Adoption session lost. The backend may have restarted. Please try again.',
          });
        }
      }
    };

    void syncSnapshot();

    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    pollTimerRef.current = window.setInterval(() => {
      void syncSnapshot();
    }, 1500);

    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [state.backgroundAdoptId, dispatch, setStreamLines, setStreamPhase, setTemplateAdoptActive]);

  // Cleanup poll timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  // ── Derived data ──

  const readinessStatuses = useMemo<ConnectorReadinessStatus[]>(() => {
    if (!state.designResult?.suggested_connectors) return [];
    const installedNames = new Set(connectorDefinitions.map((c) => c.name));
    const credTypes = new Set(credentials.map((c) => c.service_type));
    return deriveConnectorReadiness(state.designResult.suggested_connectors, installedNames, credTypes);
  }, [state.designResult, connectorDefinitions, credentials]);

  // ── Handlers ──

  const handleStartTransform = useCallback(async () => {
    if (state.transforming || state.confirming) return;
    if (!state.designResultJson || !state.designResultJson.trim()) {
      dispatch({ type: 'SET_ERROR', error: 'Template has no design data. Cannot adopt.' });
      return;
    }

    const adoptId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const previousDraftJson = state.draft ? stringifyDraft(state.draft) : null;

    try {
      setIsRestoring(false);
      await startAdoptStream(adoptId);
      dispatch({ type: 'TRANSFORM_STARTED', adoptId });
      setTemplateAdoptActive(true);

      // Persist context for session recovery with savedAt timestamp
      try {
        const context: PersistedAdoptContext = {
          adoptId,
          templateName: state.templateName,
          designResultJson: state.designResultJson,
          savedAt: Date.now(),
        };
        window.localStorage.setItem(ADOPT_CONTEXT_KEY, JSON.stringify(context));
      } catch {
        // localStorage might be full — continue without persistence
      }

      // Serialize user answers if any were provided
      const hasAnswers = Object.keys(state.userAnswers).length > 0;
      const userAnswersJson = hasAnswers ? JSON.stringify(state.userAnswers) : null;

      // Call the backend API — this registers the job before returning
      await startTemplateAdoptBackground(
        adoptId,
        state.templateName,
        state.designResultJson,
        state.adjustmentRequest.trim() || null,
        previousDraftJson,
        userAnswersJson,
      );

      if (state.adjustmentRequest.trim()) {
        dispatch({ type: 'SET_ADJUSTMENT', text: '' });
      }
    } catch (err) {
      // Clean up on failure
      setTemplateAdoptActive(false);
      try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
      void resetAdoptStream();
      dispatch({
        type: 'TRANSFORM_FAILED',
        error: err instanceof Error ? err.message : 'Failed to start template adoption.',
      });
    }
  }, [state, dispatch, startAdoptStream, resetAdoptStream, setTemplateAdoptActive]);

  const handleConfirmSave = useCallback(async () => {
    const payloadJson = state.draft ? stringifyDraft(state.draft) : state.draftJson.trim();
    if (!payloadJson || state.transforming || state.confirming || state.draftJsonError) return;

    dispatch({ type: 'CONFIRM_STARTED' });

    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payloadJson);
      } catch (parseErr) {
        dispatch({ type: 'CONFIRM_FAILED', error: `Draft JSON is malformed: ${parseErr instanceof Error ? parseErr.message : 'parse error'}` });
        return;
      }

      const normalized = normalizeDraftFromUnknown(parsed);
      if (!normalized) {
        dispatch({ type: 'CONFIRM_FAILED', error: 'Draft JSON is invalid. Please fix draft fields.' });
        return;
      }

      const response = await confirmTemplateAdoptDraft(stringifyDraft(normalized));
      await fetchPersonas();
      selectPersona(response.persona.id);
      dispatch({ type: 'CONFIRM_COMPLETED' });

      if (state.backgroundAdoptId) {
        void clearTemplateAdoptSnapshot(state.backgroundAdoptId).catch(() => {});
      }
      try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
      onPersonaCreated();
    } catch (err) {
      dispatch({
        type: 'CONFIRM_FAILED',
        error: err instanceof Error ? err.message : 'Failed to create persona.',
      });
    }
  }, [state, dispatch, fetchPersonas, selectPersona, onPersonaCreated]);

  const handleCancelTransform = useCallback(async () => {
    try {
      const adoptId = state.backgroundAdoptId || currentAdoptId;
      if (adoptId) {
        try {
          await cancelTemplateAdopt(adoptId);
        } catch {
          void clearTemplateAdoptSnapshot(adoptId).catch(() => {});
        }
      }
      try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
      void resetAdoptStream();
      setIsRestoring(false);
      setTemplateAdoptActive(false);
      dispatch({ type: 'TRANSFORM_CANCELLED' });
    } catch {
      // Ensure we always reset UI state even if cancel fails
      setIsRestoring(false);
      setTemplateAdoptActive(false);
      dispatch({ type: 'TRANSFORM_CANCELLED' });
    }
  }, [state.backgroundAdoptId, currentAdoptId, dispatch, resetAdoptStream, setTemplateAdoptActive]);

  // ── Question generation ──

  const handleGenerateQuestions = useCallback(async () => {
    if (!state.designResultJson || state.questionGenerating) return;
    dispatch({ type: 'QUESTIONS_GENERATING' });
    try {
      const questions = await generateTemplateAdoptQuestions(
        state.templateName,
        state.designResultJson,
      );
      dispatch({ type: 'QUESTIONS_GENERATED', questions: Array.isArray(questions) ? questions : [] });
    } catch (err) {
      dispatch({
        type: 'QUESTIONS_FAILED',
        error: err instanceof Error ? err.message : 'Failed to generate questions.',
      });
    }
  }, [state.designResultJson, state.templateName, state.questionGenerating, dispatch]);

  // Close = hide modal. Does NOT cancel background work.
  const handleClose = useCallback(() => {
    if (state.confirming) return;

    // If persona was created, clean up fully
    if (state.created) {
      const snapshotId = state.backgroundAdoptId || currentAdoptId;
      if (snapshotId) {
        void clearTemplateAdoptSnapshot(snapshotId).catch(() => {});
      }
      try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
      void resetAdoptStream();
      dispatch({ type: 'RESET' });
    }
    // If not transforming, it's safe to fully reset (no background work to preserve)
    else if (!state.transforming) {
      const snapshotId = state.backgroundAdoptId || currentAdoptId;
      if (snapshotId) {
        void clearTemplateAdoptSnapshot(snapshotId).catch(() => {});
      }
      try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
      void resetAdoptStream();
      setTemplateAdoptActive(false);
      dispatch({ type: 'RESET' });
    }
    // If transforming: just hide the modal. Background work continues.
    // localStorage and snapshot remain for session recovery.

    onClose();
  }, [state, currentAdoptId, dispatch, resetAdoptStream, onClose, setTemplateAdoptActive]);

  // Draft update helper for DraftEditStep
  const updateDraft = useCallback(
    (updater: (current: N8nPersonaDraft) => N8nPersonaDraft) => {
      if (!state.draft) return;
      dispatch({ type: 'DRAFT_UPDATED', draft: updater(state.draft) });
    },
    [state.draft, dispatch],
  );

  // ── Next step handler ──

  const handleSkipQuestions = useCallback(() => {
    // Skip configure and go straight to transform
    void handleStartTransform();
  }, [handleStartTransform]);

  const handleNext = useCallback(() => {
    switch (state.step) {
      case 'overview':
        void handleGenerateQuestions();
        break;
      case 'configure':
        void handleStartTransform();
        break;
      case 'transform':
        if (state.draft) dispatch({ type: 'GO_TO_STEP', step: 'edit' });
        break;
      case 'edit':
        dispatch({ type: 'GO_TO_STEP', step: 'confirm' });
        break;
      case 'confirm':
        void handleConfirmSave();
        break;
    }
  }, [state.step, state.draft, dispatch, handleGenerateQuestions, handleStartTransform, handleConfirmSave]);

  if (!isOpen) return null;

  const designResult = state.designResult;
  const toolCount = designResult?.suggested_tools?.length ?? 0;
  const triggerCount = designResult?.suggested_triggers?.length ?? 0;
  const connectorCount = designResult?.suggested_connectors?.length ?? 0;
  const channelCount = designResult?.suggested_notification_channels?.length ?? 0;
  const stepIndex = ADOPT_STEP_META[state.step].index;

  // ── Footer button config (data-driven like N8nWizardFooter) ──

  const getNextAction = (): {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    disabled: boolean;
    variant: 'violet' | 'emerald';
    spinning?: boolean;
  } | null => {
    switch (state.step) {
      case 'overview':
        return {
          label: 'Customize with AI',
          icon: Sparkles,
          disabled: state.transforming || state.questionGenerating,
          variant: 'violet',
        };
      case 'configure':
        return state.questionGenerating
          ? { label: 'Analyzing...', icon: RefreshCw, disabled: true, variant: 'violet', spinning: true }
          : { label: 'Start Transform', icon: ArrowRight, disabled: false, variant: 'violet' };
      case 'transform':
        return state.transforming
          ? { label: 'Generating...', icon: RefreshCw, disabled: true, variant: 'violet', spinning: true }
          : { label: 'Review Draft', icon: ArrowRight, disabled: !state.draft, variant: 'violet' };
      case 'edit':
        return {
          label: 'Review & Confirm',
          icon: ArrowRight,
          disabled: !!state.draftJsonError || !state.draft,
          variant: 'violet',
        };
      case 'confirm':
        if (state.created) {
          return { label: 'Done', icon: Check, disabled: false, variant: 'emerald' };
        }
        return state.confirming
          ? { label: 'Creating...', icon: RefreshCw, disabled: true, variant: 'emerald', spinning: true }
          : { label: 'Create Persona', icon: Sparkles, disabled: !state.draft, variant: 'emerald' };
      default:
        return null;
    }
  };

  const nextAction = getNextAction();

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => { if (e.target === backdropRef.current) handleClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.2 }}
        className="relative w-full max-w-2xl bg-background border border-primary/15 rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
              <Download className="w-4.5 h-4.5 text-violet-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground/90">Adopt Template</h2>
              <p className="text-xs text-muted-foreground/50">{state.templateName}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={state.confirming}
            className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground/40 hover:text-foreground/60 disabled:opacity-30"
            title={state.transforming ? 'Close (processing continues in background)' : 'Close'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-6 pt-4 pb-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex-1">
                <div
                  className={`h-1 rounded-full transition-colors ${
                    i < stepIndex
                      ? 'bg-emerald-500/50'
                      : i === stepIndex
                        ? 'bg-violet-500/50'
                        : 'bg-primary/10'
                  }`}
                />
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground/40 mt-2">
            Step {stepIndex + 1} of 5 — {ADOPT_STEP_META[state.step].label}
          </p>
        </div>

        {/* Error banner */}
        {state.error && state.step !== 'transform' && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-6 mb-2 flex items-start gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20"
          >
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-400/80 flex-1">{state.error}</p>
            <button
              onClick={() => dispatch({ type: 'CLEAR_ERROR' })}
              className="text-red-400/50 hover:text-red-400 text-xs"
            >
              Dismiss
            </button>
          </motion.div>
        )}

        {/* Content */}
        <div className="px-6 py-4 flex-1 overflow-y-auto min-h-0">
          <AnimatePresence mode="wait">
            {/* Step 1: Overview */}
            {state.step === 'overview' && designResult && (
              <motion.div
                key="overview"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.15 }}
                className="space-y-4"
              >
                <div>
                  <h3 className="text-sm font-medium text-foreground/80 mb-1">Template Summary</h3>
                  <p className="text-xs text-muted-foreground/50 leading-relaxed">
                    {designResult.summary || review?.instruction}
                  </p>
                </div>

                {/* Stat pills */}
                <div className="flex flex-wrap gap-2">
                  {connectorCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/15">
                      <Plug className="w-3.5 h-3.5" />
                      {connectorCount} Connector{connectorCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {toolCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary/10 text-foreground/60 border border-primary/15">
                      <Wrench className="w-3.5 h-3.5" />
                      {toolCount} Tool{toolCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {triggerCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/15">
                      <Zap className="w-3.5 h-3.5" />
                      {triggerCount} Trigger{triggerCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {channelCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/15">
                      <Bell className="w-3.5 h-3.5" />
                      {channelCount} Channel{channelCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {/* Connector readiness */}
                {readinessStatuses.length > 0 && (
                  <div className="pt-2 border-t border-primary/[0.08]">
                    <ConnectorReadiness statuses={readinessStatuses} compact={false} />
                  </div>
                )}

                {/* Info note */}
                <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-violet-500/5 border border-violet-500/10">
                  <Sparkles className="w-4 h-4 text-violet-400/60 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-violet-300/60 leading-relaxed">
                    Claude will analyze this template and generate a persona draft tailored to its design.
                    You can review and customize the draft before creating the persona.
                  </p>
                </div>
              </motion.div>
            )}

            {/* Step 2: Configure (pre-transform questions) */}
            {state.step === 'configure' && (
              <motion.div
                key="configure"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.15 }}
              >
                <ConfigureStep
                  questions={state.questions}
                  userAnswers={state.userAnswers}
                  questionGenerating={state.questionGenerating}
                  onAnswerUpdated={(questionId, answer) =>
                    dispatch({ type: 'ANSWER_UPDATED', questionId, answer })
                  }
                  onSkip={handleSkipQuestions}
                  loadingText="Analyzing template requirements..."
                />
              </motion.div>
            )}

            {/* Step 3: Transform */}
            {state.step === 'transform' && (
              <motion.div
                key="transform"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.15 }}
                className="space-y-4"
              >
                <N8nTransformProgress
                  phase={state.transformPhase}
                  lines={state.transformLines}
                  runId={currentAdoptId}
                  isRestoring={isRestoring}
                  onRetry={() => void handleStartTransform()}
                  onCancel={() => void handleCancelTransform()}
                />

                {/* Background hint when transforming */}
                {state.transforming && (
                  <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-blue-500/5 border border-blue-500/10">
                    <Sparkles className="w-4 h-4 text-blue-400/60 flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] text-blue-300/60 leading-relaxed">
                      You can close this dialog — processing will continue in the background.
                      Re-open the wizard to check progress.
                    </p>
                  </div>
                )}

                {/* Adjustment request for re-runs */}
                {state.draft && !state.transforming && (
                  <div className="space-y-2">
                    <label className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                      Request adjustments (optional)
                    </label>
                    <textarea
                      value={state.adjustmentRequest}
                      onChange={(e) => dispatch({ type: 'SET_ADJUSTMENT', text: e.target.value })}
                      placeholder="Example: Change the schedule to run at 9 AM, remove ClickUp integration, add Slack notifications"
                      className="w-full h-20 p-3 rounded-xl border border-primary/15 bg-background/40 text-xs text-foreground/75 resize-y placeholder-muted-foreground/30"
                    />
                  </div>
                )}
              </motion.div>
            )}

            {/* Step 4: Edit — DraftEditStep (shared tabbed editor) */}
            {state.step === 'edit' && state.draft && (
              <motion.div
                key="edit"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.15 }}
                className="min-h-[400px]"
              >
                <DraftEditStep
                  draft={state.draft}
                  draftJson={state.draftJson}
                  draftJsonError={state.draftJsonError}
                  adjustmentRequest={state.adjustmentRequest}
                  transforming={state.transforming}
                  disabled={state.transforming || state.confirming}
                  updateDraft={updateDraft}
                  onDraftUpdated={(draft) => dispatch({ type: 'DRAFT_UPDATED', draft })}
                  onJsonEdited={(json, draft, error) =>
                    dispatch({ type: 'DRAFT_JSON_EDITED', json, draft, error })
                  }
                  onAdjustmentChange={(text) => dispatch({ type: 'SET_ADJUSTMENT', text })}
                  onApplyAdjustment={() => void handleStartTransform()}
                />
              </motion.div>
            )}

            {/* Step 5: Confirm — AdoptConfirmStep (rich preview) */}
            {state.step === 'confirm' && state.draft && (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.15 }}
              >
                <AdoptConfirmStep
                  draft={state.draft}
                  designResult={state.designResult}
                  readinessStatuses={readinessStatuses}
                  created={state.created}
                  onReset={() => {
                    const snapshotId = state.backgroundAdoptId || currentAdoptId;
                    if (snapshotId) {
                      void clearTemplateAdoptSnapshot(snapshotId).catch(() => {});
                    }
                    try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
                    void resetAdoptStream();
                    setTemplateAdoptActive(false);
                    dispatch({ type: 'RESET' });
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer (data-driven) */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-primary/10 bg-secondary/10 flex-shrink-0">
          <button
            onClick={() => {
              if (state.step === 'overview') handleClose();
              else if (state.step === 'configure' && state.questionGenerating) {
                // Can't go back while generating questions — user can skip instead
                return;
              } else if (state.step === 'transform' && state.transforming) {
                void handleCancelTransform();
              } else {
                goBack();
              }
            }}
            disabled={state.confirming || state.created || (state.step === 'configure' && state.questionGenerating)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-xl border border-primary/15 text-muted-foreground/60 hover:bg-secondary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {state.step === 'overview'
              ? 'Cancel'
              : state.step === 'transform' && state.transforming
                ? 'Cancel'
                : 'Back'}
          </button>

          {nextAction && (
            <button
              onClick={() => {
                if (state.created) handleClose();
                else handleNext();
              }}
              disabled={nextAction.disabled}
              className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                nextAction.variant === 'emerald'
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25 hover:bg-emerald-500/25'
                  : 'bg-violet-500/15 text-violet-300 border-violet-500/25 hover:bg-violet-500/25'
              }`}
            >
              <nextAction.icon
                className={`w-4 h-4 ${nextAction.spinning ? 'animate-spin' : ''}`}
              />
              {nextAction.label}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
