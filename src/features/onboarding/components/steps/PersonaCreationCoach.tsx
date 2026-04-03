import { Check, MessageSquare, Sparkles, FlaskConical, Rocket, PenLine } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';

const SUB_STEPS = [
  { id: 'enter-intent', label: 'Describe', icon: PenLine },
  { id: 'answer-questions', label: 'Answer', icon: MessageSquare },
  { id: 'review-draft', label: 'Review', icon: Sparkles },
  { id: 'test-promote', label: 'Promote', icon: Rocket },
] as const;

const MATRIX_DIMENSIONS = [
  { key: 'use-cases', label: 'Use Cases', description: 'What workflows your agent handles', color: '#8b5cf6' },
  { key: 'connectors', label: 'Connectors', description: 'External services it integrates with', color: '#06b6d4' },
  { key: 'triggers', label: 'Triggers', description: 'How and when it activates', color: '#f59e0b' },
  { key: 'human-review', label: 'Human Review', description: 'When it needs your approval', color: '#f43f5e' },
  { key: 'messages', label: 'Messages', description: 'How it notifies you of results', color: '#3b82f6' },
  { key: 'memory', label: 'Memory', description: 'Conversation persistence across runs', color: '#a855f7' },
  { key: 'error-handling', label: 'Error Handling', description: 'Fallback strategies on failures', color: '#f97316' },
  { key: 'events', label: 'Events', description: 'Event subscriptions it listens to', color: '#14b8a6' },
];

const EXAMPLE_INTENTS = [
  'Monitor GitHub PRs and summarize weekly activity',
  'Scrape job postings and send daily digest to Slack',
  'Analyze customer feedback and update Notion database',
];

interface Props {
  subStepIndex: number;
}

