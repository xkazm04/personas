/** ActPanel — the centre's one action interface for every act after compose.
 *  Each act fills the same ActionPanel: a state name and tone for the slate,
 *  the honest clock, the act's content (activity, the questions, the answers,
 *  the screening tail, the verdict) and its actions with one primary. */
import { ArrowRight, MessageCircleQuestion, RotateCcw, Send } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import Button from "@/features/shared/components/buttons/Button";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import type { SheetState } from "../useSheetState";
import { ActionPanel } from "./ActionPanel";
import type { SlateProps } from "./Slate";
import { BuildAside, LogLine } from "./BuildAside";
import { AnswersList, QuestionsSummary } from "./QuestionsCentre";
import { DraftActions, Enter, Note, ScreeningBody, VerdictActions, VerdictBody, VerdictPromotePreview } from "./ActFooters";
import { usePromoteView } from "./usePromoteView";
import { COPY } from "../copy";

export interface CentreActions {
  openContext: (el: HTMLElement) => void;
  /** Push the camera into the persona core, grown out of its badge. */
  openCore: (el: HTMLElement) => void;
  openRefine: () => void;
  openCaps: () => void;
  openReport: () => void;
  openSimulate: () => void;
  openLog: (el: HTMLElement) => void;
  askForce: () => void;
  askReject: () => void;
  startOver: () => void;
}

/** How the question round's content is drawn: Cinema's own by default; a
 *  layout with its own idiom (the Schematic Dial) passes drop-ins with the
 *  same props. */
export interface QuestionViews {
  Summary: typeof QuestionsSummary;
  Answers: typeof AnswersList;
}
const CINEMA_QUESTION_VIEWS: QuestionViews = { Summary: QuestionsSummary, Answers: AnswersList };

interface ActPanelProps {
  p: GlyphFullLayoutProps;
  s: SheetState;
  a: CentreActions;
  tight: boolean;
  questionViews?: QuestionViews;
}

