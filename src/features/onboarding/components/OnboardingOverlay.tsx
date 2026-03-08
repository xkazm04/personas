import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FlaskConical,
  Download,
  Play,
  Check,
  ArrowRight,
  X,
  Loader2,
  Sparkles,
  Terminal,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { BaseModal } from '@/lib/ui/BaseModal';
import { listDesignReviews, getTrendingTemplates } from '@/api/reviews';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import { parseJsonOrDefault as parseJsonSafe } from '@/lib/utils/parseJson';
import { DimensionRadial } from '@/features/templates/sub_generated/shared/DimensionRadial';
import AdoptionWizardModal from '@/features/templates/sub_generated/adoption/AdoptionWizardModal';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { OnboardingStep } from '@/stores/slices/onboardingSlice';

// ── Step config ────────────────────────────────────────────────────────

const STEPS: { key: OnboardingStep; label: string; icon: typeof FlaskConical }[] = [
  { key: 'pick-template', label: 'Pick Template', icon: FlaskConical },
  { key: 'adopt', label: 'Adopt Agent', icon: Download },
  { key: 'execute', label: 'First Run', icon: Play },
];

// ── TemplatePickerStep ─────────────────────────────────────────────────

function TemplatePickerStep({
  templates,
  isLoading,
  selectedId,
  onSelect,
}: {
  templates: PersonaDesignReview[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
        <span className="ml-3 text-sm text-muted-foreground/80">Loading templates...</span>
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="text-center py-16">
        <FlaskConical className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground/70">No starter templates found.</p>
        <p className="text-sm text-muted-foreground/50 mt-1">Generate templates first from the Templates section.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-foreground/90 mb-1">Pick a starter template</h3>
        <p className="text-sm text-muted-foreground/70">Choose one of these popular templates to create your first agent.</p>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {templates.map((review) => {
          const designResult = parseJsonSafe<DesignAnalysisResult | null>(review.design_result, null);
          const connectors = parseJsonSafe<string[]>(review.connectors_used, []);
          const isSelected = selectedId === review.id;

          return (
            <button
              key={review.id}
              onClick={() => onSelect(review.id)}
              className={`text-left rounded-xl border p-4 transition-all group ${
                isSelected
                  ? 'bg-violet-500/10 border-violet-500/30 shadow-md shadow-violet-500/10'
                  : 'bg-secondary/30 border-primary/10 hover:bg-secondary/50 hover:border-primary/20'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-sm font-semibold text-foreground/90 truncate">
                      {review.test_case_name}
                    </h4>
                    {isSelected && <Check className="w-4 h-4 text-violet-400 flex-shrink-0" />}
                  </div>
                  <p className="text-sm text-muted-foreground/70 line-clamp-2">
                    {review.instruction.length > 150
                      ? review.instruction.slice(0, 150) + '...'
                      : review.instruction}
                  </p>
                  {connectors.length > 0 && (
                    <p className="text-sm text-muted-foreground/50 mt-1.5">
                      {connectors.slice(0, 4).join(', ')}
                      {connectors.length > 4 && ` +${connectors.length - 4} more`}
                    </p>
                  )}
                </div>
                {designResult && (
                  <div className="flex-shrink-0">
                    <DimensionRadial designResult={designResult} size={36} />
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── ExecutionStep ──────────────────────────────────────────────────────

function ExecutionStep({
  personaId,
  personaName,
  onComplete,
}: {
  personaId: string;
  personaName: string;
  onComplete: () => void;
}) {
  const executePersona = usePersonaStore((s) => s.executePersona);
  const executionOutput = usePersonaStore((s) => s.executionOutput);
  const activeExecutionId = usePersonaStore((s) => s.activeExecutionId);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [executionOutput]);

  // Listen for execution completion
  useEffect(() => {
    if (!activeExecutionId) return;

    let unlisten: UnlistenFn | null = null;
    listen<{ execution_id: string; status: string }>(
      'execution-complete',
      (event) => {
        if (event.payload.execution_id === activeExecutionId) {
          setFinished(true);
          if (event.payload.status === 'completed') {
            onComplete();
          } else {
            setExecutionError(`Execution ${event.payload.status}`);
          }
        }
      },
    ).then((fn) => {
      unlisten = fn;
      unlistenRef.current = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [activeExecutionId, onComplete]);

  const handleRun = async () => {
    setStarted(true);
    setExecutionError(null);
    const execId = await executePersona(personaId);
    if (!execId) {
      setExecutionError('Failed to start execution');
      setStarted(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-foreground/90 mb-1">Run your first agent</h3>
        <p className="text-sm text-muted-foreground/70">
          Execute <span className="font-medium text-foreground/80">{personaName}</span> and see real-time output.
        </p>
      </div>

      {!started ? (
        <div className="flex flex-col items-center py-8 gap-4">
          <div className="w-16 h-16 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Play className="w-8 h-8 text-emerald-400" />
          </div>
          <p className="text-sm text-muted-foreground/70 text-center max-w-sm">
            Your agent is ready. Click below to start the first execution and see it in action.
          </p>
          <button
            onClick={handleRun}
            className="px-6 py-2.5 text-sm font-medium rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors flex items-center gap-2"
          >
            <Play className="w-4 h-4" />
            Run Agent
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Status indicator */}
          <div className="flex items-center gap-2">
            {finished ? (
              executionError ? (
                <>
                  <XCircle className="w-4 h-4 text-red-400" />
                  <span className="text-sm text-red-400">{executionError}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm text-emerald-400">Execution completed successfully</span>
                </>
              )
            ) : (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
                <span className="text-sm text-violet-300">Executing...</span>
              </>
            )}
          </div>

          {/* Terminal output */}
          <div
            ref={terminalRef}
            className="bg-black/40 rounded-xl border border-primary/10 p-4 font-mono text-sm h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-primary/15 scrollbar-track-transparent"
          >
            <div className="flex items-center gap-2 mb-2 text-muted-foreground/50 border-b border-primary/10 pb-2">
              <Terminal className="w-3.5 h-3.5" />
              <span className="text-sm">Agent Output</span>
            </div>
            {executionOutput.length === 0 && !finished && (
              <p className="text-muted-foreground/60 text-sm">Waiting for output...</p>
            )}
            {executionOutput.map((line, i) => (
              <div key={i} className="text-foreground/70 whitespace-pre-wrap break-all leading-relaxed">
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step indicator ─────────────────────────────────────────────────────

function StepIndicator({
  steps,
  currentStep,
  completedSteps,
}: {
  steps: typeof STEPS;
  currentStep: OnboardingStep;
  completedSteps: Record<OnboardingStep, boolean>;
}) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((step, i) => {
        const Icon = step.icon;
        const isCurrent = step.key === currentStep;
        const isCompleted = completedSteps[step.key];

        return (
          <div key={step.key} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                isCurrent
                  ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25'
                  : isCompleted
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-secondary/30 text-muted-foreground/50 border border-primary/10'
              }`}
            >
              {isCompleted ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Icon className="w-3.5 h-3.5" />
              )}
              {step.label}
            </div>
            {i < steps.length - 1 && (
              <ArrowRight className="w-3 h-3 text-muted-foreground/30" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main OnboardingOverlay ─────────────────────────────────────────────

export default function OnboardingOverlay() {
  const onboardingActive = usePersonaStore((s) => s.onboardingActive);
  const onboardingStep = usePersonaStore((s) => s.onboardingStep);
  const onboardingStepCompleted = usePersonaStore((s) => s.onboardingStepCompleted);
  const onboardingSelectedReviewId = usePersonaStore((s) => s.onboardingSelectedReviewId);
  const onboardingCreatedPersonaId = usePersonaStore((s) => s.onboardingCreatedPersonaId);
  const setOnboardingStep = usePersonaStore((s) => s.setOnboardingStep);
  const completeOnboardingStep = usePersonaStore((s) => s.completeOnboardingStep);
  const setOnboardingSelectedReview = usePersonaStore((s) => s.setOnboardingSelectedReview);
  const setOnboardingCreatedPersona = usePersonaStore((s) => s.setOnboardingCreatedPersona);
  const finishOnboarding = usePersonaStore((s) => s.finishOnboarding);
  const dismissOnboarding = usePersonaStore((s) => s.dismissOnboarding);

  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const personas = usePersonaStore((s) => s.personas);
  const fetchPersonas = usePersonaStore((s) => s.fetchPersonas);

  const [templates, setTemplates] = useState<PersonaDesignReview[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [showAdoptionWizard, setShowAdoptionWizard] = useState(false);
  const [selectedReview, setSelectedReview] = useState<PersonaDesignReview | null>(null);

  // Load top 3 starter templates
  useEffect(() => {
    if (!onboardingActive) return;

    let cancelled = false;
    setIsLoadingTemplates(true);

    (async () => {
      try {
        // Try trending first, fall back to all reviews
        let reviews: PersonaDesignReview[] = [];
        try {
          reviews = await getTrendingTemplates(3);
        } catch {
          // intentional: non-critical — trending unavailable, fall back to all reviews
        }
        if (reviews.length === 0) {
          reviews = await listDesignReviews(undefined, 3);
        }
        if (!cancelled) setTemplates(reviews);
      } catch {
        // intentional: non-critical — template loading is best-effort for onboarding
        if (!cancelled) setTemplates([]);
      } finally {
        if (!cancelled) setIsLoadingTemplates(false);
      }
    })();

    return () => { cancelled = true; };
  }, [onboardingActive]);

  // When a template is selected, find the review object
  useEffect(() => {
    if (onboardingSelectedReviewId) {
      const review = templates.find((t) => t.id === onboardingSelectedReviewId);
      setSelectedReview(review ?? null);
    } else {
      setSelectedReview(null);
    }
  }, [onboardingSelectedReviewId, templates]);

  // Find the created persona name for the execute step
  const createdPersona = useMemo(
    () => personas.find((p) => p.id === onboardingCreatedPersonaId),
    [personas, onboardingCreatedPersonaId],
  );

  const handleTemplateSelect = (reviewId: string) => {
    setOnboardingSelectedReview(reviewId);
  };

  const handleNextFromPick = () => {
    if (!onboardingSelectedReviewId || !selectedReview) return;
    completeOnboardingStep('pick-template');
    setOnboardingStep('adopt');
    setShowAdoptionWizard(true);
  };

  const handleAdoptionComplete = () => {
    setShowAdoptionWizard(false);
    completeOnboardingStep('adopt');
    // Refresh personas to find the newly created one
    fetchPersonas().then(() => {
      // Find the newest persona (created most recently)
      const store = usePersonaStore.getState();
      const sorted = [...store.personas].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      const newest = sorted[0];
      if (newest) {
        setOnboardingCreatedPersona(newest.id);
      }
      setOnboardingStep('execute');
    });
  };

  const handleAdoptionClose = () => {
    setShowAdoptionWizard(false);
    // If they close the adoption wizard, go back to pick step
    if (!onboardingStepCompleted['adopt']) {
      setOnboardingStep('pick-template');
    }
  };

  const handleExecutionComplete = useCallback(() => {
    completeOnboardingStep('execute');
  }, [completeOnboardingStep]);

  const handleFinish = () => {
    finishOnboarding();
  };

  if (!onboardingActive) return null;

  // When adoption wizard is open, just show that (it's its own full modal)
  if (showAdoptionWizard && selectedReview) {
    return (
      <AdoptionWizardModal
        isOpen
        onClose={handleAdoptionClose}
        review={selectedReview}
        credentials={credentials}
        connectorDefinitions={connectorDefinitions}
        onPersonaCreated={handleAdoptionComplete}
      />
    );
  }

  return (
    <BaseModal
      isOpen
      onClose={dismissOnboarding}
      titleId="onboarding-overlay-title"
      maxWidthClass="max-w-2xl"
      panelClassName="max-h-[85vh] bg-background border border-primary/15 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
            <Sparkles className="w-4.5 h-4.5 text-violet-400" />
          </div>
          <div>
            <h2 id="onboarding-overlay-title" className="text-sm font-semibold text-foreground/90">
              Get Started
            </h2>
            <p className="text-sm text-muted-foreground/70">Create and run your first agent</p>
          </div>
        </div>
        <button
          onClick={dismissOnboarding}
          className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground/60 hover:text-foreground/80"
          title="Skip onboarding"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Step indicator */}
      <div className="px-6 py-3 border-b border-primary/5 flex-shrink-0">
        <StepIndicator
          steps={STEPS}
          currentStep={onboardingStep}
          completedSteps={onboardingStepCompleted}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={onboardingStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {onboardingStep === 'pick-template' && (
              <TemplatePickerStep
                templates={templates}
                isLoading={isLoadingTemplates}
                selectedId={onboardingSelectedReviewId}
                onSelect={handleTemplateSelect}
              />
            )}

            {onboardingStep === 'adopt' && !showAdoptionWizard && (
              <div className="flex flex-col items-center py-8 gap-4">
                <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
                <p className="text-sm text-muted-foreground/70">Opening adoption wizard...</p>
              </div>
            )}

            {onboardingStep === 'execute' && onboardingCreatedPersonaId && (
              <ExecutionStep
                personaId={onboardingCreatedPersonaId}
                personaName={createdPersona?.name ?? 'Your Agent'}
                onComplete={handleExecutionComplete}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-3.5 border-t border-primary/10 bg-secondary/10 flex-shrink-0">
        <button
          onClick={dismissOnboarding}
          className="px-4 py-2 text-sm font-medium rounded-xl border border-primary/15 text-muted-foreground/60 hover:bg-secondary/50 transition-colors"
        >
          Skip
        </button>

        <div className="flex items-center gap-2">
          {onboardingStep === 'pick-template' && (
            <button
              onClick={handleNextFromPick}
              disabled={!onboardingSelectedReviewId || templates.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Adopt Template
              <ArrowRight className="w-4 h-4" />
            </button>
          )}

          {onboardingStep === 'execute' && onboardingStepCompleted['execute'] && (
            <button
              onClick={handleFinish}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors"
            >
              <Check className="w-4 h-4" />
              Done
            </button>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
