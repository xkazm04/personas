/** SheetCentre — what the centre cell shows in each act. The prompt first;
 *  once the build starts, the centre is Cinema's picture (the casting and
 *  coronation, then the crowned persona as the title card, finally the
 *  premiere poster) over ONE action panel that carries everything about the
 *  build: its state, the honest clock, what it needs from you and the act's
 *  actions. Nothing about the build floats over the sheet outside it. */
import { AnimatePresence, motion } from "framer-motion";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import type { SheetState } from "./useSheetState";
import { ComposeCentre } from "./centre/ComposeCentre";
import { IdentityCentre } from "./centre/IdentityCentre";
import { TitleCard } from "./centre/TitleCard";
import { PremiereCentre } from "./centre/EndCentres";
import { RecipeStarters } from "./centre/RecipeStarters";
import { ActPanel, type CentreActions } from "./centre/ActPanel";
import { EASE } from "./cinemaMotion";

export type { CentreActions };

interface SheetCentreProps {
  p: GlyphFullLayoutProps;
  s: SheetState;
  a: CentreActions;
  tight: boolean;
  billing: string | null;
}

export function SheetCentre({ p, s, a, tight, billing }: SheetCentreProps) {
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
        hasContext={!!p.contextText?.trim()} onOpenContext={a.openContext}
        below={<RecipeStarters recipes={s.recipes} />}
      />
    );
  } else if (act === "casting" || act === "wiring" || (act === "questions" && !reviewing)) {
    // One key across casting, questions and wiring: the coronation and the
    // panel stay mounted while only the panel's content changes.
    key = "identity";
    body = <IdentityCentre cast={cast} agentName={p.agentName} tight={tight}>{panel}</IdentityCentre>;
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
    // The answers review and the stop: the panel alone.
    key = reviewing ? "review" : act;
    body = <div className="w-full h-full min-h-0 flex items-center justify-center">{panel}</div>;
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
