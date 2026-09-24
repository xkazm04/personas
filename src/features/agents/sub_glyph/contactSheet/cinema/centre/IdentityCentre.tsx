/** IdentityCentre — Cinema's casting and coronation, played inside the centre
 *  cell of the contact sheet. The crowd of silhouettes is cast down to
 *  finalists while the build is silent, and the moment the real identity
 *  (role, mission) streams in, one finalist is crowned: it flies up, the name
 *  develops letter by letter, and the role and mission arrive under it.
 *  `children` is the action panel, which carries the state and the clock. */
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { CinemaSilhouette } from "@/features/agents/sub_glyph/cinemaShared";
import { useAgentStore } from "@/stores/agentStore";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { useReducedMotion } from "@/hooks/utility/interaction/useMotion";
import type { CinemaCast } from "../useCinemaCast";
import { EASE } from "../cinemaMotion";
import { COPY } from "../copy";

interface IdentityCentreProps {
  cast: CinemaCast;
  agentName: string;
  /** Short centre cell (1280 x 800): the mission waits for the title card. */
  tight?: boolean;
  children?: React.ReactNode;
}

export function CrownedName({ name, size = "lg" }: { name: string; size?: "lg" | "xl" }) {
  const reduce = useReducedMotion();
  const cls = size === "xl" ? "typo-hero" : "typo-title-lg";
  if (reduce) return <span className={`${cls} text-foreground`}>{name}</span>;
  return (
    <span className={`${cls} text-foreground whitespace-pre`} aria-label={name}>
      {Array.from(name).map((ch, i) => (
        <motion.span
          key={`${name}-${i}`}
          aria-hidden
          className="inline-block"
          initial={{ opacity: 0, y: 12, scale: 0.96, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          transition={{ delay: 0.25 + i * 0.03, duration: 0.7, ease: EASE }}
        >
          {ch}
        </motion.span>
      ))}
    </span>
  );
}

export function IdentityCentre({ cast, agentName, tight = false, children }: IdentityCentreProps) {
  const core = useAgentStore((s) => s.buildBehaviorCore);
  const role = core?.identity?.role ?? null;
  const mission = core?.mission ?? null;
  const crowned = cast.phase === "crowned";
  const accent = cast.winner.color;

  return (
    <div className="w-full h-full min-h-0 flex flex-col items-center justify-center gap-3 text-center">
      <LayoutGroup id="sheet-cinema-cast">
        <AnimatePresence initial={false} mode="popLayout">
          {!crowned ? (
            <motion.div key="crowd" exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.35 }} className="flex flex-wrap justify-center gap-x-2.5 gap-y-1 max-w-[330px]">
              {cast.candidates.map((c) => {
                const dead = cast.eliminated.has(c.id);
                const finalist = cast.phase === "deliberation" && cast.finalists.has(c.id);
                return (
                  <motion.span
                    key={c.id}
                    layoutId={`sheet-cast-${c.id}`}
                    initial={{ opacity: 0, y: 10, scale: 0.7 }}
                    animate={dead ? { opacity: 0.24, y: 0, scale: 0.78 } : { opacity: 1, y: 0, scale: finalist ? 1.14 : 1 }}
                    transition={{ duration: 0.5, ease: EASE }}
                    className="grid place-items-center rounded-full w-11 h-11"
                    style={{ background: dead ? "transparent" : `radial-gradient(circle at 50% 30%, ${colorWithAlpha(c.color, finalist ? 0.3 : 0.16)}, transparent 72%)` }}
                  >
                    <CinemaSilhouette form={c.form} color={c.color} size={32} dead={dead} />
                  </motion.span>
                );
              })}
            </motion.div>
          ) : (
            <motion.div key="crowned" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="flex flex-col items-center gap-1 max-w-[420px]">
              <motion.span
                layoutId={`sheet-cast-${cast.winner.id}`}
                className="relative grid place-items-center rounded-full w-14 h-14"
                style={{ background: `radial-gradient(circle at 50% 30%, ${colorWithAlpha(accent, 0.32)}, transparent 72%)`, border: `1px solid ${colorWithAlpha(accent, 0.5)}` }}
              >
                <CinemaSilhouette form={cast.winner.form} color={accent} size={40} />
                <motion.span className="absolute -top-1 -right-1" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.25, type: "spring", stiffness: 300, damping: 18 }}>
                  <Sparkles className="w-4 h-4" style={{ color: accent }} />
                </motion.span>
              </motion.span>
              <CrownedName name={agentName.trim() || COPY.yourAgent} />
              {role && <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="typo-caption font-mono uppercase tracking-[0.1em]" style={{ color: accent }}>{role}</motion.span>}
              {mission && !tight && <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.65 }} className="typo-body text-foreground line-clamp-2">{mission}</motion.span>}
            </motion.div>
          )}
        </AnimatePresence>
      </LayoutGroup>
      {children}
    </div>
  );
}
