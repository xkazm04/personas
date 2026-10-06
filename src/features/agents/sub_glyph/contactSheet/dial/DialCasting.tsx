/** The casting call, redrawn for the dial. While the first pass is silent the
 *  twelve candidates ORBIT the hub, in two arcs on the instrument's face above
 *  and below it, and are cast down to finalists; the moment the real identity
 *  streams in, the winner leaves its orbit slot and flies into the hub (one
 *  shared layout id), where its name is lettered in under it with the role and
 *  mission (Cinema's crowning moment, kept). The hub stays free for the panel.
 *  The same crowned header carries the hub to the end of the build: the draft
 *  and the verdict rename it in place, the premiere letters "now showing" over
 *  it and bills it under, never a card of its own (the panel is the one). */
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { CinemaSilhouette } from "@/features/agents/sub_glyph/cinemaShared";
import { useAgentStore } from "@/stores/agentStore";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import type { CinemaCast } from "../cinema/useCinemaCast";
import { CrownedName } from "../cinema/centre/IdentityCentre";
import { NameField } from "../cinema/centre/TitleCard";
import { LETTERING } from "../blueprint";
import { EASE } from "../cinema/cinemaMotion";
import { COPY as CINEMA } from "../cinema/copy";
import { orbitSlot, type Pt } from "./dialGeometry";

const SIZE = 36;

export function DialOrbit({ cast, c, R }: { cast: CinemaCast; c: Pt; R: number }) {
  if (cast.phase === "crowned") return null;
  const n = cast.candidates.length;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {cast.candidates.map((cand, i) => {
        const at = orbitSlot(i, n, c, R);
        const dead = cast.eliminated.has(cand.id);
        const finalist = cast.phase === "deliberation" && cast.finalists.has(cand.id);
        return (
          <motion.span
            key={cand.id}
            layoutId={`dial-cast-${cand.id}`}
            className="absolute grid place-items-center rounded-full"
            style={{
              left: at.x - SIZE / 2, top: at.y - SIZE / 2, width: SIZE, height: SIZE,
              background: dead ? "transparent" : `radial-gradient(circle at 50% 30%, ${colorWithAlpha(cand.color, finalist ? 0.32 : 0.16)}, transparent 72%)`,
            }}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={dead ? { opacity: 0.22, scale: 0.74 } : { opacity: 1, scale: finalist ? 1.18 : 1 }}
            transition={{ duration: 0.5, ease: EASE, delay: i * 0.03 }}
          >
            <CinemaSilhouette form={cand.form} color={cand.color} size={28} dead={dead} />
          </motion.span>
        );
      })}
    </div>
  );
}

interface DialIdentityProps {
  cast: CinemaCast;
  agentName: string;
  tight: boolean;
  /** Lettered over the name (the premiere's "now showing"). */
  kicker?: string;
  /** The name renames in place (draft, screening, verdict). */
  onRename?: (v: string) => void;
  /** One line under the mission (the premiere's billing). */
  footnote?: string | null;
  children: React.ReactNode;
}

/** The hub from casting to premiere: the crowned persona over the panel. */
export function DialIdentity({ cast, agentName, tight, kicker, onRename, footnote, children }: DialIdentityProps) {
  const core = useAgentStore((s) => s.buildBehaviorCore);
  const role = core?.identity?.role ?? null;
  const mission = core?.mission ?? null;
  const accent = cast.winner.color;
  if (cast.phase !== "crowned") return <div className="w-full flex flex-col items-center justify-center">{children}</div>;
  return (
    <div className="w-full flex flex-col items-center justify-center gap-2 text-center">
      <div className="flex items-center gap-3 max-w-full">
        <motion.span
          layoutId={`dial-cast-${cast.winner.id}`}
          className="relative grid shrink-0 place-items-center rounded-full w-11 h-11"
          style={{ background: `radial-gradient(circle at 50% 30%, ${colorWithAlpha(accent, 0.32)}, transparent 72%)`, border: `1px solid ${colorWithAlpha(accent, 0.5)}` }}
          transition={{ duration: 0.8, ease: EASE }}
        >
          <CinemaSilhouette form={cast.winner.form} color={accent} size={32} />
          <motion.span className="absolute -top-1 -right-1" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.6, type: "spring", stiffness: 300, damping: 18 }}>
            <Sparkles className="w-3.5 h-3.5" style={{ color: accent }} />
          </motion.span>
        </motion.span>
        <span className="flex min-w-0 flex-col items-start text-left">
          {kicker && <span style={{ ...LETTERING, fontSize: 10, color: accent }}>{kicker}</span>}
          {onRename ? <NameField name={agentName} onChange={onRename} /> : <CrownedName name={agentName.trim() || CINEMA.yourAgent} />}
          {role && <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="typo-caption font-mono uppercase tracking-[0.1em] truncate max-w-full" style={{ color: accent }}>{role}</motion.span>}
        </span>
      </div>
      {mission && !tight && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.65 }} className="typo-body text-foreground line-clamp-2">{mission}</motion.p>}
      {footnote && <span className="typo-caption text-foreground truncate max-w-full">{footnote}</span>}
      {children}
    </div>
  );
}
