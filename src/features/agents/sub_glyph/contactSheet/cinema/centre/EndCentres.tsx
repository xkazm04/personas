/** EndCentres — how the sheet ends. The premiere: frames slide down into a
 *  credits strip, the centre becomes a poster in the crowned colour, the name
 *  develops one last time and the tested capabilities are billed as "Starring".
 *  The stop: the honest time it stopped at, the real error, and a way back. */
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, RotateCcw } from "lucide-react";
import Button from "@/features/shared/components/buttons/Button";
import { CinemaSilhouette } from "@/features/agents/sub_glyph/cinemaShared";
import { useAgentStore } from "@/stores/agentStore";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import type { Candidate } from "../cinemaMotion";
import { EASE } from "../cinemaMotion";
import { CrownedName } from "./IdentityCentre";
import { spokenSeconds } from "../sheetModel";
import { COPY } from "../copy";

interface PremiereProps {
  winner: Candidate;
  agentName: string;
  starring: string[];
  billing: string | null;
  onViewAgent: () => void;
}

export function PremiereCentre({ winner, agentName, starring, billing, onViewAgent }: PremiereProps) {
  const mission = useAgentStore((s) => s.buildBehaviorCore?.mission ?? null);
  const accent = winner.color;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.7, ease: EASE, delay: 0.3 }}
      className="relative w-full max-w-[640px] flex flex-col items-center gap-2.5 text-center px-7 py-5 rounded-modal overflow-hidden"
      style={{
        border: `1px solid ${colorWithAlpha(accent, 0.4)}`,
        background: `radial-gradient(ellipse 80% 70% at 50% 0%, ${colorWithAlpha(accent, 0.16)}, transparent 70%), color-mix(in srgb, var(--background) 72%, #000)`,
        boxShadow: `0 30px 80px -20px ${colorWithAlpha(accent, 0.3)}`,
      }}
    >
      <motion.span
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{ background: "linear-gradient(105deg, transparent 35%, color-mix(in srgb, #fff 14%, transparent) 50%, transparent 65%)" }}
        initial={{ x: "-120%" }}
        animate={{ x: "120%" }}
        transition={{ duration: 1.6, delay: 0.9, ease: "easeOut" }}
      />
      <span className="font-mono typo-caption tracking-[0.3em]" style={{ color: accent }}>{COPY.nowShowing}</span>
      <CinemaSilhouette form={winner.form} color={accent} size={40} />
      <CrownedName name={agentName.trim() || COPY.yourAgent} size="xl" />
      {mission && <p className="typo-body-lg text-foreground max-w-[520px] line-clamp-2">{mission}</p>}
      <div className="flex flex-col gap-0.5 typo-body text-foreground">
        {starring.length > 0 && <span>{COPY.starring} <b className="text-foreground font-semibold">{starring.slice(0, 4).join(" · ")}</b></span>}
        {billing && <span>{billing}</span>}
      </div>
      <span className="typo-body font-semibold text-emerald-400">{COPY.ready}</span>
      <Button variant="primary" size="md" iconRight={<ArrowRight className="w-3.5 h-3.5" />} onClick={onViewAgent} autoFocus>
        {COPY.openAgent} <kbd className="ml-1 font-mono typo-caption opacity-70">↵</kbd>
      </Button>
    </motion.div>
  );
}

interface StoppedProps {
  cancelled: boolean;
  elapsed: number;
  error: string | null;
  onStartOver: () => void;
}

export function StoppedCentre({ cancelled, elapsed, error, onStartOver }: StoppedProps) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }} className="w-full h-full flex flex-col items-center justify-center gap-2.5 text-center">
      <AlertTriangle className="w-8 h-8 text-red-400" />
      <h2 className="typo-heading-lg font-semibold text-foreground">{cancelled ? COPY.cancelled : COPY.stoppedAt(spokenSeconds(elapsed))}</h2>
      {error && <p className="typo-body text-foreground max-w-[440px] line-clamp-4">{error}</p>}
      <Button variant="primary" size="md" icon={<RotateCcw className="w-3.5 h-3.5" />} onClick={onStartOver} autoFocus>
        {COPY.startOver} <kbd className="ml-1 font-mono typo-caption opacity-70">↵</kbd>
      </Button>
      <span className="typo-caption text-foreground">{COPY.startOverNote}</span>
    </motion.div>
  );
}
