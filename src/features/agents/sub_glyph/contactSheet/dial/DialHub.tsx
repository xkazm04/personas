/** DialHub - the instrument's centre: a fixed, readable box inscribed in the
 *  face, holding the act's surface. It is Cinema's SheetCentre with one
 *  change: through casting, questions and wiring the crowd orbits OUTSIDE the
 *  hub (DialOrbit), so the hub keeps only the crowned persona and the action
 *  panel. Compose (with its recipe starters), the title card, the premiere
 *  poster and the ActPanel are Cinema's own components, so every testid the
 *  build flow relies on is the same element it always was. */
import { AnimatePresence, motion } from "framer-motion";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import type { SheetState } from "../cinema/useSheetState";
import { ComposeCentre } from "../cinema/centre/ComposeCentre";
import { TitleCard } from "../cinema/centre/TitleCard";
import { PremiereCentre } from "../cinema/centre/EndCentres";
import { RecipeStarters } from "../cinema/centre/RecipeStarters";
import { ActPanel, type CentreActions, type QuestionViews } from "../cinema/centre/ActPanel";
import { EASE } from "../cinema/cinemaMotion";
import { DialIdentity } from "./DialCasting";
import { DialAnswersList, DialQuestionsSummary } from "./question/DialAnswers";

const DIAL_QUESTION_VIEWS: QuestionViews = { Summary: DialQuestionsSummary, Answers: DialAnswersList };

interface DialHubProps {
  p: GlyphFullLayoutProps;
  s: SheetState;
  a: CentreActions;
  tight: boolean;
  billing: string | null;
  box: { x: number; y: number; w: number; h: number };
}

export function DialHub({ p, s, a, tight, billing, box }: DialHubProps) {
  const { act, flow, cast } = s;
  const reviewing = act === "questions" && (flow.stage === "review" || flow.stage === "sending");
  const panel = <ActPanel p={p} s={s} a={a} tight={tight} questionViews={DIAL_QUESTION_VIEWS} />;

  let body: React.ReactNode;
  let key: string = act;
  if (act === "compose") {
    body = (
      <ComposeCentre
        intentText={p.intentText} onIntentChange={p.onIntentChange} onLaunch={s.launch}
        launchDisabled={p.launchDisabled} launching={s.launching} core={s.core}
        hasContext={!!p.contextText?.trim()} onOpenContext={a.openContext} onOpenCore={a.openCore}
        error={p.launchError} onDismissError={p.onDismissLaunchError}
        below={<RecipeStarters recipes={s.recipes} />}
      />
    );
  } else if (act === "casting" || act === "wiring" || (act === "questions" && !reviewing)) {
    key = "identity";
    body = <DialIdentity cast={cast} agentName={p.agentName} tight={tight}>{panel}</DialIdentity>;
  } else if (act === "draft" || act === "screening" || act === "verdict") {
    key = "title";
    body = (
      <TitleCard winner={cast.winner} agentName={p.agentName} onAgentNameChange={p.onAgentNameChange} rows={p.glyphRows} tight>
        {panel}
      </TitleCard>
    );
  } else if (act === "premiere") {
    body = (
      <PremiereCentre winner={cast.winner} agentName={p.agentName} starring={p.glyphRows.map((r) => r.title)} billing={billing}>
        {panel}
      </PremiereCentre>
    );
  } else {
    key = reviewing ? "review" : act;
    body = panel;
  }

  return (
    <div
      className="absolute flex flex-col overflow-y-auto overflow-x-hidden [scrollbar-width:none]"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      data-testid="dial-hub"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={key}
          className="w-full my-auto flex shrink-0 items-center justify-center"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.4, ease: EASE }}
        >
          {body}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
