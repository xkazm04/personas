/** DialHub - the instrument's centre: a readable box inscribed in the face,
 *  holding the act's surface. Compose (with its recipe starters) and the
 *  ActPanel are Cinema's own components, so every testid the build flow
 *  relies on is the same element it always was; the panel is drawn in the
 *  dial's idiom (PanelLookContext "drafting": a drafted title block, not a
 *  raised card). From casting to premiere the crowned persona heads the
 *  panel (DialIdentity), the crowd orbiting OUTSIDE the hub while it casts.
 *
 *  The box FITS ITS CONTENT rather than scrolling it: it opens in the wide
 *  shape, and when an act's content is taller than that it turns to the
 *  tall shape (narrower, taller, still inscribed) for as long as that act
 *  lasts. Only content taller than the tall shape too would scroll. */
import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import type { SheetState } from "../cinema/useSheetState";
import { ComposeCentre } from "../cinema/centre/ComposeCentre";
import { RecipeStarters } from "../cinema/centre/RecipeStarters";
import { ActPanel, type CentreActions, type QuestionViews } from "../cinema/centre/ActPanel";
import { PanelLookContext } from "../cinema/centre/panelLook";
import { EASE } from "../cinema/cinemaMotion";
import { COPY as CINEMA } from "../cinema/copy";
import { DialIdentity } from "./DialCasting";
import { DialAnswersList, DialQuestionsSummary } from "./question/DialAnswers";
import type { HubRect } from "./dialGeometry";

const DIAL_QUESTION_VIEWS: QuestionViews = { Summary: DialQuestionsSummary, Answers: DialAnswersList };

interface DialHubProps {
  p: GlyphFullLayoutProps;
  s: SheetState;
  a: CentreActions;
  tight: boolean;
  billing: string | null;
  boxes: { wide: HubRect; tall: HubRect | null };
}

export function DialHub({ p, s, a, tight, billing, boxes }: DialHubProps) {
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
    body = <DialIdentity cast={cast} agentName={p.agentName} tight={tight} onRename={p.onAgentNameChange}>{panel}</DialIdentity>;
  } else if (act === "premiere") {
    body = <DialIdentity cast={cast} agentName={p.agentName} tight={tight} kicker={CINEMA.nowShowing} footnote={billing}>{panel}</DialIdentity>;
  } else {
    key = reviewing ? "review" : act;
    body = panel;
  }

  // The act whose content outgrew the wide box keeps the tall one.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [tallFor, setTallFor] = useState<string | null>(null);
  const tall = !!boxes.tall && tallFor === key;
  const box = tall && boxes.tall ? boxes.tall : boxes.wide;
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el || tall || !boxes.tall) return;
    const check = () => { if (el.offsetHeight > boxes.wide.h + 1) setTallFor(key); };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [key, tall, boxes.tall, boxes.wide.h]);

  return (
    <div
      className="absolute flex flex-col overflow-y-auto overflow-x-hidden [scrollbar-width:none]"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h, transition: "left 0.35s ease, top 0.35s ease, width 0.35s ease, height 0.35s ease" }}
      data-testid="dial-hub"
      data-shape={tall ? "tall" : "wide"}
    >
      <PanelLookContext.Provider value="drafting">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={key}
            ref={contentRef}
            className="w-full my-auto flex shrink-0 items-center justify-center"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.4, ease: EASE }}
          >
            {body}
          </motion.div>
        </AnimatePresence>
      </PanelLookContext.Provider>
    </div>
  );
}
