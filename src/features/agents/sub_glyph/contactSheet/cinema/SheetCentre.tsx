/** SheetCentre — what the centre cell shows in each act. The prompt, then
 *  Cinema's casting and coronation under a slate, then the crowned persona as
 *  the title card for the draft, the screening and the verdict, and finally
 *  the premiere poster. */
import { AnimatePresence, motion } from "framer-motion";
import { useAgentStore } from "@/stores/agentStore";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import type { SheetState } from "./useSheetState";
import { ComposeCentre } from "./centre/ComposeCentre";
import { IdentityCentre } from "./centre/IdentityCentre";
import { AnswersReview, QuestionsFooter } from "./centre/QuestionsCentre";
import { TitleCard } from "./centre/TitleCard";
import { DraftFooter, ScreeningFooter, VerdictFooter, WiringFooter, Note } from "./centre/ActFooters";
import { PremiereCentre, StoppedCentre } from "./centre/EndCentres";
import { RecipeStarters } from "./centre/RecipeStarters";
import { BuildAside } from "./centre/BuildAside";
import { EASE } from "./cinemaMotion";
import { COPY } from "./copy";

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

interface SheetCentreProps {
  p: GlyphFullLayoutProps;
  s: SheetState;
  a: CentreActions;
  tight: boolean;
  billing: string | null;
}

export function SheetCentre({ p, s, a, tight, billing }: SheetCentreProps) {
  const activity = useAgentStore((st) => st.buildActivity);
  const phaseLabel = COPY.phaseLabel[p.buildPhase ?? "initializing"] ?? "";
  const { act, flow, cast, clock } = s;
  const refine = p.onRefine ? a.openRefine : undefined;
  const reviewing = act === "questions" && (flow.stage === "review" || flow.stage === "sending");
  const simulate = s.sessionId ? a.openSimulate : undefined;
  const aside = <BuildAside picked={s.recipes.picked} lines={p.cliOutputLines ?? []} tight={tight} onOpenLog={a.openLog} />;

  let body: React.ReactNode;
  let key: string = act;
  if (act === "compose") {
    body = (
      <ComposeCentre
        intentText={p.intentText} onIntentChange={p.onIntentChange} onLaunch={s.launch}
        launchDisabled={p.launchDisabled} launching={s.launching} core={s.core}
        hasContext={!!p.contextText?.trim()} onOpenContext={a.openContext}
        below={<RecipeStarters recipes={s.recipes} />}
      />
    );
  } else if (act === "casting" || act === "wiring" || (act === "questions" && !reviewing)) {
    key = "identity";
    body = (
      <IdentityCentre cast={cast} agentName={p.agentName} phaseLabel={phaseLabel} elapsed={clock.elapsed} tight={tight}>
        {act === "casting" && <Note>{activity || COPY.firstPassNote}</Note>}
        {act === "wiring" && <WiringFooter activity={activity} />}
        {(act === "casting" || act === "wiring") && aside}
        {act === "questions" && <QuestionsFooter stage={flow.stage} count={flow.n} onContinue={() => flow.open()} />}
      </IdentityCentre>
    );
  } else if (reviewing) {
    key = "review";
    body = <AnswersReview stage={flow.stage} qs={flow.qs} draftOf={flow.draftOf} onOpen={flow.open} onSend={flow.send} />;
  } else if (act === "draft" || act === "screening" || act === "verdict") {
    key = "title";
    const passed = !!p.testPassed;
    body = (
      <TitleCard winner={cast.winner} agentName={p.agentName} onAgentNameChange={p.onAgentNameChange} rows={p.glyphRows} stamp={act === "verdict" ? (passed ? "passed" : "failed") : null} tight={tight}>
        {act === "draft" && <DraftFooter onStartTest={p.onStartTest} onRefine={refine} onReviewCaps={a.openCaps} onSimulate={simulate} />}
        {act === "screening" && <ScreeningFooter lines={p.testOutputLines ?? []} />}
        {act === "verdict" && (
          <VerdictFooter
            passed={passed} testError={p.testError} results={p.toolTestResults ?? []}
            onPromote={p.onPromote} onRefine={refine} onReport={a.openReport}
            onReviewCaps={a.openCaps} onSimulate={simulate}
            onAskForce={p.onPromoteForce ? a.askForce : undefined}
            onAskReject={p.onRejectTest ? a.askReject : undefined}
          />
        )}
      </TitleCard>
    );
  } else if (act === "premiere") {
    body = <PremiereCentre winner={cast.winner} agentName={p.agentName} starring={p.glyphRows.map((r) => r.title)} billing={billing} onViewAgent={p.onViewAgent} />;
  } else {
    body = <StoppedCentre cancelled={p.buildPhase === "cancelled"} elapsed={clock.elapsed} error={p.buildError} onStartOver={a.startOver} />;
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={key}
        className="w-full h-full min-h-0 flex items-center justify-center"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.4, ease: EASE }}
      >
        {body}
      </motion.div>
    </AnimatePresence>
  );
}
