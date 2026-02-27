import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { useBackgroundSnapshot } from '@/hooks/utility/useBackgroundSnapshot';
import { usePersistedContext } from '@/hooks/utility/usePersistedContext';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  AlertCircle,
  Download,
  Check,
  RefreshCw,
  Workflow,
  Wrench,
  ListChecks,
  Plug,
  Sliders,
  Hammer,
  CirclePlus,
} from 'lucide-react';
import {
  startTemplateAdoptBackground,
  getTemplateAdoptSnapshot,
  clearTemplateAdoptSnapshot,
  cancelTemplateAdopt,
  confirmTemplateAdoptDraft,
  continueTemplateAdopt,
} from '@/api/templateAdopt';
import type { N8nPersonaDraft } from '@/api/n8nTransform';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import type { ConnectorReadinessStatus } from '@/lib/types/designTypes';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import { usePersonaStore } from '@/stores/personaStore';
import { useCorrelatedCliStream } from '@/hooks/execution/useCorrelatedCliStream';
import {
  useAdoptReducer,
  ADOPT_STEPS,
  ADOPT_STEP_META,
  ADOPT_CONTEXT_KEY,
  ADOPT_CONTEXT_MAX_AGE_MS,
  type AdoptWizardStep,
  type PersistedAdoptContext,
} from './useAdoptReducer';
import { deriveConnectorReadiness } from './ConnectorReadiness';
import { TransformProgress } from '@/features/shared/components/TransformProgress';
import {
  normalizeDraft,
  normalizeDraftFromUnknown,
  stringifyDraft,
} from '@/features/templates/sub_n8n/n8nTypes';
import { parseJsonSafe } from '@/lib/utils/parseJson';
import {
  getAdoptionRequirements,
  filterDesignResult,
  applyTriggerConfigs,
  substituteVariables,
} from './templateVariables';
import { N8nUseCasesTab } from '@/features/templates/sub_n8n/edit/N8nUseCasesTab';
import { N8nEntitiesTab } from '@/features/templates/sub_n8n/edit/N8nEntitiesTab';
import { DimensionRadial } from './DimensionRadial';
import {
  WizardSidebar,
  ChooseStep,
  deriveRequirementsFromFlows,
  ConnectStep,
  TuneStep,
  CreateStep,
} from './steps';
import type { WizardSidebarStep } from './steps';

interface AdoptionWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  review: PersonaDesignReview | null;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  onPersonaCreated: () => void;
}

// ── Sidebar step config ────────────────────────────────────────────────

