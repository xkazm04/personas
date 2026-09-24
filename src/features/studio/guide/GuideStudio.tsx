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
import GuideSketchSheet from './GuideSketchSheet';
import GuideFrame from './GuideFrame';
import GuideNowLine, { YourCallButton } from './GuideNowLine';
import GuideQuestionCard from './GuideQuestionCard';
import GuideDeck from './GuideDeck';
import GuideToolArc from './GuideToolArc';
import { addGoalPrompt, deriveDeck, setupSteps, type GuideCard, type GuideTool, type GuideToolId } from './guideModel';
import { estimateText, guideStrings } from './guideCopy';
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
  const g = guideStrings(t);
  const rt = useGuideRuntime();
  const preview = useStudioPreview();
  const sendTurn = useStudioStore((s) => s.sendTurn);
  const setBuildSettings = useStudioStore((s) => s.setBuildSettings);
  const draft = useStudioStore((s) => s.draft);
  const answerSketch = useStudioStore((s) => s.answerSketch);
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
  const question = rt?.question ?? null;
  // The plan sheet takes the stage only while something is really happening
  // on it: setup, a planning step running, or a first plan waiting for its
  // approval. An idle project shows its live site. A sheet held up with
  // nothing behind it reads as a frozen screen (measured live 2026-09-24: an
  // idle project with no plan kept its drafting ghosts forever and hid the
  // running site). B pins it either way.
  const planning = !!rt && rt.busy && placeholder;
  const awaitingApproval = !!rt && !!question && doneCount === 0 && !rt.activity.some((a) => a.kind === 'build');
  const showBlueprint = !showVision && !!rt && (blueprintPinned ?? (!live || planning || awaitingApproval));
  // A project being created (scaffold still running) takes the stage before
  // its runtime exists: the sketch lane draws it and asks its questions.
  const drafting = !!draft && !showVision;
  const sketchSrc = drafting
    ? { name: draft.name, sketch: draft.sketch, state: draft.sketchState, answers: draft.answers, startedAt: draft.startedAt }
    : rt && (rt.sketch || rt.sketchState)
      ? { name: rt.name, sketch: rt.sketch, state: rt.sketchState, answers: rt.sketchAnswers, startedAt: rt.setupStartedAt }
      : null;
  // Sketch questions belong to the moment a project is created. A project
  // opened later replays its stored sketch but is never re-asked them.
  const askSketch = drafting || !!rt?.setupStartedAt;
  const sketchQuestions = askSketch ? (sketchSrc?.sketch?.questions ?? []) : [];
  const nextSketchQ = sketchQuestions.findIndex((_, i) => !sketchSrc?.answers[i]);
  const sketchAsking = nextSketchQ >= 0 && !!sketchSrc?.sketch;
  // What a question card would show right now; Esc and "your call" act on it.
  const questionShown = drafting ? sketchAsking : (!!question && !rt?.busy) || sketchAsking;
  // Every no-plan setup state draws the sketch sheet: the sketch when there is
  // one, the Next.js page template until then (never an empty skeleton).
  const sketchMode = drafting || (showBlueprint && placeholder);
  const opened = !drafting && !rt?.setupStartedAt;
  const allSteps = setupSteps({
    sketchState: sketchSrc?.state ?? null,
    created: !drafting,
    phase: drafting ? null : (rt?.phase ?? null),
    planning,
    planned: !drafting && !placeholder,
  });
  // A project opened from disk was not sketched or created now: its timeline
  // is only what is really happening (the preview starting, a plan running).
  const steps = opened ? allSteps.filter((st) => st.key === 'preview' || st.key === 'plan') : allSteps;
  const step = (rt?.turnDurations.length ?? 0) + (rt?.busy ? 1 : 0);
  const lastTurnSecs = rt && rt.turnDurations.length ? rt.turnDurations[rt.turnDurations.length - 1]! : null;
  const estimate = estimateText(g, tx, rt?.turnDurations ?? []);

  // A new question always arrives visible; a new project starts on its own terms.
  useEffect(() => setQuestionHidden(false), [question, nextSketchQ]);
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
    enabled: !!rt && !showVision && !drafting && !arcOpen,
    escapeEnabled: !showVision && !arcOpen,
    onTools: () => setArcOpen(true),
    onAddGoal: () => railRef.current?.startAdding(),
    onToggleBlueprint: () => setBlueprintPinned((p) => !(p ?? showBlueprint)),
    onEscape: () => {
      if (!questionShown || questionHidden) return false;
      setQuestionHidden(true);
      return true;
    },
  });

  const reason = rt && question ? (rt.messages[rt.messages.length - 1]?.text ?? null) : null;

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1">
      <GuideGoalsRail
        ref={railRef}
        phases={rt?.phases ?? []}
        placeholder={placeholder || showVision || drafting}
        drafting={!showVision && !drafting && planning && !sketchSrc?.sketch}
        draftGoals={!showVision && (placeholder || drafting) ? sketchSrc?.sketch?.goals : undefined}
        canAdd={!!rt && live && !showVision && !drafting}
        onAddGoal={(goal) => (working && id ? useStudioStore.getState().queueNote(id, goal) : run(addGoalPrompt(goal)))}
      />
      <div className="relative flex min-w-0 flex-1 flex-col gap-2 bg-[radial-gradient(ellipse_at_50%_0%,color-mix(in_srgb,var(--primary)_10%,transparent),transparent_60%)] p-3 pb-[5.25rem]">
        <GuideFrame
          preview={preview}
          blueprint={showBlueprint || drafting}
          vision={showVision}
          working={working}
          submitting={submitting}
          onCreate={onCreate}
          onCancelCreate={onCancelCreate}
        >
          {sketchMode && !showVision && (sketchSrc || rt) && (
            <GuideSketchSheet
              name={sketchSrc?.name ?? rt?.name ?? ''}
              sketch={sketchSrc?.sketch ?? null}
              sketchState={sketchSrc?.state ?? null}
              steps={steps}
              startedAt={sketchSrc?.startedAt ?? null}
            />
          )}
          {drafting && sketchAsking && questionHidden && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
              <YourCallButton label={g.your_call} onClick={() => setQuestionHidden(false)} />
            </div>
          )}
          {drafting && sketchAsking && !questionHidden && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
              <GuideQuestionCard
                key={`sq-${nextSketchQ}`}
                question={sketchQuestions[nextSketchQ]!.question}
                options={sketchQuestions[nextSketchQ]!.options}
                reason={sketchQuestions[nextSketchQ]!.why || null}
                step={0}
                lastTurnSecs={null}
                pointsAtElement={false}
                counter={tx(g.question_counter, { n: nextSketchQ + 1, total: sketchQuestions.length })}
                inlineAnswer
                onAnswer={(a) => answerSketch(null, nextSketchQ, a)}
                onHide={() => setQuestionHidden(true)}
              />
            </div>
          )}
          {rt && !showVision && !drafting && (
            <>
              {live && <StudioPreviewFrames preview={preview} showPointer={!showBlueprint} />}
              {showBlueprint && !sketchMode && (
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
                  ) : nextSketchQ >= 0 && !questionHidden && sketchSrc?.sketch ? (
                    <GuideQuestionCard
                      key={`sq-${nextSketchQ}`}
                      question={sketchQuestions[nextSketchQ]!.question}
                      options={sketchQuestions[nextSketchQ]!.options}
                      reason={sketchQuestions[nextSketchQ]!.why || null}
                      step={0}
                      lastTurnSecs={null}
                      pointsAtElement={false}
                      counter={tx(g.question_counter, { n: nextSketchQ + 1, total: sketchQuestions.length })}
                      inlineAnswer
                      onAnswer={(a) => id && answerSketch(id, nextSketchQ, a)}
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
        {rt && !showVision && !drafting && (
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
            questionWaiting={!!question || sketchAsking}
            questionHidden={questionHidden}
            queued={rt.queuedNotes.length}
            estimate={estimate}
            onOrb={() => setArcOpen(true)}
            onShowQuestion={() => setQuestionHidden(false)}
            toolsOpen={arcOpen}
          />
        )}
        {rt && !showVision && !drafting && <StudioChatInput variant="guide" onPlanClick={() => railRef.current?.focusActive()} />}
        {arcOpen && !drafting && <GuideToolArc unavailable={unavailable} onPick={pickTool} onClose={() => setArcOpen(false)} />}
      </div>
    </div>
  );
}
