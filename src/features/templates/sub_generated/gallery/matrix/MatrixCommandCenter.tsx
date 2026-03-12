/**
 * MatrixCommandCenter -- 9th cell centerpiece for PersonaMatrix.
 *
 * Two variants:
 *   'adoption' (default) -- template adoption flow with build/questions
 *   'creation' -- agent creation flow with intent/generate/completeness/refine
 *
 * Edit mode phases (adoption):
 *   1. Pre-build: prompt input + capability toggles + radial launch orb
 *   2. Building: clean status indicator
 *   3. Awaiting questions: Q&A button -> modal
 *   4. Build completed: success indicator
 *
 * Edit mode phases (creation):
 *   1. Pre-generation: intent textarea + "Generate" orb
 *   2. Generating: status indicator
 *   3. Post-generation: completeness ring + refine input + "Continue" button
 *
 * View mode: expandable prompt section chips.
 */
import { useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  FileText, Play, X, User, Wrench, BookOpen, Shield,
  Globe, Search, Loader2, HelpCircle, CheckCircle2, Sparkles, ArrowRight, Send,
} from 'lucide-react';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import type { AgentIR } from '@/lib/types/designTypes';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import { BuildQuestionnaireModal } from './BuildQuestionnaireModal';

interface PromptSection { key: string; label: string; icon: React.ComponentType<{ className?: string }>; color: string; content: string; }

function PromptModal({ section, onClose }: { section: PromptSection; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, true, onClose);
  const Icon = section.icon;
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div ref={ref} className="w-full max-w-2xl max-h-[80vh] bg-background border border-primary/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-primary/10">
          <div className="flex items-center gap-2.5"><Icon className={`w-4.5 h-4.5 ${section.color}`} /><h3 className="text-base font-semibold text-foreground/90">{section.label}</h3></div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-foreground/[0.04] transition-colors"><X className="w-4 h-4 text-muted-foreground/60" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5"><pre className="whitespace-pre-wrap text-sm text-foreground/80 font-sans leading-relaxed">{section.content}</pre></div>
      </div>
    </div>,
    document.body,
  );
}

function CapabilityToggle({ icon: Icon, label, active, onToggle }: { icon: React.ComponentType<{ className?: string }>; label: string; active: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className={[
      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors',
      active
        ? 'border-primary/30 bg-primary/15 text-primary'
        : 'border-primary/10 bg-transparent text-muted-foreground/40 hover:text-muted-foreground/60 hover:border-primary/20',
    ].join(' ')}>
      <Icon className="w-3 h-3 flex-shrink-0" />
      {label}
    </button>
  );
}

/** Radial launch orb -- the visual centerpiece of the matrix. */
function LaunchOrb({ onClick, disabled, isRunning, label, icon }: { onClick?: () => void; disabled: boolean; isRunning: boolean; label: string; icon?: React.ReactNode }) {
  const blocked = disabled && !isRunning;
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || isRunning}
        className="group relative w-16 h-16 rounded-full flex items-center justify-center disabled:cursor-not-allowed transition-all duration-300"
      >
        <span className={`absolute inset-0 rounded-full border-2 transition-colors ${
          blocked
            ? 'border-orange-500/30 dark:border-amber-500/25 shadow-[0_0_12px_rgba(234,88,12,0.2)] dark:shadow-[0_0_12px_rgba(245,158,11,0.15)]'
            : 'border-primary/25 group-hover:border-primary/50 group-disabled:border-primary/10 shadow-[0_0_16px_var(--glass-bg)]'
        }`} />
        {isRunning && <span className="absolute inset-[-4px] rounded-full border border-primary/20 animate-ping" />}
        <span className={`absolute inset-[3px] rounded-full transition-colors ${
          blocked
            ? 'bg-gradient-to-br from-orange-500/20 via-orange-500/10 to-red-500/10 dark:from-amber-500/15 dark:via-amber-500/5 dark:to-orange-500/10'
            : 'bg-gradient-to-br from-primary/20 via-primary/10 to-accent/15 group-hover:from-primary/30 group-hover:via-primary/15 group-hover:to-accent/25'
        }`} />
        {isRunning
          ? <Loader2 className="w-6 h-6 text-primary animate-spin relative z-10" />
          : icon ?? <Play className={`w-6 h-6 relative z-10 transition-colors ${
              blocked ? 'text-orange-600/60 dark:text-amber-500/50' : 'text-primary/80 group-hover:text-primary'
            }`} />}
      </button>
      <span className={`text-[11px] font-medium tracking-wide uppercase ${
        blocked ? 'text-orange-600/70 dark:text-amber-500/60' : 'text-muted-foreground/50'
      }`}>
        {isRunning ? 'Generating...' : label}
      </span>
    </div>
  );
}

