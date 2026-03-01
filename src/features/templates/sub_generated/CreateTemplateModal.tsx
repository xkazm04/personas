import { useCallback, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ArrowLeft,
  ArrowRight,
  Sparkles,
  RefreshCw,
  Check,
  Wand2,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import type { N8nPersonaDraft } from '@/api/n8nTransform';
import {
  generateTemplateBackground,
  getTemplateGenerateSnapshot,
  clearTemplateGenerateSnapshot,
  cancelTemplateGenerate,
  saveCustomTemplate,
} from '@/api/templateAdopt';
import { TransformProgress } from '@/features/shared/components/TransformProgress';
import { DraftEditStep } from '@/features/shared/components/draft-editor/DraftEditStep';
import { normalizeDraftFromUnknown } from '@/features/templates/sub_n8n/n8nTypes';
import { useBackgroundSnapshot } from '@/hooks/utility/useBackgroundSnapshot';
import { usePersistedContext } from '@/hooks/utility/usePersistedContext';
import {
  useCreateTemplateReducer,
  CREATE_TEMPLATE_CONTEXT_KEY,
  CREATE_TEMPLATE_CONTEXT_MAX_AGE_MS,
  CREATE_TEMPLATE_STEPS,
  CREATE_TEMPLATE_STEP_META,
} from './useCreateTemplateReducer';
import type { PersistedCreateTemplateContext } from './useCreateTemplateReducer';
import { WizardStepper } from '@/features/shared/components/WizardStepper';

// ── Helpers ──

function persistContext(ctx: PersistedCreateTemplateContext) {
  window.localStorage.setItem(CREATE_TEMPLATE_CONTEXT_KEY, JSON.stringify(ctx));
}

function clearPersistedContext() {
  window.localStorage.removeItem(CREATE_TEMPLATE_CONTEXT_KEY);
}

// ── Props ──

interface CreateTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTemplateCreated: () => void;
}

// ── Component ──