const SIDEBAR_STEPS: WizardSidebarStep[] = [
  { key: 'choose',  label: 'Choose',  Icon: ListChecks },
  { key: 'connect', label: 'Connect', Icon: Plug },
  { key: 'tune',    label: 'Tune',    Icon: Sliders },
  { key: 'build',   label: 'Build',   Icon: Hammer },
  { key: 'create',  label: 'Create',  Icon: CirclePlus },
];

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
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);
  const storeCredentials = usePersonaStore((s) => s.credentials);
  const wizard = useAdoptReducer();
  const { state, goBack } = wizard;
  const backdropRef = useRef<HTMLDivElement>(null);
  const confirmingRef = useRef(false);
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

  // ── Restore persisted context on open ──

  const handleRestoreContext = useCallback(
    (parsed: PersistedAdoptContext) => {
      setIsRestoring(true);
      wizard.restoreContext(
        parsed.templateName || '',
        parsed.designResultJson || '',
        parsed.adoptId,
      );
      void startAdoptStream(parsed.adoptId);
    },
    [wizard.restoreContext, startAdoptStream],
  );

  const validateAdoptContext = useCallback(
    (parsed: PersistedAdoptContext) => parsed?.adoptId || null,
    [],
  );

  const getAdoptSavedAt = useCallback(
    (parsed: PersistedAdoptContext) => parsed.savedAt,
    [],
  );

  usePersistedContext<PersistedAdoptContext>({
    key: ADOPT_CONTEXT_KEY,
    maxAge: ADOPT_CONTEXT_MAX_AGE_MS,
    enabled: isOpen,
    validate: validateAdoptContext,
    getSavedAt: getAdoptSavedAt,
    onRestore: handleRestoreContext,
  });

  // ── Initialize when modal opens with a review (skip if restored) ──

  useEffect(() => {
    if (!isOpen || !review) return;
    if (state.backgroundAdoptId) return;

    const designResult = parseJsonSafe<DesignAnalysisResult | null>(review.design_result, null);
    if (!designResult) return;

    wizard.init(
      review.test_case_name,
      review.id,
      designResult,
      review.design_result ?? '',
    );
  }, [isOpen, review, wizard.init, state.backgroundAdoptId]);

  // ── Use case flows (parsed from review) ──

  const useCaseFlows = useMemo<UseCaseFlow[]>(() => {
    if (!review) return [];
    const flows = parseJsonSafe<UseCaseFlow[]>(review.use_case_flows, []);
    if (flows.length > 0) return flows;
    const raw = state.designResult as unknown as Record<string, unknown> | null;
    return raw?.use_case_flows
      ? parseJsonSafe<UseCaseFlow[]>(JSON.stringify(raw.use_case_flows), [])
      : [];
  }, [review, state.designResult]);

  // Pre-select all use case IDs on init
  useEffect(() => {
    if (useCaseFlows.length > 0 && state.selectedUseCaseIds.size === 0 && state.step === 'choose') {
      for (const flow of useCaseFlows) {
        wizard.toggleUseCaseId(flow.id);
      }
    }
  }, [useCaseFlows, state.selectedUseCaseIds.size, state.step, wizard.toggleUseCaseId]);

  // ── Poll for snapshot updates ──

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
        const normalized = normalizeDraft(draft);
        wizard.transformCompleted(normalized);
      } catch {
        wizard.transformCompleted(draft);
      }
      setIsRestoring(false);
      setTemplateAdoptActive(false);
    },
    [wizard.transformCompleted, setTemplateAdoptActive],
  );

  const handleSnapshotCompletedNoDraft = useCallback(() => {
    setIsRestoring(false);
    setTemplateAdoptActive(false);
    try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
    wizard.transformFailed('Transform completed but no draft was generated. Please try again.');
  }, [wizard.transformFailed, setTemplateAdoptActive]);

  const handleSnapshotFailed = useCallback(
    (error: string) => {
      setIsRestoring(false);
      setTemplateAdoptActive(false);
      try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
      wizard.transformFailed(error);
    },
    [wizard.transformFailed, setTemplateAdoptActive],
  );

  const handleSnapshotSessionLost = useCallback(() => {
    setIsRestoring(false);
    setTemplateAdoptActive(false);
    try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
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
        }));

      if (mapped.length > 0) {
        wizard.questionsGenerated(mapped);
      }
    },
    [wizard.questionsGenerated],
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

  // ── Derived data ──

  const readinessStatuses = useMemo<ConnectorReadinessStatus[]>(() => {
    if (!state.designResult?.suggested_connectors) return [];
    const installedNames = new Set(connectorDefinitions.map((c) => c.name));
    const credTypes = new Set(credentials.map((c) => c.service_type));
    return deriveConnectorReadiness(state.designResult.suggested_connectors, installedNames, credTypes);
  }, [state.designResult, connectorDefinitions, credentials]);

  const adoptionRequirements = useMemo(
    () => state.designResult ? getAdoptionRequirements(state.designResult) : [],
    [state.designResult],
  );

  // Derive which connectors are required based on selected use cases
  const requiredConnectors = useMemo(() => {
    if (!state.designResult) return [];
    const allConnectors = state.designResult.suggested_connectors ?? [];

    // If we have flows, derive from selected use cases
    if (useCaseFlows.length > 0 && state.selectedUseCaseIds.size > 0) {
      const { connectorNames } = deriveRequirementsFromFlows(useCaseFlows, state.selectedUseCaseIds);
      return allConnectors
        .filter((c) => connectorNames.has(c.name))
        .map((c) => ({
          name: c.name,
          setup_url: c.setup_url,
          setup_instructions: c.setup_instructions,
          credential_fields: c.credential_fields,
        }));
    }

    // Fallback: use selected connector names
    return allConnectors
      .filter((c) => state.selectedConnectorNames.has(c.name))
      .map((c) => ({
        name: c.name,
        setup_url: c.setup_url,
        setup_instructions: c.setup_instructions,
        credential_fields: c.credential_fields,
      }));
  }, [state.designResult, useCaseFlows, state.selectedUseCaseIds, state.selectedConnectorNames]);

  // Use real-time credential list (updated after inline creation)
  const liveCredentials = storeCredentials.length > 0 ? storeCredentials : credentials;

  // Completed steps for sidebar
  const completedSteps = useMemo<Set<AdoptWizardStep>>(() => {
    const completed = new Set<AdoptWizardStep>();
    const currentIndex = ADOPT_STEP_META[state.step].index;

    // All steps before current are completed
    for (const step of ADOPT_STEPS) {
      if (ADOPT_STEP_META[step].index < currentIndex) {
        completed.add(step);
      }
    }

    // Create is completed if persona was created
    if (state.created) completed.add('create');

    return completed;
  }, [state.step, state.created]);

  // ── Sync selections when transitioning from Choose→Connect ──

  const syncSelectionsFromUseCases = useCallback(() => {
    // Selections from use case flows are derived at transform time
    // via filterDesignResult — no explicit sync needed
  }, []);

  // ── Handlers ──

  const handleStartTransform = useCallback(async () => {
    if (state.transforming || state.confirming) return;
    if (!state.designResult || !state.designResultJson || !state.designResultJson.trim()) {
      wizard.setError('Template has no design data. Cannot adopt.');
      return;
    }

    // 1. Filter by user selections
    const filtered = filterDesignResult(state.designResult, {
      selectedToolIndices: state.selectedToolIndices,
      selectedTriggerIndices: state.selectedTriggerIndices,
      selectedConnectorNames: state.selectedConnectorNames,
      selectedChannelIndices: state.selectedChannelIndices,
      selectedEventIndices: state.selectedEventIndices,
    });

    // 2. Apply trigger configs
    filtered.suggested_triggers = applyTriggerConfigs(filtered.suggested_triggers, state.triggerConfigs);

    // 3. Substitute template variables
    const substituted = substituteVariables(filtered, state.variableValues);

    // 4. Serialize
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
      } catch {
        // localStorage might be full
      }

      const hasAnswers = Object.keys(state.userAnswers).length > 0;
      const userAnswersJson = hasAnswers
        ? JSON.stringify({
            ...state.userAnswers,
            _selections: {
              useCases: [...state.selectedUseCaseIds],
              toolCount: state.selectedToolIndices.size,
              triggerCount: state.selectedTriggerIndices.size,
              connectorNames: [...state.selectedConnectorNames],
            },
          })
        : JSON.stringify({
            _selections: {
              useCases: [...state.selectedUseCaseIds],
              toolCount: state.selectedToolIndices.size,
              triggerCount: state.selectedTriggerIndices.size,
              connectorNames: [...state.selectedConnectorNames],
            },
          });

      await startTemplateAdoptBackground(
        adoptId,
        state.templateName,
        designResultJson,
        state.adjustmentRequest.trim() || null,
        previousDraftJson,
        userAnswersJson,
      );

      if (state.adjustmentRequest.trim()) {
        wizard.setAdjustment('');
      }
    } catch (err) {
      setTemplateAdoptActive(false);
      try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
      void resetAdoptStream();
      wizard.transformFailed(err instanceof Error ? err.message : 'Failed to start template adoption.');
    }
  }, [state, wizard, startAdoptStream, resetAdoptStream, setTemplateAdoptActive]);

  const handleConfirmSave = useCallback(async () => {
    if (confirmingRef.current) return;
    const payloadJson = state.draft ? stringifyDraft(state.draft) : state.draftJson.trim();
    if (!payloadJson || state.transforming || state.confirming || state.draftJsonError) return;

    confirmingRef.current = true;
    wizard.confirmStarted();

    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payloadJson);
      } catch (parseErr) {
        wizard.confirmFailed(`Draft JSON is malformed: ${parseErr instanceof Error ? parseErr.message : 'parse error'}`);
        return;
      }

      const normalized = normalizeDraftFromUnknown(parsed);
      if (!normalized) {
        wizard.confirmFailed('Draft JSON is invalid. Please fix draft fields.');
        return;
      }

      const response = await confirmTemplateAdoptDraft(stringifyDraft(normalized));
      await fetchPersonas();
      selectPersona(response.persona.id);
      wizard.confirmCompleted();

      if (state.backgroundAdoptId) {
        void clearTemplateAdoptSnapshot(state.backgroundAdoptId).catch(() => {});
      }
      try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
      onPersonaCreated();
    } catch (err) {
      wizard.confirmFailed(err instanceof Error ? err.message : 'Failed to create persona.');
    } finally {
      confirmingRef.current = false;
    }
  }, [state, wizard, fetchPersonas, selectPersona, onPersonaCreated]);

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
      wizard.transformCancelled();
    } catch {
      setIsRestoring(false);
      setTemplateAdoptActive(false);
      wizard.transformCancelled();
    }
  }, [state.backgroundAdoptId, currentAdoptId, wizard, resetAdoptStream, setTemplateAdoptActive]);

  const handleContinueTransform = useCallback(async () => {
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

  const handleClose = useCallback(() => {
    if (state.confirming) return;

    if (state.created) {
      const snapshotId = state.backgroundAdoptId || currentAdoptId;
      if (snapshotId) {
        void clearTemplateAdoptSnapshot(snapshotId).catch(() => {});
      }
      try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
      void resetAdoptStream();
      wizard.reset();
    } else if (!state.transforming) {
      const snapshotId = state.backgroundAdoptId || currentAdoptId;
      if (snapshotId) {
        void clearTemplateAdoptSnapshot(snapshotId).catch(() => {});
      }
      try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
      void resetAdoptStream();
      setTemplateAdoptActive(false);
      wizard.reset();
    }

    onClose();
  }, [state, currentAdoptId, wizard, resetAdoptStream, onClose, setTemplateAdoptActive]);

  const updateDraft = useCallback(
    (updater: (current: N8nPersonaDraft) => N8nPersonaDraft) => {
      if (!state.draft) return;
      wizard.draftUpdated(updater(state.draft));
    },
    [state.draft, wizard],
  );

  const handleSkipQuestions = useCallback(() => {
    void handleContinueTransform();
  }, [handleContinueTransform]);

  const handleCredentialCreated = useCallback(() => {
    void fetchCredentials();
  }, [fetchCredentials]);

  // ── Next step handler ──

  const handleNext = useCallback(() => {
    switch (state.step) {
      case 'choose':
        syncSelectionsFromUseCases();
        wizard.goToStep('connect');
        break;
      case 'connect':
        wizard.goToStep('tune');
        break;
      case 'tune':
        if (state.backgroundAdoptId) {
          void handleContinueTransform();
        } else {
          void handleStartTransform();
        }
        break;
      case 'build':
        if (state.draft) wizard.goToStep('create');
        break;
      case 'create':
        void handleConfirmSave();
        break;
    }
  }, [state.step, state.draft, state.backgroundAdoptId, wizard, syncSelectionsFromUseCases, handleContinueTransform, handleStartTransform, handleConfirmSave]);

  // ── Sidebar step click handler ──

  const handleSidebarStepClick = useCallback((step: AdoptWizardStep) => {
    if (state.transforming || state.confirming) return;
    wizard.goToStep(step);
  }, [state.transforming, state.confirming, wizard]);

  // ── Derived (all hooks must be above early return) ──

  const designResult = state.designResult;

  // ── Edit step tabs (Use Cases + Entities) ──

  const earlyTabs = useMemo(() => {
    if (!state.draft) return [];
    return [
      {
        id: 'use-cases',
        label: 'Use Cases',
        Icon: Workflow,
        content: (
          <N8nUseCasesTab
            draft={state.draft}
            adjustmentRequest={state.adjustmentRequest}
            transforming={state.transforming}
            disabled={state.transforming || state.confirming}
            onAdjustmentChange={(text) => wizard.setAdjustment(text)}
            onApplyAdjustment={() => void handleStartTransform()}
          />
        ),
      },
    ];
  }, [state.draft, state.adjustmentRequest, state.transforming, state.confirming, wizard, handleStartTransform]);

  const additionalTabs = useMemo(() => {
    if (!state.draft || !designResult) return [];
    return [
      {
        id: 'entities',
        label: 'Tools & Connectors',
        Icon: Wrench,
        content: (
          <N8nEntitiesTab
            draft={state.draft}
            parsedResult={designResult}
            selectedToolIndices={state.selectedToolIndices}
            selectedTriggerIndices={state.selectedTriggerIndices}
            selectedConnectorNames={state.selectedConnectorNames}
            updateDraft={updateDraft}
          />
        ),
      },
    ];
  }, [state.draft, designResult, state.selectedToolIndices, state.selectedTriggerIndices, state.selectedConnectorNames, updateDraft]);

  // ── Early return (all hooks are above) ──

  if (!isOpen) return null;

  // ── Footer button config ──

  const getNextAction = (): {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    disabled: boolean;
    variant: 'violet' | 'emerald';
    spinning?: boolean;
  } | null => {
    switch (state.step) {
      case 'choose':
        return { label: 'Connect', icon: ArrowRight, disabled: false, variant: 'violet' };
      case 'connect':
        return { label: 'Configure', icon: ArrowRight, disabled: false, variant: 'violet' };
      case 'tune':
        if (state.questionGenerating) {
          return { label: 'Analyzing...', icon: RefreshCw, disabled: true, variant: 'violet', spinning: true };
        }
        if (state.backgroundAdoptId && state.questions) {
          return { label: 'Continue with Answers', icon: ArrowRight, disabled: false, variant: 'violet' };
        }
        return { label: 'Build Persona', icon: Sparkles, disabled: false, variant: 'violet' };
      case 'build':
        return state.transforming
          ? { label: 'Generating...', icon: RefreshCw, disabled: true, variant: 'violet', spinning: true }
          : { label: 'Review Draft', icon: ArrowRight, disabled: !state.draft, variant: 'violet' };
      case 'create':
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

  // ── Back button label ──
  const getBackLabel = () => {
    if (state.step === 'choose') return 'Cancel';
    if (state.step === 'build' && state.transforming) return 'Cancel';
    return 'Back';
  };

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => { if (e.target === backdropRef.current) handleClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Full-screen modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.2 }}
        className="relative w-[95vw] max-w-[1400px] h-[92vh] bg-background border border-primary/15 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-primary/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
              <Download className="w-4.5 h-4.5 text-violet-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground/90">Adopt Template</h2>
              <p className="text-sm text-muted-foreground/90">{state.templateName}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Dimension radial in header */}
            {designResult && (
              <DimensionRadial designResult={designResult} size={28} />
            )}

            <button
              onClick={handleClose}
              disabled={state.confirming}
              className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground/80 hover:text-foreground/95 disabled:opacity-30"
              title={state.transforming ? 'Close (processing continues in background)' : 'Close'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Error banner */}
        {state.error && state.step !== 'build' && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-6 mt-2 flex items-start gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20"
          >
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-400/80 flex-1">{state.error}</p>
            <button
              onClick={() => wizard.clearError()}
              className="text-red-400/50 hover:text-red-400 text-sm"
            >
              Dismiss
            </button>
          </motion.div>
        )}

        {/* Main body: Sidebar + Content */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar navigation */}
          <WizardSidebar
            steps={SIDEBAR_STEPS}
            currentStep={state.step}
            completedSteps={completedSteps}
            onStepClick={handleSidebarStepClick}
            disabled={state.transforming || state.confirming}
          />

          {/* Content area */}
          <div className="flex-1 overflow-y-auto min-h-0 p-6">
            <AnimatePresence mode="wait">
              {/* Step 1: Choose use cases */}
              {state.step === 'choose' && designResult && (
                <motion.div
                  key="choose"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.15 }}
                >
                  <ChooseStep
                    useCaseFlows={useCaseFlows}
                    designResult={designResult}
                    selectedUseCaseIds={state.selectedUseCaseIds}
                    onToggleUseCaseId={wizard.toggleUseCaseId}
                    selectedToolIndices={state.selectedToolIndices}
                    selectedTriggerIndices={state.selectedTriggerIndices}
                    selectedConnectorNames={state.selectedConnectorNames}
                    onToggleTool={wizard.toggleTool}
                    onToggleTrigger={wizard.toggleTrigger}
                    onToggleConnector={wizard.toggleConnector}
                  />
                </motion.div>
              )}

              {/* Step 2: Connect credentials */}
              {state.step === 'connect' && (
                <motion.div
                  key="connect"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.15 }}
                >
                  <ConnectStep
                    requiredConnectors={requiredConnectors}
                    connectorDefinitions={connectorDefinitions}
                    credentials={liveCredentials}
                    connectorCredentialMap={state.connectorCredentialMap}
                    inlineCredentialConnector={state.inlineCredentialConnector}
                    onSetCredential={wizard.setConnectorCredential}
                    onClearCredential={wizard.clearConnectorCredential}
                    onSetInlineConnector={wizard.setInlineCredentialConnector}
                    onCredentialCreated={handleCredentialCreated}
                  />
                </motion.div>
              )}

              {/* Step 3: Tune configuration */}
              {state.step === 'tune' && (
                <motion.div
                  key="tune"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.15 }}
                >
                  <TuneStep
                    designResult={designResult}
                    adoptionRequirements={adoptionRequirements}
                    variableValues={state.variableValues}
                    onUpdateVariable={wizard.updateVariable}
                    selectedTriggerIndices={state.selectedTriggerIndices}
                    triggerConfigs={state.triggerConfigs}
                    onTriggerConfigChange={wizard.updateTriggerConfig}
                    questions={state.questions}
                    userAnswers={state.userAnswers}
                    questionGenerating={state.questionGenerating}
                    onAnswerUpdated={(questionId, answer) =>
                      wizard.answerUpdated(questionId, answer)
                    }
                    onSkipQuestions={handleSkipQuestions}
                  />
                </motion.div>
              )}

              {/* Step 4: Build (transform) */}
              {state.step === 'build' && (
                <motion.div
                  key="build"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-4"
                >
                  <TransformProgress
                    phase={state.transformPhase}
                    lines={state.transformLines}
                    runId={currentAdoptId}
                    isRestoring={isRestoring}
                    onRetry={() => void handleStartTransform()}
                    onCancel={() => void handleCancelTransform()}
                  />

                  {state.transforming && (
                    <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-blue-500/5 border border-blue-500/10">
                      <Sparkles className="w-4 h-4 text-blue-400/60 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-blue-300/60 leading-relaxed">
                        You can close this dialog — processing will continue in the background.
                        Re-open the wizard to check progress.
                      </p>
                    </div>
                  )}

                  {state.draft && !state.transforming && (
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider">
                        Request adjustments (optional)
                      </label>
                      <textarea
                        value={state.adjustmentRequest}
                        onChange={(e) => wizard.setAdjustment(e.target.value)}
                        placeholder="Example: Change the schedule to run at 9 AM, remove ClickUp integration, add Slack notifications"
                        className="w-full h-20 p-3 rounded-xl border border-primary/15 bg-background/40 text-sm text-foreground/75 resize-y placeholder-muted-foreground/30"
                      />
                    </div>
                  )}
                </motion.div>
              )}

              {/* Step 5: Create (confirm + optional edit) */}
              {state.step === 'create' && (
                <motion.div
                  key="create"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.15 }}
                >
                  <CreateStep
                    draft={state.draft}
                    designResult={designResult}
                    readinessStatuses={readinessStatuses}
                    created={state.created}
                    showEditInline={state.showEditInline}
                    confirming={state.confirming}
                    onToggleEditInline={wizard.toggleEditInline}
                    onReset={() => {
                      const snapshotId = state.backgroundAdoptId || currentAdoptId;
                      if (snapshotId) {
                        void clearTemplateAdoptSnapshot(snapshotId).catch(() => {});
                      }
                      try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
                      void resetAdoptStream();
                      setTemplateAdoptActive(false);
                      wizard.reset();
                    }}
                    draftJson={state.draftJson}
                    draftJsonError={state.draftJsonError}
                    adjustmentRequest={state.adjustmentRequest}
                    transforming={state.transforming}
                    updateDraft={updateDraft}
                    onDraftUpdated={(draft) => wizard.draftUpdated(draft)}
                    onJsonEdited={(json, draft, error) =>
                      wizard.draftJsonEdited(json, draft, error)
                    }
                    onAdjustmentChange={(text) => wizard.setAdjustment(text)}
                    onApplyAdjustment={() => void handleStartTransform()}
                    earlyTabs={earlyTabs}
                    additionalTabs={additionalTabs}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-primary/10 bg-secondary/10 flex-shrink-0">
          <button
            onClick={() => {
              if (state.step === 'choose') handleClose();
              else if (state.step === 'tune' && state.questionGenerating) {
                return;
              } else if (state.step === 'build' && state.transforming) {
                void handleCancelTransform();
              } else {
                goBack();
              }
            }}
            disabled={state.confirming || state.created || (state.step === 'tune' && state.questionGenerating)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {getBackLabel()}
          </button>

          <div className="flex items-center gap-2">
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
        </div>
      </motion.div>
    </div>
  );
}