/** Clean status indicator during build/generation. */
function BuildStatusIndicator({ phaseLabel, hint }: { phaseLabel: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-primary/20 animate-pulse" />
        <span className="absolute inset-[3px] rounded-full bg-gradient-to-br from-primary/15 via-primary/8 to-accent/10" />
        <Loader2 className="w-5 h-5 text-primary animate-spin relative z-10" />
      </div>
      <span className="text-sm text-foreground/60 font-medium">{phaseLabel}</span>
      {hint && <p className="text-xs text-muted-foreground/40 text-center leading-relaxed">{hint}</p>}
    </div>
  );
}

/** Awaiting questions state. */
function AwaitingQuestionsIndicator({ questionCount, onOpenQuestions }: { questionCount: number; onOpenQuestions: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-primary/25" />
        <span className="absolute inset-[3px] rounded-full bg-gradient-to-br from-primary/15 via-primary/8 to-accent/10" />
        <HelpCircle className="w-5 h-5 text-primary relative z-10" />
      </div>
      <span className="text-sm text-foreground/70 font-medium">Your input needed</span>
      <button type="button" onClick={onOpenQuestions}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
        <HelpCircle className="w-3.5 h-3.5" />
        Answer {questionCount} question{questionCount !== 1 ? 's' : ''}
      </button>
    </div>
  );
}

/** Build completed state (adoption). */
function BuildCompletedIndicator() {
  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-emerald-400/25" />
        <span className="absolute inset-[3px] rounded-full bg-gradient-to-br from-emerald-500/15 via-emerald-500/8 to-emerald-400/10" />
        <CheckCircle2 className="w-5 h-5 text-emerald-400 relative z-10" />
      </div>
      <span className="text-sm text-foreground/70 font-medium">Build Complete</span>
    </div>
  );
}

/** SVG completeness ring for creation mode. */
function CompletenessRing({ value, size = 56 }: { value: number; size?: number }) {
  const r = (size - 6) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (value / 100) * circumference;
  const color = value >= 80 ? 'stroke-emerald-400' : 'stroke-primary';
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} className="stroke-primary/10" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} strokeLinecap="round"
          className={`${color} transition-all duration-700 ease-out`}
          strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
      <span className="absolute text-xs font-bold text-foreground/70">{value}%</span>
    </div>
  );
}

