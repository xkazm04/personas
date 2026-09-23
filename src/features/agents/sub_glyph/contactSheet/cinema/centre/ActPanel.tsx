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
import { DraftActions, Enter, Note, ScreeningBody, VerdictActions, VerdictBody } from "./ActFooters";
import { COPY } from "../copy";

export interface CentreActions {
  openContext: (el: HTMLElement) => void;
  openRefine: () => void;
  openCaps: () => void;
  openReport: () => void;
  openSimulate: () => void;
  openLog: (el: HTMLElement) => void;
  askForce: () => void;
  askReject: () => void;
  startOver: () => void;
}

interface ActPanelProps {
  p: GlyphFullLayoutProps;
  s: SheetState;
  a: CentreActions;
  tight: boolean;
}

export function ActPanel({ p, s, a, tight }: ActPanelProps) {
  const activity = useAgentStore((st) => st.buildActivity);
  const { act, flow, clock, cast } = s;
  const phase = COPY.phaseLabel[p.buildPhase ?? "initializing"] ?? null;
  const refine = p.onRefine ? a.openRefine : undefined;
  const simulate = s.sessionId ? a.openSimulate : undefined;
  const lines = p.cliOutputLines ?? [];
  const base = { elapsed: clock.elapsed, running: clock.running, partial: clock.partial, detail: phase };
  const slate = (state: string, tone: SlateProps["tone"], extra?: Partial<SlateProps>): SlateProps => ({ ...base, state, tone, ...extra });

  if (act === "casting") {
    const state = cast.phase === "crowned" ? COPY.crowned : cast.phase === "deliberation" ? COPY.deliberating : COPY.casting;
    return (
      <ActionPanel slate={slate(state, "work")}>
        <Note>{activity || COPY.firstPassNote}</Note>
        <BuildAside picked={s.recipes.picked} lines={lines} tight={tight} onOpenLog={a.openLog} />
      </ActionPanel>
    );
  }

  if (act === "wiring") {
    return (
      <ActionPanel slate={slate(COPY.wiring, "work")}>
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
          slate={slate(sending ? COPY.state.sendingAnswers : COPY.answersReady(flow.n), sending ? "work" : "wait", sending ? {} : { detail: COPY.state.reviewNote })}
          hint={COPY.sendNote}
          actions={
            <Button variant="primary" size="md" icon={<Send className="w-3.5 h-3.5" />} onClick={flow.send} loading={sending} loadingLabel={COPY.sending} autoFocus>
              {COPY.send} <Enter />
            </Button>
          }
        >
          <AnswersList stage={flow.stage} qs={flow.qs} draftOf={flow.draftOf} onOpen={flow.open} />
        </ActionPanel>
      );
    }
    const away = flow.stage === "away";
    return (
      <ActionPanel
        slate={slate(COPY.questionsFor(flow.n), "wait")}
        actions={
          <Button variant="primary" size="md" icon={<MessageCircleQuestion className="w-3.5 h-3.5" />} onClick={() => flow.open()} autoFocus={away}>
            {away ? COPY.continueQuestions : COPY.state.answerNow} {away && <Enter />}
          </Button>
        }
      >
        <QuestionsSummary qs={flow.qs} />
      </ActionPanel>
    );
  }

  if (act === "draft") {
    return (
      <ActionPanel
        slate={slate(COPY.draftReady, "wait", { detail: COPY.state.draftNote })}
        actions={<DraftActions onStartTest={p.onStartTest} onRefine={refine} onReviewCaps={a.openCaps} onSimulate={simulate} />}
      />
    );
  }

  if (act === "screening") {
    return (
      <ActionPanel slate={slate(COPY.screening, "work")}>
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
        slate={slate(passed ? COPY.testsPassed : COPY.testsFailed, passed ? "good" : "bad")}
        actions={
          <VerdictActions
            passed={passed} onPromote={p.onPromote} onRefine={refine} onReport={a.openReport}
            onReviewCaps={a.openCaps} onSimulate={simulate}
            onAskForce={p.onPromoteForce ? a.askForce : undefined}
            onAskReject={p.onRejectTest ? a.askReject : undefined}
          />
        }
      >
        {hasBody && <VerdictBody passed={passed} testError={p.testError} results={results} />}
      </ActionPanel>
    );
  }

  if (act === "premiere") {
    return (
      <ActionPanel
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
