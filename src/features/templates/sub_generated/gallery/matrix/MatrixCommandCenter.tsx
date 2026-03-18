/**
 * MatrixCommandCenter -- 9th cell centerpiece for PersonaMatrix.
 * Two variants: 'adoption' (template flow) and 'creation' (agent creation flow).
 * View mode: expandable prompt section chips.
 */
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { FileText, User, Wrench, BookOpen, Shield, Globe, Search, Loader2, Sparkles, Upload } from 'lucide-react';
import type { AgentIR, DesignQuestion } from '@/lib/types/designTypes';
import type { BuildPhase, ToolTestResult } from '@/lib/types/buildTypes';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import { BuildQuestionnaireModal } from './BuildQuestionnaireModal';
import { WorkflowUploadZone } from '@/features/agents/components/matrix/WorkflowUploadZone';
import { useAgentStore } from '@/stores/agentStore';
import {
  PromptModal, CapabilityToggle, LaunchOrb, BuildStatusIndicator, ActiveBuildProgress,
  AwaitingQuestionsIndicator, BuildCompletedIndicator, CreationPostGeneration,
  DesignQuestionPrompt, TestRunningIndicator, TestResultsPanel, PromotionSuccessIndicator,
} from './MatrixCommandCenterParts';

interface PromptSection { key: string; label: string; icon: React.ComponentType<{ className?: string }>; color: string; content: string; }

/** TypewriterBullets -- line-by-line content reveal for cell content entrance (VISL-04). */
export function TypewriterBullets({ items, speed = 150 }: { items: string[]; speed?: number }) {
  const prefersReducedMotion = useReducedMotion();
  const [visibleCount, setVisibleCount] = useState(prefersReducedMotion ? items.length : 0);
  useEffect(() => {
    if (prefersReducedMotion) { setVisibleCount(items.length); return; }
    if (visibleCount >= items.length) return;
    const timer = setTimeout(() => setVisibleCount((c) => c + 1), speed);
    return () => clearTimeout(timer);
  }, [visibleCount, items.length, speed, prefersReducedMotion]);
  return (
    <ul className="space-y-1.5">
      {items.slice(0, visibleCount).map((item, i) => (
        <motion.li key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} className="flex items-start gap-2 leading-tight">
          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-40 mt-[7px] flex-shrink-0" />
          <span className="text-sm text-foreground/70 leading-snug">{item}</span>
        </motion.li>
      ))}
    </ul>
  );
}

interface MatrixCommandCenterProps {
  designResult: AgentIR | null; isEditMode: boolean; isRunning?: boolean;
  onLaunch?: () => void; launchDisabled?: boolean; launchLabel?: string;
  variant?: 'adoption' | 'creation';
  questions?: TransformQuestionResponse[] | null; userAnswers?: Record<string, string>;
  onAnswerUpdated?: (questionId: string, answer: string) => void; onSubmitAnswers?: () => void;
  buildCompleted?: boolean; phaseLabel?: string;
  intentText?: string; onIntentChange?: (text: string) => void;
  completeness?: number; hasDesignResult?: boolean;
  onContinue?: () => void; onRefine?: (feedback: string) => void;
  onCreateAgent?: (name: string) => void; agentName?: string; onAgentNameChange?: (name: string) => void;
  cliOutputLines?: string[]; designQuestion?: DesignQuestion | null; onAnswerQuestion?: (answer: string) => void;
  buildPhase?: BuildPhase; onStartTest?: () => void; onApproveTest?: () => void; onRejectTest?: () => void;
  testOutputLines?: string[]; testPassed?: boolean | null; testError?: string | null;
  toolTestResults?: ToolTestResult[];
  testSummary?: string | null;
  onViewAgent?: () => void; cellBuildStates?: Record<string, string>;
  buildActivity?: string | null;
  onApplyEdits?: () => void; onDiscardEdits?: () => void;
}

const WRAP = "flex flex-col gap-3 w-full h-full items-center justify-center";

