/** EndCentres — how the sheet ends well. The premiere: frames slide down into
 *  a credits strip, the centre becomes a poster in the crowned colour, the
 *  name develops one last time and the tested capabilities are billed as
 *  "Starring". The poster is a card on the app's raised surface; the state,
 *  the final clock and "Open agent" live in the action panel under it. (The
 *  stop is the action panel alone, see ActPanel.) */
import { motion } from "framer-motion";
import { CinemaSilhouette } from "@/features/agents/sub_glyph/cinemaShared";
import { useAgentStore } from "@/stores/agentStore";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import type { Candidate } from "../cinemaMotion";
import { EASE } from "../cinemaMotion";
import { CrownedName } from "./IdentityCentre";
import { COPY } from "../copy";

interface PremiereProps {
  winner: Candidate;
  agentName: string;
  starring: string[];
  billing: string | null;
  /** The action panel (ready state, total time, Open agent). */
  children: React.ReactNode;
}

export function PremiereCentre({ winner, agentName, starring, billing, children }: PremiereProps) {
  const mission = useAgentStore((s) => s.buildBehaviorCore?.mission ?? null);
  const accent = winner.color;
  return (
    <div className="w-full h-full min-h-0 flex flex-col items-center justify-center gap-3">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, ease: EASE, delay: 0.3 }}
        className="relative w-full max-w-[640px] flex flex-col items-center gap-2 text-center px-7 py-5 rounded-card overflow-hidden bg-secondary shadow-elevation-3"
        style={{
          border: `1px solid ${colorWithAlpha(accent, 0.4)}`,
          backgroundImage: `radial-gradient(ellipse 80% 70% at 50% 0%, ${colorWithAlpha(accent, 0.16)}, transparent 70%)`,
        }}
      >
        <motion.span
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{ background: "linear-gradient(105deg, transparent 35%, color-mix(in srgb, var(--foreground) 10%, transparent) 50%, transparent 65%)" }}
          initial={{ x: "-120%" }}
          animate={{ x: "120%" }}
          transition={{ duration: 1.6, delay: 0.9, ease: "easeOut" }}
        />
        <span className="typo-label uppercase tracking-[0.3em]" style={{ color: accent }}>{COPY.nowShowing}</span>
        <CinemaSilhouette form={winner.form} color={accent} size={40} />
        <CrownedName name={agentName.trim() || COPY.yourAgent} size="xl" />
        {mission && <p className="typo-body-lg text-foreground max-w-[520px] line-clamp-2">{mission}</p>}
        <div className="flex flex-col gap-0.5 typo-body text-foreground">
          {starring.length > 0 && <span>{COPY.starring} <b className="text-foreground font-semibold">{starring.slice(0, 4).join(" · ")}</b></span>}
          {billing && <span>{billing}</span>}
        </div>
      </motion.div>
      {children}
    </div>
  );
}
