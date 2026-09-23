/** Slate — the clapperboard over the centre cell while the build runs. It
 *  claps once when a take starts (a state change, not a loop) and carries
 *  the agent, the real build phase and the honest timecode. */
import { motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/utility/interaction/useMotion";
import { timecode } from "../sheetModel";
import { COPY } from "../copy";

interface SlateProps {
  agent: string;
  phase: string;
  elapsed: number;
  headline: string;
}

export function Slate({ agent, phase, elapsed, headline }: SlateProps) {
  const reduce = useReducedMotion();
  return (
    <div className="w-full max-w-[400px] rounded-card overflow-hidden border border-card-border text-left shadow-elevation-3" style={{ background: "color-mix(in srgb, var(--background) 70%, #000)" }}>
      <motion.div
        aria-hidden
        className="h-3.5"
        style={{
          transformOrigin: "0 100%",
          background: "repeating-linear-gradient(-55deg, var(--foreground) 0 12px, var(--background) 12px 24px)",
          opacity: 0.85,
        }}
        initial={reduce ? false : { rotate: -12 }}
        animate={{ rotate: 0 }}
        transition={{ delay: 0.15, duration: 0.5, ease: [0.5, 0, 0.3, 1.6] }}
      />
      <div className="px-3.5 py-2 grid grid-cols-[1fr_auto] gap-x-3 items-center">
        <div className="min-w-0 flex flex-col">
          <span className="typo-caption font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--cinema-accent)" }}>{headline}</span>
          <span className="typo-body text-foreground truncate">
            <span className="font-mono typo-caption text-foreground mr-1.5">{COPY.agent}</span>{agent}
            <span className="font-mono typo-caption text-foreground mx-1.5">{COPY.phase}</span>{phase}
          </span>
        </div>
        <span className="font-mono typo-heading-lg font-semibold tabular-nums text-foreground" aria-label={`${COPY.time} ${timecode(elapsed)}`}>
          {timecode(elapsed)}
        </span>
      </div>
    </div>
  );
}