/** Post-generation state for creation mode. */
function CreationPostGeneration({
  completeness, onContinue, onRefine,
}: {
  completeness: number;
  onContinue?: () => void;
  onRefine?: (feedback: string) => void;
}) {
  const [refineText, setRefineText] = useState('');
  return (
    <div className="flex flex-col items-center gap-3 w-full h-full">
      <CompletenessRing value={completeness} />
      <span className="text-xs text-muted-foreground/50 font-medium">Agent Completeness</span>

      {/* Refine input */}
      {onRefine && (
        <div className="w-full flex gap-1.5">
          <input
            type="text"
            value={refineText}
            onChange={(e) => setRefineText(e.target.value)}
            placeholder="Adjust anything..."
            className="flex-1 px-2.5 py-1.5 rounded-lg border border-primary/15 bg-card-bg text-sm text-foreground/80 placeholder-muted-foreground/30 focus:outline-none focus:border-primary/30 transition-colors"
            onKeyDown={(e) => { if (e.key === 'Enter' && refineText.trim()) { onRefine(refineText.trim()); setRefineText(''); } }}
          />
          <button
            type="button"
            onClick={() => { if (refineText.trim()) { onRefine(refineText.trim()); setRefineText(''); } }}
            disabled={!refineText.trim()}
            className="p-1.5 rounded-lg text-primary/70 hover:text-primary hover:bg-primary/10 disabled:text-muted-foreground/20 transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Continue button */}
      {onContinue && (
        <button
          type="button"
          onClick={onContinue}
          disabled={completeness < 20}
          className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
            completeness >= 80
              ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30'
              : completeness >= 20
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-primary/30 text-primary-foreground/50 cursor-not-allowed'
          }`}
        >
          Continue <ArrowRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

interface MatrixCommandCenterProps {
  designResult: AgentIR | null;
  isEditMode: boolean;
  isRunning?: boolean;
  onLaunch?: () => void;
  launchDisabled?: boolean;
  launchLabel?: string;
  /** 'adoption' (template flow) or 'creation' (agent creation flow) */
  variant?: 'adoption' | 'creation';
  /** Questions from CLI during build */
  questions?: TransformQuestionResponse[] | null;
  userAnswers?: Record<string, string>;
  onAnswerUpdated?: (questionId: string, answer: string) => void;
  onSubmitAnswers?: () => void;
  buildCompleted?: boolean;
  phaseLabel?: string;
  /** Creation mode: controlled intent text */
  intentText?: string;
  onIntentChange?: (text: string) => void;
  /** Creation mode: completeness percentage 0-100 */
  completeness?: number;
  /** Creation mode: whether design result exists */
  hasDesignResult?: boolean;
  /** Creation mode: continue to next step */
  onContinue?: () => void;
  /** Creation mode: refine design with feedback */
  onRefine?: (feedback: string) => void;
}

export function MatrixCommandCenter({
  designResult, isEditMode,
  isRunning = false,
  onLaunch, launchDisabled = false, launchLabel = 'Build Persona',
  variant = 'adoption',
  questions, userAnswers = {}, onAnswerUpdated, onSubmitAnswers,
  buildCompleted = false, phaseLabel = 'Generating persona...',
  intentText, onIntentChange,
  completeness = 0, hasDesignResult = false, onContinue, onRefine,
}: MatrixCommandCenterProps) {
  const [openSection, setOpenSection] = useState<PromptSection | null>(null);
  const [localPromptText, setLocalPromptText] = useState('');
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [webBrowseEnabled, setWebBrowseEnabled] = useState(false);
  const [showQuestionnaire, setShowQuestionnaire] = useState(false);

  // Use controlled text for creation mode, local state for adoption
  const textValue = variant === 'creation' && intentText !== undefined ? intentText : localPromptText;
  const handleTextChange = variant === 'creation' && onIntentChange ? onIntentChange : setLocalPromptText;

  const sections = useMemo<PromptSection[]>(() => {
    if (!designResult?.structured_prompt) return [];
    const sp = designResult.structured_prompt;
    const r: PromptSection[] = [];
    if (sp.identity) r.push({ key: 'identity', label: 'Identity', icon: User, color: 'text-primary', content: sp.identity });
    if (sp.instructions) r.push({ key: 'instructions', label: 'Instructions', icon: FileText, color: 'text-accent', content: sp.instructions });
    if (sp.toolGuidance) r.push({ key: 'tools', label: 'Tool Guidance', icon: Wrench, color: 'text-brand-amber', content: sp.toolGuidance });
    if (sp.examples) r.push({ key: 'examples', label: 'Examples', icon: BookOpen, color: 'text-brand-emerald', content: sp.examples });
    if (sp.errorHandling) r.push({ key: 'errors', label: 'Error Handling', icon: Shield, color: 'text-brand-rose', content: sp.errorHandling });
    return r;
  }, [designResult]);

  const hasQuestions = !!questions && questions.length > 0;
  const awaitingQuestions = hasQuestions && !isRunning;
  const isCreation = variant === 'creation';

  if (isEditMode) {
    // --- Shared: Building/Generating --------------------------------
    if (isRunning) {
      return (
        <div className="flex flex-col gap-3 w-full h-full items-center justify-center">
          <BuildStatusIndicator
            phaseLabel={isCreation ? 'Designing agent...' : phaseLabel}
            hint={isCreation ? undefined : 'You can close this dialog -- processing continues in the background.'}
          />
        </div>
      );
    }

    // --- Adoption: Awaiting questions -------------------------------
    if (!isCreation && awaitingQuestions) {
      return (
        <div className="flex flex-col gap-3 w-full h-full items-center justify-center">
          <AwaitingQuestionsIndicator questionCount={questions!.length} onOpenQuestions={() => setShowQuestionnaire(true)} />
          {showQuestionnaire && onAnswerUpdated && onSubmitAnswers && (
            <BuildQuestionnaireModal questions={questions!} userAnswers={userAnswers} onAnswerUpdated={onAnswerUpdated}
              onSubmit={() => { setShowQuestionnaire(false); onSubmitAnswers(); }} onClose={() => setShowQuestionnaire(false)} />
          )}
        </div>
      );
    }

    // --- Adoption: Build completed ----------------------------------
    if (!isCreation && buildCompleted) {
      return (
        <div className="flex flex-col gap-3 w-full h-full items-center justify-center">
          <BuildCompletedIndicator />
        </div>
      );
    }

    // --- Creation: Post-generation ----------------------------------
    if (isCreation && hasDesignResult) {
      return (
        <div className="flex flex-col gap-3 w-full h-full items-center justify-center">
          <CreationPostGeneration completeness={completeness} onContinue={onContinue} onRefine={onRefine} />
        </div>
      );
    }

    // --- Pre-build / Pre-generation ---------------------------------
    return (
      <div className="flex flex-col gap-3 w-full h-full items-center">
        <textarea
          value={textValue}
          onChange={(e) => handleTextChange(e.target.value)}
          placeholder={isCreation ? "Describe what your agent should do..." : "Additional instructions..."}
          rows={isCreation ? 3 : 2}
          className="w-full px-3 py-2 rounded-lg border border-primary/15 bg-card-bg text-sm text-foreground/80 placeholder-muted-foreground/30 resize-none focus:outline-none focus:border-primary/30 transition-colors"
        />

        {!isCreation && (
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <CapabilityToggle icon={Search} label="Web Search" active={webSearchEnabled} onToggle={() => setWebSearchEnabled(!webSearchEnabled)} />
            <CapabilityToggle icon={Globe} label="Web Browse" active={webBrowseEnabled} onToggle={() => setWebBrowseEnabled(!webBrowseEnabled)} />
          </div>
        )}

        <div className="flex-1 flex items-center justify-center">
          {onLaunch && (
            <LaunchOrb
              onClick={onLaunch}
              disabled={launchDisabled}
              isRunning={false}
              label={isCreation ? 'Generate' : launchLabel}
              icon={isCreation ? <Sparkles className="w-6 h-6 relative z-10 text-primary/80 group-hover:text-primary transition-colors" /> : undefined}
            />
          )}
        </div>
      </div>
    );
  }

  // --- View mode -- section chips ------------------------------------
  return (
    <div className="flex flex-col gap-3 w-full h-full">
      <div className="flex flex-wrap gap-1.5">
        {sections.map((section) => { const Icon = section.icon; return (
          <button key={section.key} type="button" onClick={() => setOpenSection(section)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/10 bg-primary/5 hover:bg-primary/10 hover:border-primary/20 transition-colors cursor-pointer px-2 py-1">
            <Icon className={`w-3 h-3 ${section.color} flex-shrink-0`} />
            <span className="text-[13px] text-foreground/70 truncate">{section.label}</span>
          </button>
        ); })}
      </div>
      {sections.length > 0 && <p className="text-sm text-muted-foreground/50 leading-relaxed line-clamp-3">{sections[0]!.content.slice(0, 120)}...</p>}
      {openSection && <PromptModal section={openSection} onClose={() => setOpenSection(null)} />}
    </div>
  );
}
