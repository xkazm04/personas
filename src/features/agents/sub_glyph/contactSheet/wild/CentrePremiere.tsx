/** CentrePremiere: the promotion climax.
 *
 *  The flow redirects to the new agent about 1.5 s after promotion, so the
 *  whole beat lands inside that window: a white projector flash, the beam
 *  opening once, the marquee, the name printing letter by letter out of a
 *  blur, the mission as a tagline and the tested capabilities as "Starring".
 *  Meanwhile the frames glide down into a credits strip (SheetFrame layout).
 *  Open agent is focused from the first frame, so nothing waits on the show. */
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import type { GlyphRow } from "@/features/shared/glyph";
import { COPY } from "./wildCopy";

interface CentrePremiereProps {
  agentName: string;
  rows: GlyphRow[];
  billing: string;
  onViewAgent: () => void;
}

export function CentrePremiere({ agentName, rows, billing, onViewAgent }: CentrePremiereProps) {
  const reduce = useReducedMotion();
  const mission = useAgentStore((s) => s.buildBehaviorCore?.mission ?? null);
  const name = agentName.trim() || COPY.wait.untitled;
  const stars = rows.filter((r) => r.enabled).map((r) => r.title).slice(0, 4);

  return (
    <motion.div key="premiere" className="relative flex flex-col items-center justify-center gap-3 w-full h-full" initial={{ opacity: 1 }} animate={{ opacity: 1 }}>
      {!reduce && (
        <motion.span
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{ background: "#fff8ec", zIndex: 5 }}
          initial={{ opacity: 0.85 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        />
      )}
      <motion.span
        aria-hidden
        className="csw-beam"
        initial={reduce ? false : { opacity: 0, scaleX: 0.2 }}
        animate={{ opacity: 1, scaleX: 1 }}
        transition={{ duration: 0.8, ease: [0.2, 0.7, 0.2, 1] }}
      />
      <motion.span
        className="csw-edge relative"
        style={{ fontSize: 14, letterSpacing: ".5em", color: "var(--cs-amber)" }}
        initial={reduce ? false : { opacity: 0, letterSpacing: "1.2em" }}
        animate={{ opacity: 1, letterSpacing: "0.5em" }}
        transition={{ duration: 0.7, delay: 0.1 }}
      >
        {COPY.premiere.marquee}
      </motion.span>
      <h1 className="csw-poster-title relative m-0 text-center" aria-label={name}>
        {Array.from(name).map((ch, i) => (
          <motion.span
            key={i}
            aria-hidden
            className="inline-block whitespace-pre"
            initial={reduce ? false : { opacity: 0, y: 18, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.55, delay: 0.25 + i * 0.025, ease: [0.2, 0.7, 0.2, 1] }}
          >
            {ch}
          </motion.span>
        ))}
      </h1>
      <motion.p
        className="csw-serif relative m-0 max-w-[620px] text-center line-clamp-2"
        style={{ fontSize: 18, color: "var(--cs-dim)" }}
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.5 }}
      >
        {mission || COPY.premiere.fallbackTag}
      </motion.p>
      <motion.div
        className="relative flex flex-col items-center gap-1"
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.75, duration: 0.5 }}
      >
        {stars.length > 0 && (
          <span style={{ fontSize: 15 }}>
            <span className="csw-edge" style={{ marginRight: 10 }}>{COPY.premiere.starring}</span>
            <b className="csw-display" style={{ fontSize: 18 }}>{stars.join(" · ")}</b>
          </span>
        )}
        {billing && <span style={{ fontSize: 14, color: "var(--cs-dim)" }}>{billing}</span>}
        <span style={{ fontSize: 15, color: "var(--cs-ok)", fontWeight: 600 }}>{COPY.premiere.ready}</span>
      </motion.div>
      <button type="button" className="csw-btn relative" onClick={onViewAgent} autoFocus>
        {COPY.premiere.open}
        <ArrowRight className="w-4 h-4" />
        <span className="csw-kbd">↵</span>
      </button>
    </motion.div>
  );
}