export function MatrixCommandCenter({
  designResult, isEditMode, isRunning = false,
  onLaunch, launchDisabled = false, launchLabel = 'Build Persona', variant = 'adoption',
  questions, userAnswers = {}, onAnswerUpdated, onSubmitAnswers,
  buildCompleted = false, phaseLabel = 'Generating persona...',
  intentText, onIntentChange, completeness = 0, hasDesignResult = false, onRefine,
  cliOutputLines = [], designQuestion, onAnswerQuestion,
  buildPhase, onStartTest, onApproveTest, onRejectTest,
  testOutputLines = [], testPassed, testError, toolTestResults = [], testSummary, onViewAgent, cellBuildStates,
  buildActivity, onApplyEdits, onDiscardEdits,
}: MatrixCommandCenterProps) {
  const [openSection, setOpenSection] = useState<PromptSection | null>(null);
  const [localPromptText, setLocalPromptText] = useState('');
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [webBrowseEnabled, setWebBrowseEnabled] = useState(false);
  const [showQuestionnaire, setShowQuestionnaire] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const hasWorkflowImport = !!useAgentStore((s) => s.buildWorkflowJson);

  // Callback to open the next pending question
  const handleOpenNextQuestion = useCallback(() => {
    if (!cellBuildStates) return;
    const nextKey = Object.entries(cellBuildStates).find(([, s]) => s === 'highlighted')?.[0];
    if (!nextKey) return;
    window.dispatchEvent(new CustomEvent('matrix-cell-click', { detail: { cellKey: nextKey } }));
  }, [cellBuildStates]);
  const [inputMode, setInputMode] = useState<'describe' | 'import'>(hasWorkflowImport ? 'import' : 'describe');

  // Auto-switch to import mode when workflow data arrives from n8n wizard handoff
  const prevHasWorkflow = useRef(hasWorkflowImport);
  useEffect(() => {
    if (hasWorkflowImport && !prevHasWorkflow.current) {
      setInputMode('import');
    }
    prevHasWorkflow.current = hasWorkflowImport;
  }, [hasWorkflowImport]);

  const textValue = variant === 'creation' && intentText !== undefined ? intentText : localPromptText;
  const handleTextChange = variant === 'creation' && onIntentChange ? onIntentChange : setLocalPromptText;
  const isCreation = variant === 'creation';

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

  useEffect(() => {
    if (isRunning || buildPhase === 'analyzing') setIsLaunching(false);
  }, [isRunning, buildPhase]);

  // Safety timeout: reset isLaunching if build never starts within 10s
  useEffect(() => {
    if (!isLaunching) return;
    const timer = setTimeout(() => setIsLaunching(false), 10_000);
    return () => clearTimeout(timer);
  }, [isLaunching]);

  if (isEditMode) {
    // Immediate feedback: show launching state before CLI responds
    if (isCreation && isLaunching && !isRunning) {
      return (
        <div className={WRAP}>
          <div className="relative w-12 h-12 flex items-center justify-center">
            <span className="absolute inset-0 rounded-full border-2 border-primary/20 animate-pulse" />
            <span className="absolute inset-[3px] rounded-full bg-gradient-to-br from-primary/15 via-primary/8 to-accent/10" />
            <Loader2 className="w-5 h-5 text-primary animate-spin relative z-10" />
          </div>
          <span className="text-xs font-semibold text-foreground/70 tracking-wide uppercase">Initializing...</span>
          <span className="text-[10px] text-muted-foreground/40">Creating draft agent and starting CLI</span>
        </div>
      );
    }
    // Building/Generating
    if (isRunning) {
      if (isCreation) return (<div className={WRAP}><ActiveBuildProgress buildPhase={buildPhase} completeness={completeness} cellStates={cellBuildStates} cliOutputLines={cliOutputLines} onOpenNextQuestion={handleOpenNextQuestion} buildActivity={buildActivity} onSubmitAnswers={onSubmitAnswers} /></div>);
      return (<div className={WRAP}><BuildStatusIndicator phaseLabel={phaseLabel} hint="You can close this dialog -- processing continues in the background." /></div>);
    }
    // Creation: Awaiting user input on cells
    if (isCreation && buildPhase === 'awaiting_input')
      return (<div className={WRAP}><ActiveBuildProgress buildPhase={buildPhase} completeness={completeness} cellStates={cellBuildStates} cliOutputLines={cliOutputLines} onOpenNextQuestion={handleOpenNextQuestion} buildActivity={buildActivity} onSubmitAnswers={onSubmitAnswers} /></div>);
    // Creation: Resolving/Analyzing (after refinement or continuation)
    if (isCreation && (buildPhase === 'resolving' || buildPhase === 'analyzing'))
      return (<div className={WRAP}><ActiveBuildProgress buildPhase={buildPhase} completeness={completeness} cellStates={cellBuildStates} cliOutputLines={cliOutputLines} onOpenNextQuestion={handleOpenNextQuestion} buildActivity={buildActivity} onSubmitAnswers={onSubmitAnswers} /></div>);
    // Creation: Testing lifecycle states
    if (isCreation && buildPhase === 'testing')
      return (<div className={WRAP}><TestRunningIndicator testOutputLines={testOutputLines} onCancelTest={undefined} /></div>);
    if (isCreation && buildPhase === 'test_complete')
      return (<div className={WRAP}><TestResultsPanel passed={testPassed} outputLines={testOutputLines} error={testError} onApprove={onApproveTest} onReject={onRejectTest} toolResults={toolTestResults} summary={testSummary} /></div>);
    if (isCreation && buildPhase === 'promoted')
      return (<div className={WRAP}><PromotionSuccessIndicator onViewAgent={onViewAgent} /></div>);
    // Creation: Design question awaiting answer
    if (isCreation && designQuestion && onAnswerQuestion)
      return (<div className={WRAP}><DesignQuestionPrompt question={designQuestion} onAnswer={onAnswerQuestion} /></div>);
    // Adoption: Awaiting questions
    if (!isCreation && awaitingQuestions) {
      return (
        <div className={WRAP}>
          <AwaitingQuestionsIndicator questionCount={questions!.length} onOpenQuestions={() => setShowQuestionnaire(true)} />
          {showQuestionnaire && onAnswerUpdated && onSubmitAnswers && (
            <BuildQuestionnaireModal questions={questions!} userAnswers={userAnswers} onAnswerUpdated={onAnswerUpdated}
              onSubmit={() => { setShowQuestionnaire(false); onSubmitAnswers(); }} onClose={() => setShowQuestionnaire(false)} />
          )}
        </div>
      );
    }
    // Adoption: Build completed
    if (!isCreation && buildCompleted) return (<div className={WRAP}><BuildCompletedIndicator /></div>);
    // Creation: Post-generation
    if (isCreation && hasDesignResult) return (<div className={WRAP}><CreationPostGeneration completeness={completeness} onRefine={onRefine} onStartTest={onStartTest} onApplyEdits={onApplyEdits} onDiscardEdits={onDiscardEdits} /></div>);
    // Pre-build / Pre-generation
    return (
      <div className="flex flex-col gap-3 w-full h-full items-center">
        {/* Describe / Import toggle (creation mode only) */}
        {isCreation && (
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-secondary/20 self-stretch">
            <button
              type="button"
              onClick={() => setInputMode('describe')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium transition-colors ${
                inputMode === 'describe'
                  ? 'bg-primary/15 text-primary shadow-sm'
                  : 'text-muted-foreground/50 hover:text-muted-foreground/70'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              Describe
            </button>
            <button
              type="button"
              onClick={() => setInputMode('import')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium transition-colors ${
                inputMode === 'import'
                  ? 'bg-primary/15 text-primary shadow-sm'
                  : 'text-muted-foreground/50 hover:text-muted-foreground/70'
              }`}
            >
              <Upload className="w-3 h-3" />
              Import
            </button>
          </div>
        )}
        {/* Describe mode: intent textarea */}
        {(inputMode === 'describe' || !isCreation) && (
          <textarea value={textValue} onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && isCreation && onLaunch && !launchDisabled) { e.preventDefault(); setIsLaunching(true); onLaunch(); } }}
            placeholder={isCreation ? "Describe what your agent should do... (Enter to generate)" : "Additional instructions..."}
            rows={isCreation ? 3 : 2} data-testid="agent-intent-input"
            className="w-full px-3 py-2 rounded-lg border border-primary/15 bg-card-bg text-sm text-foreground/80 placeholder-muted-foreground/30 resize-none focus-visible:outline-none focus-visible:border-primary/30 transition-colors" />
        )}
        {/* Import mode: workflow upload zone */}
        {inputMode === 'import' && isCreation && (
          <WorkflowUploadZone />
        )}
        {!isCreation && (
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <CapabilityToggle icon={Search} label="Web Search" active={webSearchEnabled} onToggle={() => setWebSearchEnabled(!webSearchEnabled)} />
            <CapabilityToggle icon={Globe} label="Web Browse" active={webBrowseEnabled} onToggle={() => setWebBrowseEnabled(!webBrowseEnabled)} />
          </div>
        )}
        <div className="flex-1 flex items-center justify-center">
          {onLaunch && (
            <LaunchOrb onClick={() => { setIsLaunching(true); onLaunch!(); }} disabled={launchDisabled} isRunning={false}
              label={isCreation ? 'Build' : launchLabel}
              icon={isCreation ? <Sparkles className="w-6 h-6 relative z-10 text-primary/80 group-hover:text-primary transition-colors" /> : undefined}
              buildPhase={buildPhase} />
          )}
        </div>
      </div>
    );
  }

  // View mode -- section chips
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
