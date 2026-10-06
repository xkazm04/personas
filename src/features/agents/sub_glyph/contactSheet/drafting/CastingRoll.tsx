/** CastingRoll - Cinema's casting call, redrawn as a parts roll under the
 *  figure. Twelve candidates are pencilled in ink; each one eliminated is
 *  struck through and greys out, the finalists are inked in their own
 *  colours, and at the crowning the winner flies (shared layoutId) up into
 *  the sigil's core ring, where `CoreFigure` holds it. */
import { AnimatePresence, motion } from "framer-motion";
import { CinemaSilhouette } from "@/features/agents/sub_glyph/cinemaShared";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { LETTERING } from "../blueprint";
import type { CinemaCast } from "../cinema/useCinemaCast";
import { EASE } from "../cinema/cinemaMotion";
import { COPY } from "./copy";

export const castLayoutId = (id: string) => `dsh-cast-${id}`;

export function CastingRoll({ cast }: { cast: CinemaCast }) {
  const live = cast.candidates.filter((c) => !cast.eliminated.has(c.id)).length;
  const deliberating = cast.phase === "deliberation";
  return (
    <AnimatePresence initial={false}>
      {cast.phase !== "crowned" && (
        <motion.div key="roll" exit={{ opacity: 0 }} transition={{ duration: 0.35 }} className="flex flex-col items-center gap-1">
          <span style={{ ...LETTERING, color: "var(--ink)" }}>
            {COPY.casting} · {deliberating ? COPY.finalists(live) : COPY.candidates(cast.candidates.length)}
          </span>
          <div className="flex flex-wrap justify-center gap-x-1.5">
            {cast.candidates.map((c, i) => {
              const dead = cast.eliminated.has(c.id);
              const finalist = deliberating && cast.finalists.has(c.id);
              return (
                <motion.span
                  key={c.id}
                  layoutId={castLayoutId(c.id)}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: dead ? 0.35 : 1, y: 0, scale: finalist ? 1.12 : 1 }}
                  transition={{ duration: 0.5, ease: EASE, delay: i * 0.04 }}
                  className="relative grid h-8 w-7 place-items-center"
                >
                  <CinemaSilhouette form={c.form} color={finalist ? c.color : "var(--ink-dim)"} size={24} dead={dead} />
                  {dead && (
                    <svg aria-hidden className="absolute inset-0" viewBox="0 0 28 32">
                      <motion.path d="M 3 27 L 25 5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4 }} stroke="var(--ink-dim)" strokeWidth={1.2} fill="none" />
                    </svg>
                  )}
                  {finalist && <i aria-hidden className="absolute -bottom-0.5 h-px w-5" style={{ background: colorWithAlpha(c.color, 0.8) }} />}
                </motion.span>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