export function CreateTemplateModal({
  isOpen,
  onClose,
  onTemplateCreated,
}: CreateTemplateModalProps) {
  const reducer = useCreateTemplateReducer();
  const { state } = reducer;
  const genIdRef = useRef<string | null>(null);

  // ── Persisted context (restore on open) ──
  usePersistedContext<PersistedCreateTemplateContext>({
    key: CREATE_TEMPLATE_CONTEXT_KEY,
    maxAge: CREATE_TEMPLATE_CONTEXT_MAX_AGE_MS,
    enabled: isOpen,
    validate: (parsed) => parsed.genId || null,
    getSavedAt: (parsed) => parsed.savedAt,
    onRestore: useCallback((ctx: PersistedCreateTemplateContext) => {
      genIdRef.current = ctx.genId;
      reducer.restoreContext(ctx.templateName, ctx.description, ctx.genId);
    }, [reducer]),
  });

  // ── Background snapshot polling ──
  const snapshotGetFn = useCallback(async (id: string) => {
    const snap = await getTemplateGenerateSnapshot(id);
    let draft: N8nPersonaDraft | null = null;
    if (snap.status === 'completed' && snap.result_json) {
      try {
        const parsed = JSON.parse(snap.result_json);
        draft = normalizeDraftFromUnknown(parsed?.persona ?? parsed);
      } catch { /* parse error handled below */ }
    }
    return {
      status: snap.status as 'idle' | 'running' | 'completed' | 'failed',
      error: snap.error,
      lines: snap.lines,
      draft,
    };
  }, []);

  const onSnapshotLines = useCallback((lines: string[]) => {
    reducer.generateLines(lines);
  }, [reducer]);

  const onSnapshotPhase = useCallback((phase: 'running' | 'completed' | 'failed') => {
    reducer.generatePhase(phase);
  }, [reducer]);

  const onSnapshotDraft = useCallback((draft: N8nPersonaDraft) => {
    reducer.generateCompleted(draft, '');
    clearPersistedContext();
  }, [reducer]);

  const onSnapshotCompletedNoDraft = useCallback(async () => {
    if (genIdRef.current) {
      try {
        const snap = await getTemplateGenerateSnapshot(genIdRef.current);
        if (snap.result_json) {
          const parsed = JSON.parse(snap.result_json);
          const draft = normalizeDraftFromUnknown(parsed?.persona ?? parsed);
          if (draft) {
            reducer.generateCompleted(draft, snap.result_json);
            clearPersistedContext();
            return;
          }
        }
      } catch { /* fall through */ }
    }
    reducer.generateFailed('Generation completed but no valid persona draft was found.');
    clearPersistedContext();
  }, [reducer]);

  const onSnapshotFailed = useCallback((error: string) => {
    reducer.generateFailed(error);
    clearPersistedContext();
  }, [reducer]);

  const onSnapshotSessionLost = useCallback(() => {
    reducer.generateFailed('Lost connection to background generation job.');
    clearPersistedContext();
  }, [reducer]);

  useBackgroundSnapshot({
    snapshotId: state.backgroundGenId,
    getSnapshot: snapshotGetFn,
    onLines: onSnapshotLines,
    onPhase: onSnapshotPhase,
    onDraft: onSnapshotDraft,
    onCompletedNoDraft: onSnapshotCompletedNoDraft,
    onFailed: onSnapshotFailed,
    onSessionLost: onSnapshotSessionLost,
    interval: 1500,
  });

  // ── Event listeners for streaming lines ──
  useEffect(() => {
    if (!state.backgroundGenId) return;
    const currentGenId = state.backgroundGenId;

    const unlistenPromise = listen<{ gen_id: string; line: string }>(
      'template-generate-output',
      (event) => {
        if (event.payload.gen_id === currentGenId) {
          reducer.generateLines([...state.generateLines, event.payload.line]);
        }
      },
    );

    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [state.backgroundGenId]);

  // ── Actions ──

  const handleStartGenerate = useCallback(async () => {
    if (!state.templateName.trim() || !state.description.trim()) return;

    const genId = `tpl-gen-${Date.now()}`;
    genIdRef.current = genId;
    reducer.generateStarted(genId);

    persistContext({
      genId,
      templateName: state.templateName,
      description: state.description,
      savedAt: Date.now(),
    });

    try {
      await generateTemplateBackground(genId, state.templateName.trim(), state.description.trim());
    } catch (err) {
      reducer.generateFailed(err instanceof Error ? err.message : String(err));
      clearPersistedContext();
    }
  }, [state.templateName, state.description, reducer]);

  const handleCancel = useCallback(async () => {
    if (state.backgroundGenId) {
      try {
        await cancelTemplateGenerate(state.backgroundGenId);
      } catch { /* ignore */ }
    }
    reducer.generateCancelled();
    clearPersistedContext();
  }, [state.backgroundGenId, reducer]);

  const handleRetry = useCallback(() => {
    reducer.generateCancelled();
    clearPersistedContext();
    setTimeout(() => {
      void handleStartGenerate();
    }, 100);
  }, [reducer, handleStartGenerate]);

  const handleSaveTemplate = useCallback(async () => {
    if (!state.draft) return;
    reducer.saveStarted();

    try {
      const designResultJson = state.designResultJson || JSON.stringify({
        structured_prompt: state.draft.structured_prompt,
        full_prompt_markdown: state.draft.system_prompt,
        summary: state.draft.description || '',
        persona_meta: {
          name: state.draft.name,
          icon: state.draft.icon,
          color: state.draft.color,
          model_profile: state.draft.model_profile,
        },
      });

      await saveCustomTemplate(
        state.templateName || state.draft.name || 'Custom Template',
        state.description,
        designResultJson,
      );

      reducer.saveCompleted();
      clearPersistedContext();

      if (genIdRef.current) {
        try {
          await clearTemplateGenerateSnapshot(genIdRef.current);
        } catch { /* ignore */ }
      }

      onTemplateCreated();
    } catch (err) {
      reducer.saveFailed(err instanceof Error ? err.message : String(err));
    }
  }, [state.draft, state.designResultJson, state.templateName, state.description, reducer, onTemplateCreated]);

  // ── Draft update helpers ──

  const updateDraft = useCallback((updater: (current: N8nPersonaDraft) => N8nPersonaDraft) => {
    if (!state.draft) return;
    const updated = updater(state.draft);
    reducer.draftUpdated(updated);
  }, [state.draft, reducer]);

  const handleApplyAdjustment = useCallback(async () => {
    if (!state.adjustmentRequest.trim() || !state.draft) return;

    const genId = `tpl-gen-${Date.now()}`;
    genIdRef.current = genId;

    const enrichedDescription = `${state.description}\n\nAdditional requirements: ${state.adjustmentRequest}`;

    reducer.generateStarted(genId);
    persistContext({
      genId,
      templateName: state.templateName,
      description: enrichedDescription,
      savedAt: Date.now(),
    });

    try {
      await generateTemplateBackground(genId, state.templateName.trim(), enrichedDescription);
    } catch (err) {
      reducer.generateFailed(err instanceof Error ? err.message : String(err));
      clearPersistedContext();
    }
  }, [state.adjustmentRequest, state.draft, state.description, state.templateName, reducer]);

  // ── Close handler ──
  const handleClose = useCallback(() => {
    if (state.generating) {
      onClose();
      return;
    }
    if (!state.saved) {
      clearPersistedContext();
    }
    reducer.reset();
    onClose();
  }, [state.generating, state.saved, reducer, onClose]);

  // ── Navigation ──
  const canGoBack = state.step !== 'describe' && !state.generating && !state.saving;

  const handleBack = useCallback(() => {
    if (!canGoBack) return;
    if (state.step === 'review') reducer.goToStep('describe');
    else if (state.step === 'generate' && !state.generating) reducer.goToStep('describe');
  }, [canGoBack, state.step, state.generating, reducer]);

  // ── Step indicator ──
  const createWizardSteps = useMemo(
    () => CREATE_TEMPLATE_STEPS.map((s) => ({ key: s, label: CREATE_TEMPLATE_STEP_META[s].label })),
    [],
  );
  const createStepIndex = CREATE_TEMPLATE_STEP_META[state.step].index;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-3xl max-h-[85vh] bg-background border border-primary/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
              <Wand2 className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground/80">Create Template</h2>
              <p className="text-sm text-muted-foreground/80">Design a reusable persona template with AI</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <WizardStepper steps={createWizardSteps} currentIndex={createStepIndex} />
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg hover:bg-secondary/60 transition-colors"
            >
              <X className="w-4 h-4 text-muted-foreground/90" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <AnimatePresence mode="wait">
            {/* ── Step 1: Describe ── */}
            {state.step === 'describe' && (
              <motion.div
                key="describe"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
                className="p-6 space-y-5"
              >
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider">
                    Template Name
                  </label>
                  <input
                    type="text"
                    value={state.templateName}
                    onChange={(e) => reducer.setTemplateName(e.target.value)}
                    placeholder="e.g., Email Manager, Code Reviewer, Daily Reporter..."
                    className="w-full px-4 py-3 rounded-xl border border-primary/15 bg-background/40 text-sm text-foreground/75 placeholder-muted-foreground/30 focus:outline-none focus:border-violet-500/40 transition-colors"
                    autoFocus
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider">
                    Description
                  </label>
                  <textarea
                    value={state.description}
                    onChange={(e) => reducer.setDescription(e.target.value)}
                    placeholder={'Describe what this persona should do, what services it connects to, and how it should behave. Be specific about tools, triggers, and integrations needed.\n\nExample: A persona that monitors a Gmail inbox for important emails, classifies them by priority, sends Slack notifications for urgent ones, and creates a daily digest summary.'}
                    className="w-full h-48 px-4 py-3 rounded-xl border border-primary/15 bg-background/40 text-sm text-foreground/75 placeholder-muted-foreground/30 resize-none focus:outline-none focus:border-violet-500/40 transition-colors"
                  />
                  <p className="text-sm text-muted-foreground/80">
                    The AI will generate a full persona template including system prompt, tools, triggers, connectors, and template variables.
                  </p>
                </div>

                {state.error && (
                  <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                    {state.error}
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Step 2: Generate ── */}
            {state.step === 'generate' && (
              <motion.div
                key="generate"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
                className="p-6"
              >
                <TransformProgress
                  lines={state.generateLines}
                  mode="transform"
                  phase={state.generatePhase}
                  runId={state.backgroundGenId}
                  onRetry={handleRetry}
                  onCancel={handleCancel}
                />
              </motion.div>
            )}

            {/* ── Step 3: Review ── */}
            {state.step === 'review' && state.draft && (
              <motion.div
                key="review"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
                className="p-6 h-[60vh]"
              >
                <DraftEditStep
                  draft={state.draft}
                  draftJson={state.draftJson}
                  draftJsonError={state.draftJsonError}
                  adjustmentRequest={state.adjustmentRequest}
                  transforming={state.transforming}
                  disabled={state.saving || state.saved}
                  updateDraft={updateDraft}
                  onDraftUpdated={(draft) => reducer.draftUpdated(draft)}
                  onJsonEdited={(json, draft, error) => reducer.draftJsonEdited(json, draft, error)}
                  onAdjustmentChange={(text) => reducer.setAdjustment(text)}
                  onApplyAdjustment={handleApplyAdjustment}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-primary/10 bg-secondary/10 flex-shrink-0">
          <button
            onClick={handleBack}
            disabled={!canGoBack}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>

          <div className="flex items-center gap-3">
            {state.error && state.step !== 'describe' && (
              <span className="text-sm text-red-400/80 max-w-[300px] truncate">
                {state.error}
              </span>
            )}

            {state.step === 'describe' && (
              <button
                onClick={handleStartGenerate}
                disabled={!state.templateName.trim() || !state.description.trim()}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl border bg-violet-500/15 text-violet-300 border-violet-500/25 hover:bg-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Sparkles className="w-4 h-4" />
                Generate Template
              </button>
            )}

            {state.step === 'generate' && state.generatePhase === 'completed' && (
              <button
                onClick={() => reducer.goToStep('review')}
                disabled={!state.draft}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl border bg-violet-500/15 text-violet-300 border-violet-500/25 hover:bg-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ArrowRight className="w-4 h-4" />
                View Draft
              </button>
            )}

            {state.step === 'review' && !state.saved && (
              <button
                onClick={handleSaveTemplate}
                disabled={state.saving || !state.draft}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl border bg-emerald-500/15 text-emerald-300 border-emerald-500/25 hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {state.saving ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> Saving...</>
                ) : (
                  <><Check className="w-4 h-4" /> Save Template</>
                )}
              </button>
            )}

            {state.step === 'review' && state.saved && (
              <span className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-emerald-400">
                <Check className="w-4 h-4" />
                Template Saved
              </span>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