export default function PersonaCreationCoach({ subStepIndex }: Props) {
  const buildPhase = useAgentStore((s) => s.buildPhase);
  const buildProgress = useAgentStore((s) => s.buildProgress);
  const pendingQuestions = useAgentStore((s) => s.buildPendingQuestions);
  const buildCellStates = useAgentStore((s) => s.buildCellStates);
  const buildTestPassed = useAgentStore((s) => s.buildTestPassed);

  // Auto-advance sub-steps based on build phase
  const effectiveSubStep = (() => {
    if (buildPhase === 'promoted' || buildPhase === 'test_complete') return 3;
    if (buildPhase === 'draft_ready') return 2;
    if (pendingQuestions.length > 0 && buildPhase === 'resolving') return 1;
    if (buildPhase === 'analyzing' || buildPhase === 'resolving') return 1;
    return subStepIndex;
  })();

  const resolvedCount = Object.values(buildCellStates).filter((s) => s === 'resolved').length;
  const completeness = resolvedCount > 0 ? Math.round((resolvedCount / 8) * 100) : 0;

  return (
    <div className="space-y-4" data-testid="tour-coach-root">
      {/* Sub-step progress */}
      <div className="flex items-center gap-1" data-testid="tour-coach-substep-progress">
        {SUB_STEPS.map((step, i) => {
          const isComplete = i < effectiveSubStep;
          const isCurrent = i === effectiveSubStep;
          return (
            <div
              key={step.id}
              data-testid={`tour-coach-substep-${step.id}`}
              className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] transition-all ${
                isComplete
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : isCurrent
                    ? 'bg-emerald-500/5 text-emerald-300 font-medium border border-emerald-500/20'
                    : 'bg-secondary/20 text-muted-foreground/40'
              }`}
            >
              {isComplete ? <Check className="w-2.5 h-2.5 flex-shrink-0" /> : <step.icon className="w-2.5 h-2.5 flex-shrink-0" />}
              <span className="truncate">{step.label}</span>
            </div>
          );
        })}
      </div>

      {/* Build phase indicator */}
      <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/20 border border-primary/8" data-testid="tour-coach-phase">
        <div className={`w-2 h-2 rounded-full ${
          buildPhase === 'promoted' ? 'bg-emerald-400' :
          buildPhase === 'test_complete' ? (buildTestPassed ? 'bg-emerald-400' : 'bg-red-400') :
          buildPhase === 'failed' ? 'bg-red-400' :
          'bg-amber-400 animate-pulse'
        }`} />
        <span className="text-[11px] text-muted-foreground/70 capitalize">{buildPhase.replace(/_/g, ' ')}</span>
        {buildProgress > 0 && buildProgress < 100 && (
          <span className="text-[11px] text-muted-foreground/50 ml-auto">{Math.round(buildProgress)}%</span>
        )}
      </div>

      {/* Dynamic content per sub-step */}
      {effectiveSubStep === 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground/70">
            Describe what your agent should do. Be specific about the task, data sources, and desired output.
          </p>
          <div className="space-y-1.5">
            <span className="text-[11px] text-muted-foreground/50 uppercase tracking-wider">Example intents</span>
            {EXAMPLE_INTENTS.map((intent, i) => (
              <div key={i} className="px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10 text-sm text-emerald-300/70">
                "{intent}"
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground/50 italic">
            Type your intent in the field on the right, then click the launch button.
          </p>
        </div>
      )}

      {effectiveSubStep === 1 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground/70">
            The AI is analyzing your intent and may ask clarifying questions to refine the agent design.
          </p>
          {pendingQuestions.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/15">
              <p className="text-sm text-amber-300/80 font-medium">
                {pendingQuestions.length} question{pendingQuestions.length > 1 ? 's' : ''} waiting
              </p>
              <p className="text-[11px] text-muted-foreground/50 mt-1">
                Answer them in the matrix to shape your agent's design.
              </p>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground/50 italic">
            Your answers help the AI choose the right connectors, triggers, and policies.
          </p>
        </div>
      )}

      {effectiveSubStep === 2 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground/70">The 8-dimension agent matrix:</p>
            <span className="text-[11px] text-emerald-400 font-medium" data-testid="tour-coach-completeness">
              {completeness}% complete
            </span>
          </div>
          <div className="space-y-1">
            {MATRIX_DIMENSIONS.map((dim) => {
              const status = buildCellStates[dim.key];
              const isResolved = status === 'resolved';
              return (
                <div
                  key={dim.key}
                  data-testid={`tour-coach-matrix-cell-${dim.key}`}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] ${
                    isResolved ? 'bg-emerald-500/5' : 'bg-secondary/10'
                  }`}
                >
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: dim.color }} />
                  <span className={isResolved ? 'text-foreground/80 font-medium' : 'text-muted-foreground/60'}>
                    {dim.label}
                  </span>
                  <span className="text-muted-foreground/40 ml-auto truncate max-w-[120px]">{dim.description}</span>
                  {isResolved && <Check className="w-2.5 h-2.5 text-emerald-400 flex-shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {effectiveSubStep === 3 && (
        <div className="space-y-3">
          {buildTestPassed === true ? (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <p className="text-sm text-emerald-300 font-medium">All tests passed!</p>
              <p className="text-[11px] text-muted-foreground/50 mt-1">
                Your agent has been verified. Click "Promote" to make it production-ready.
              </p>
            </div>
          ) : buildTestPassed === false ? (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <p className="text-sm text-red-300 font-medium">Some tests failed</p>
              <p className="text-[11px] text-muted-foreground/50 mt-1">
                You can refine the agent and re-test, or skip this step for now.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground/70">
                Testing validates that your agent's tools work correctly with real APIs.
              </p>
              <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
                <div className="flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-emerald-400" />
                  <p className="text-sm text-emerald-300/80 font-medium">What testing checks:</p>
                </div>
                <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground/60">
                  <li>• Each tool connects to its target API</li>
                  <li>• Credentials are valid and have correct permissions</li>
                  <li>• Response formats match expectations</li>
                </ul>
              </div>
              <p className="text-[11px] text-muted-foreground/50 italic">
                Click "Run Test" in the matrix to verify, then promote to production.
              </p>
            </div>
          )}

          {buildPhase === 'promoted' && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/25">
              <div className="flex items-center gap-2">
                <Rocket className="w-4 h-4 text-emerald-400" />
                <p className="text-sm text-emerald-300 font-medium">Agent promoted!</p>
              </div>
              <p className="text-[11px] text-muted-foreground/50 mt-1">
                Your first agent is live. The tour is almost complete!
              </p>
            </div>
          )}
        </div>
      )}

      {/* Skip option */}
      {effectiveSubStep < 3 && buildPhase !== 'promoted' && (
        <button
          onClick={() => {
            useSystemStore.getState().emitTourEvent('tour:persona-promoted');
          }}
          className="w-full text-center text-[11px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors py-1"
          data-testid="tour-coach-skip"
        >
          Skip build for now
        </button>
      )}
    </div>
  );
}
