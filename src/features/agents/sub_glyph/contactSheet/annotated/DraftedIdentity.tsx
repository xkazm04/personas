/** DraftedIdentity - Cinema's casting and coronation in the centre cell, with
 *  the crowning drawn rather than developed. The crowd of silhouettes is cast
 *  down to finalists exactly as in Cinema; when the real identity arrives the
 *  winner flies up into a registration ring that is inked around it, its name
 *  is LETTERED in behind a caret (Studio's brief), and the role and mission
 *  are set on hairline underlines with dimension ticks at their ends.
 *  `children` is the action panel, unchanged. */
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { CinemaSilhouette } from "@/features/agents/sub_glyph/cinemaShared";
import { useAgentStore } from "@/stores/agentStore";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import { LETTERING } from "../blueprint";
import type { CinemaCast } from "../cinema/useCinemaCast";
import { EASE } from "../cinema/cinemaMotion";
import { COPY as CINEMA } from "../cinema/copy";
import { Lettered } from "./Lettered";

interface DraftedIdentityProps {
  cast: CinemaCast;
  agentName: string;
  tight?: boolean;
  children?: React.ReactNode;
}

/** A hairline set under a line of text, drawn left to right, ticked at both ends. */
function Underlined({ delay, children }: { delay: number; children: React.ReactNode }) {
  const { shouldAnimate } = useMotion();
  const enter = shouldAnimate ? { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, transition: { delay, duration: 0.45 } } : {};
  return (
    <motion.span {...enter} className="relative inline-block max-w-full px-2 pb-1.5">
      {children}
      <motion.i
        aria-hidden
        className="absolute inset-x-0 bottom-0 block h-px origin-left"
        style={{ background: "var(--ink-dim)" }}
        initial={shouldAnimate ? { scaleX: 0 } : false}
        animate={{ scaleX: 1 }}
        transition={{ delay: delay + 0.2, duration: 0.6, ease: "easeOut" }}
      />
      {["left-0", "right-0"].map((side) => (
        <i key={side} aria-hidden className={`absolute ${side} -bottom-[3px] block h-[7px] w-px`} style={{ background: "var(--ink)" }} />
      ))}
    </motion.span>
  );
}

/** The ring a crowned persona is drawn inside: a circle inked on, with four
 *  registration ticks, in the crowned colour. */
function RegistrationRing({ color }: { color: string }) {
  const { shouldAnimate } = useMotion();
  return (
    <svg aria-hidden viewBox="0 0 64 64" className="absolute -inset-1.5 overflow-visible">
      <motion.circle
        cx={32} cy={32} r={29} fill="none" stroke={color} strokeWidth={1}
        initial={shouldAnimate ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, delay: 0.15, ease: "easeInOut" }}
        style={{ rotate: -90, transformOrigin: "32px 32px" }}
      />
      {[[32, -3, 32, 5], [32, 59, 32, 67], [-3, 32, 5, 32], [59, 32, 67, 32]].map(([x1, y1, x2, y2]) => (
        <line key={`${x1}-${y1}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink-dim)" strokeWidth={1} />
      ))}
    </svg>
  );
}

export function DraftedIdentity({ cast, agentName, tight = false, children }: DraftedIdentityProps) {
  const core = useAgentStore((s) => s.buildBehaviorCore);
  const role = core?.identity?.role ?? null;
  const mission = core?.mission ?? null;
  const crowned = cast.phase === "crowned";
  const accent = cast.winner.color;
  const name = agentName.trim() || CINEMA.yourAgent;

  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-3 text-center" data-testid="annotated-identity">
      <LayoutGroup id="annotated-cast">
        <AnimatePresence initial={false} mode="popLayout">
          {!crowned ? (
            <motion.div key="crowd" exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.35 }} className="flex max-w-[330px] flex-wrap justify-center gap-x-2.5 gap-y-1">
              {cast.candidates.map((c) => {
                const dead = cast.eliminated.has(c.id);
                const finalist = cast.phase === "deliberation" && cast.finalists.has(c.id);
                return (
                  <motion.span
                    key={c.id}
                    layoutId={`annotated-cast-${c.id}`}
                    initial={{ opacity: 0, y: 10, scale: 0.7 }}
                    animate={dead ? { opacity: 0.24, y: 0, scale: 0.78 } : { opacity: 1, y: 0, scale: finalist ? 1.14 : 1 }}
                    transition={{ duration: 0.5, ease: EASE }}
                    className="grid h-11 w-11 place-items-center rounded-full"
                    style={{ border: finalist ? "1px dashed var(--ink-dim)" : "1px solid transparent" }}
                  >
                    <CinemaSilhouette form={c.form} color={c.color} size={32} dead={dead} />
                  </motion.span>
                );
              })}
            </motion.div>
          ) : (
            <motion.div key="crowned" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="flex max-w-[440px] flex-col items-center gap-1.5">
              <motion.span
                layoutId={`annotated-cast-${cast.winner.id}`}
                className="relative grid h-14 w-14 place-items-center rounded-full"
                style={{ background: `radial-gradient(circle at 50% 30%, ${colorWithAlpha(accent, 0.22)}, transparent 72%)` }}
              >
                <RegistrationRing color={accent} />
                <CinemaSilhouette form={cast.winner.form} color={accent} size={40} />
              </motion.span>
              <span className="typo-title-lg text-foreground" data-testid="annotated-crowned-name">
                <Lettered text={name} startDelay={350} />
              </span>
              {role && (
                <Underlined delay={0.9}>
                  <span style={{ ...LETTERING, color: accent }}>{role}</span>
                </Underlined>
              )}
              {mission && !tight && (
                <Underlined delay={1.15}>
                  <span className="line-clamp-2 typo-body text-foreground">{mission}</span>
                </Underlined>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </LayoutGroup>
      {children}
    </div>
  );
}