export function ActPanel({ p, s, a, tight, questionViews = CINEMA_QUESTION_VIEWS }: ActPanelProps) {
  const { Summary, Answers } = questionViews;
  const activity = useAgentStore((st) => st.buildActivity);
  // Fetches only while the draft sits at test_complete (the verdict act).
  const promoteView = usePromoteView();
  const { act, flow, clock, cast } = s;
  const phase = COPY.phaseLabel[p.buildPhase ?? "initializing"] ?? null;
  const refine = p.onRefine ? a.openRefine : undefined;
  const simulate = s.sessionId ? a.openSimulate : undefined;
  const lines = p.cliOutputLines ?? [];
  const base = { elapsed: clock.elapsed, running: clock.running, partial: clock.partial, detail: phase };
  const slate = (state: string, tone: SlateProps["tone"], extra?: Partial<SlateProps>): SlateProps => ({ ...base, state, tone, ...extra });
  // A build error rides inside the panel in every act (the stopped act prints
  // it as its body instead), never as a banner that would shrink the sheet.
  const errorLine = act === "stopped" ? null : p.buildError;

  if (act === "casting") {
    const state = cast.phase === "crowned" ? COPY.crowned : cast.phase === "deliberation" ? COPY.deliberating : COPY.casting;
    return (
      <ActionPanel alert={errorLine} slate={slate(state, "work")}>
        <Note>{activity || COPY.firstPassNote}</Note>
        <BuildAside picked={s.recipes.picked} lines={lines} tight={tight} onOpenLog={a.openLog} />
      </ActionPanel>
    );
  }

  if (act === "wiring") {
    return (
      <ActionPanel alert={errorLine} slate={slate(COPY.wiring, "work")}>
        <Note>{activity || COPY.wiringNote}</Note>
        <LogLine lines={lines} onOpen={a.openLog} />
      </ActionPanel>
    );
  }

  if (act === "questions") {
    if (flow.stage === "review" || flow.stage === "sending") {
      const sending = flow.stage === "sending";
      return (
        <ActionPanel
          alert={errorLine}
          slate={slate(sending ? COPY.state.sendingAnswers : COPY.answersReady(flow.n), sending ? "work" : "wait", sending ? {} : { detail: COPY.state.reviewNote })}
          hint={COPY.sendNote}
          actions={
            <Button variant="primary" size="md" icon={<Send className="w-3.5 h-3.5" />} onClick={flow.send} loading={sending} loadingLabel={COPY.sending} autoFocus>
              {COPY.send} <Enter />
            </Button>
          }
        >
          <Answers stage={flow.stage} qs={flow.qs} draftOf={flow.draftOf} onOpen={flow.open} />
        </ActionPanel>
      );
    }
    const away = flow.stage === "away";
    // The "Faster path" row takes the questions note's place while it shows,
    // so the panel keeps its height in the short centre cell.
    const suggesting = !!p.templateSuggestionShowing;
    return (
      <ActionPanel
        alert={errorLine}
        slate={slate(COPY.questionsFor(flow.n), "wait")}
        actions={
          <Button variant="primary" size="md" icon={<MessageCircleQuestion className="w-3.5 h-3.5" />} onClick={() => flow.open()} autoFocus={away}>
            {away ? COPY.continueQuestions : COPY.state.answerNow} {away && <Enter />}
          </Button>
        }
      >
        <Summary qs={flow.qs} note={!suggesting} />
        {p.templateSuggestion}
      </ActionPanel>
    );
  }

  if (act === "draft") {
    return (
      <ActionPanel
        alert={errorLine}
        slate={slate(COPY.draftReady, "wait", { detail: COPY.state.draftNote })}
        actions={<DraftActions onStartTest={p.onStartTest} onRefine={refine} onReviewCaps={a.openCaps} onSimulate={simulate} />}
      />
    );
  }

  if (act === "screening") {
    return (
      <ActionPanel alert={errorLine} slate={slate(COPY.screening, "work")}>
        <ScreeningBody lines={p.testOutputLines ?? []} />
      </ActionPanel>
    );
  }

  if (act === "verdict") {
    const passed = !!p.testPassed;
    const results = p.toolTestResults ?? [];
    const hasBody = !passed ? !!p.testError || results.length > 0 : results.length > 0;
    return (
      <ActionPanel
        alert={errorLine}
        slate={slate(passed ? COPY.testsPassed : COPY.testsFailed, passed ? "good" : "bad")}
        actions={
          <VerdictActions
            passed={passed} onPromote={p.onPromote} onRefine={refine} onReport={a.openReport}
            onReviewCaps={a.openCaps} onSimulate={simulate}
            onAskForce={p.onPromoteForce ? a.askForce : undefined}
            onAskReject={p.onRejectTest ? a.askReject : undefined}
            blockedReason={promoteView.canPromote ? null : promoteView.reason ?? ""}
          />
        }
      >
        {hasBody || promoteView.hasContent ? (
          <>
            {hasBody && <VerdictBody passed={passed} testError={p.testError} results={results} />}
            <VerdictPromotePreview view={promoteView} />
          </>
        ) : null}
      </ActionPanel>
    );
  }

  if (act === "premiere") {
    return (
      <ActionPanel
        alert={errorLine}
        slate={slate(COPY.ready, "good", { final: true })}
        actions={
          <Button variant="primary" size="md" iconRight={<ArrowRight className="w-3.5 h-3.5" />} onClick={p.onViewAgent} autoFocus>
            {COPY.openAgent} <Enter />
          </Button>
        }
      />
    );
  }

  // stopped
  const cancelled = p.buildPhase === "cancelled";
  return (
    <ActionPanel
      slate={slate(cancelled ? COPY.cancelled : COPY.state.stopped, "bad", { final: true })}
      hint={COPY.startOverNote}
      actions={
        <Button variant="primary" size="md" icon={<RotateCcw className="w-3.5 h-3.5" />} onClick={a.startOver} autoFocus>
          {COPY.startOver} <Enter />
        </Button>
      }
    >
      {p.buildError && <p className="typo-body text-foreground line-clamp-4">{p.buildError}</p>}
    </ActionPanel>
  );
}
