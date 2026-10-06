/** AnnotatedCentre - what the centre cell shows in each act. The same acts and
 *  the same panels as Cinema's SheetCentre (the composer, the title card, the
 *  premiere poster, ONE action panel carrying the build's state, clock and
 *  actions); only the coronation is redrawn (DraftedIdentity). The cell is
 *  framed by registration marks and carries the sheet's stamp when the
 *  drawing is screened or issued. */
import { AnimatePresence, motion } from "framer-motion";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import type { SheetState } from "../cinema/useSheetState";
import { ComposeCentre } from "../cinema/centre/ComposeCentre";
import { TitleCard } from "../cinema/centre/TitleCard";
import { PremiereCentre } from "../cinema/centre/EndCentres";
import { RecipeStarters } from "../cinema/centre/RecipeStarters";
import { ActPanel, type CentreActions } from "../cinema/centre/ActPanel";
import { EASE } from "../cinema/cinemaMotion";
import { DraftedIdentity } from "./DraftedIdentity";

interface AnnotatedCentreProps {
  p: GlyphFullLayoutProps;
  s: SheetState;
  a: CentreActions;
  tight: boolean;
  billing: string | null;
}

export function AnnotatedCentre({ p, s, a, tight, billing }: AnnotatedCentreProps) {
  const { act, flow, cast } = s;
  const reviewing = act === "questions" && (flow.stage === "review" || flow.stage === "sending");
  const panel = <ActPanel p={p} s={s} a={a} tight={tight} />;

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
    // One key across casting, questions and wiring: the coronation stays mounted.
    key = "identity";
    body = <DraftedIdentity cast={cast} agentName={p.agentName} tight={tight}>{panel}</DraftedIdentity>;
  } else if (act === "draft" || act === "screening" || act === "verdict") {
    key = "title";
    body = (
      <TitleCard winner={cast.winner} agentName={p.agentName} onAgentNameChange={p.onAgentNameChange} rows={p.glyphRows} tight={tight}>
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
    body = <div className="flex h-full min-h-0 w-full items-center justify-center">{panel}</div>;
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={key}
        className="flex h-full min-h-0 w-full items-center justify-center"
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

/** Four registration marks at the centre cell's corners, in faint ink. */
const g = "linear-gradient(var(--ink-dim), var(--ink-dim))";
export const REGISTRATION = [
  `${g} top left/12px 1px no-repeat`, `${g} top left/1px 12px no-repeat`,
  `${g} top right/12px 1px no-repeat`, `${g} top right/1px 12px no-repeat`,
  `${g} bottom left/12px 1px no-repeat`, `${g} bottom left/1px 12px no-repeat`,
  `${g} bottom right/12px 1px no-repeat`, `${g} bottom right/1px 12px no-repeat`,
].join(",");
