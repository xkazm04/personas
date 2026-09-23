import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import StudioChatInput from '../StudioChatInput';
import StudioPreviewFrames from '../StudioPreviewFrames';
import { useStudioStore } from '../studioStore';
import { useStudioPreview } from '../useStudioPreview';
import { isPlaceholderPlan } from '../studioBuildModel';
import GuideGoalsRail, { type GuideGoalsRailHandle } from './GuideGoalsRail';
import GuideBlueprint from './GuideBlueprint';
import GuideFrame from './GuideFrame';
import GuideNowLine from './GuideNowLine';
import GuideQuestionCard from './GuideQuestionCard';
import GuideDeck from './GuideDeck';
import GuideToolArc from './GuideToolArc';
import { addGoalPrompt, deriveDeck, type GuideCard, type GuideTool, type GuideToolId } from './guideModel';
import { estimateText } from './guideCopy';
import { useGuideRuntime } from './useGuideRuntime';
import { useGuideReadAloud } from './useGuideReadAloud';
import { useGuideKeys } from './useGuideKeys';

// The Guide layout (the /prototype winner, docs/design/studio-guide.md):
// a goals timeline on the left, the app being built in a full-focus frame, a
// blueprint until the plan is approved, Athena's next moves as cards, her tools
// around the orb, and today's Studio dock underneath. Everything runs on the
// real build protocol; no step here is simulated.
export default function GuideStudio({
  showVision,
  submitting,
  onCreate,
  onCancelCreate,
}: {
  showVision: boolean;
  submitting: boolean;
  onCreate: (name: string, vision: string) => Promise<void>;
  onCancelCreate?: () => void;
}) {
  const { t, tx } = useTranslation();
  const g = t.studio.guide;
  const rt = useGuideRuntime();
  const preview = useStudioPreview();
  const sendTurn = useStudioStore((s) => s.sendTurn);
  const setBuildSettings = useStudioStore((s) => s.setBuildSettings);
  const railRef = useRef<GuideGoalsRailHandle>(null);
  const [arcOpen, setArcOpen] = useState(false);
  const [questionHidden, setQuestionHidden] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [blueprintPinned, setBlueprintPinned] = useState<boolean | null>(null);
  const readAloud = useGuideReadAloud();

  const id = rt?.id ?? null;
  const placeholder = rt ? isPlaceholderPlan(rt.phases) : true;
  const live = !!rt && rt.phase === 'live' && rt.healthy;
  const working = !!rt && (rt.busy || rt.autonomous);
  const doneCount = rt ? rt.phases.filter((p) => p.status === 'done').length : 0;
  const everBuilt = !!rt && (doneCount > 1 || rt.activity.some((a) => a.kind === 'build'));
  // The blueprint holds the stage from setup until something is actually built;
  // B pins it either way.
  const showBlueprint = !showVision && !!rt && (blueprintPinned ?? (!live || (placeholder || !everBuilt)));
  const step = (rt?.turnDurations.length ?? 0) + (rt?.busy ? 1 : 0);
  const lastTurnSecs = rt && rt.turnDurations.length ? rt.turnDurations[rt.turnDurations.length - 1]! : null;
  const estimate = estimateText(g, tx, rt?.turnDurations ?? []);
  const question = rt?.question ?? null;

  // A new question always arrives visible; a new project starts on its own terms.
  useEffect(() => setQuestionHidden(false), [question]);
  useEffect(() => {
    setBlueprintPinned(null);
    setArcOpen(false);
  }, [id]);

  const run = useCallback(
    (prompt: string, mcp?: string[]) => {
      if (!id || !rt || working) return;
      if (mcp?.length) setBuildSettings(id, { mcp: Array.from(new Set([...rt.mcp, ...mcp])) });
      void sendTurn(id, prompt);
    },
    [id, rt, working, sendTurn, setBuildSettings],
  );

  const deck = useMemo(
    () =>
      rt && live && !working && !question && !showVision
        ? deriveDeck({ phases: rt.phases, activity: rt.activity, dismissed, placeholder })
        : [],
    [rt, live, working, question, showVision, dismissed, placeholder],
  );
  const accept = useCallback((c: GuideCard) => run(c.prompt, c.mcp), [run]);
  const decline = useCallback((c: GuideCard) => setDismissed((s) => new Set(s).add(c.key)), []);

  const lastReply = rt?.messages.length ? rt.messages[rt.messages.length - 1]!.text : null;
  const unavailable: Partial<Record<GuideToolId, string>> = {};
  for (const tool of ['research', 'looks', 'devices', 'tour', 'data'] as const) {
    if (!live) unavailable[tool] = g.tool_needs_live;
    else if (working) unavailable[tool] = g.tool_busy;
  }
  unavailable.tweak = g.tool_soon;
  if (!readAloud.configured) unavailable.read = g.tool_read_setup;
  else if (!lastReply) unavailable.read = g.tool_read_nothing;
  const pickTool = (tool: GuideTool) => {
    setArcOpen(false);
    if (tool.id === 'read') {
      if (lastReply) readAloud.speak(lastReply);
    } else if (tool.prompt) run(tool.prompt, tool.mcp);
  };

  useGuideKeys({
    enabled: !!rt && !showVision && !arcOpen,
    onTools: () => setArcOpen(true),
    onAddGoal: () => railRef.current?.startAdding(),
    onToggleBlueprint: () => setBlueprintPinned((p) => !(p ?? showBlueprint)),
    onEscape: () => question && setQuestionHidden(true),
  });

  const reason = rt && question ? (rt.messages[rt.messages.length - 1]?.text ?? null) : null;

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1">
      <GuideGoalsRail
        ref={railRef}
        phases={rt?.phases ?? []}
        placeholder={placeholder || showVision}
        canAdd={!!rt && live && !showVision}
        onAddGoal={(goal) => (working && id ? useStudioStore.getState().queueNote(id, goal) : run(addGoalPrompt(goal)))}
      />
      <div className="relative flex min-w-0 flex-1 flex-col gap-2 bg-[radial-gradient(ellipse_at_50%_0%,color-mix(in_srgb,var(--primary)_10%,transparent),transparent_60%)] p-3 pb-[5.25rem]">
        <GuideFrame
          preview={preview}
          blueprint={showBlueprint}
          vision={showVision}
          working={working}
          submitting={submitting}
          onCreate={onCreate}
          onCancelCreate={onCancelCreate}
        >
          {rt && !showVision && (
            <>
              {live && <StudioPreviewFrames preview={preview} showPointer={!showBlueprint} />}
              {showBlueprint && (
                <GuideBlueprint name={rt.name} phase={rt.phase} phases={rt.phases} placeholder={placeholder} messages={rt.messages} />
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
                <AnimatePresence mode="wait">
                  {question && !questionHidden && !rt.busy ? (
                    <GuideQuestionCard
                      key="q"
                      question={question}
                      options={rt.options}
                      reason={reason}
                      step={step}
                      lastTurnSecs={lastTurnSecs}
                      pointsAtElement={!!rt.decisionSelector && !showBlueprint}
                      onAnswer={(a) => id && void sendTurn(id, a)}
                      onHide={() => setQuestionHidden(true)}
                    />
                  ) : deck.length > 0 ? (
                    <GuideDeck key="d" cards={deck} estimate={estimate} onAccept={accept} onDecline={decline} />
                  ) : null}
                </AnimatePresence>
              </div>
            </>
          )}
        </GuideFrame>
        {rt && !showVision && (
          <GuideNowLine
            name={rt.name}
            settingUp={!live}
            busy={rt.busy}
            autonomous={rt.autonomous}
            autoTurns={rt.autoTurns}
            step={step}
            turnStartedAt={rt.turnStartedAt}
            lastTurnSecs={lastTurnSecs}
            activity={rt.activity}
            questionWaiting={!!question}
            questionHidden={questionHidden}
            queued={rt.queuedNotes.length}
            estimate={estimate}
            onOrb={() => setArcOpen(true)}
            onShowQuestion={() => setQuestionHidden(false)}
          />
        )}
        {rt && live && !showVision && <StudioChatInput variant="guide" onPlanClick={() => railRef.current?.focusActive()} />}
        {arcOpen && <GuideToolArc unavailable={unavailable} onPick={pickTool} onClose={() => setArcOpen(false)} />}
      </div>
    </div>
  );
}
