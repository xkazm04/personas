/** FilmRail — the sheet's bottom progress bar: a sprocket strip, one hole per
 *  five real seconds, six minutes wide (the top of the real 3-6 min range).
 *  Holes expose only as honest time passes, tinted by whose time it was, and
 *  a thin marker shows where the first pass usually lands while casting. */
import { memo } from "react";
import { motion } from "framer-motion";
import { COPY } from "./copy";
import { kindAt, type ClockMark } from "./useSheetClock";
import { timecode } from "./sheetModel";

const HOLES = 72;
const PER = 5;
const TOTAL = HOLES * PER;
const WINDOW_FROM = 50;
const WINDOW_TO = 155;

const HOLE_TINT: Record<ClockMark["kind"], string> = {
  build: "var(--cinema-accent)",
  you: "#60a5fa",
  test: "#34d399",
};

interface FilmRailProps {
  scene: string;
  elapsed: number;
  marks: ClockMark[];
  showWindow: boolean;
}

export const FilmRail = memo(function FilmRail({ scene, elapsed, marks, showWindow }: FilmRailProps) {
  const exposed = Math.min(HOLES, Math.floor(elapsed / PER));
  return (
    <div className="flex-shrink-0 h-10 flex items-center gap-4 px-1" aria-label={COPY.buildTime}>
      <motion.span
        key={scene}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="typo-caption font-mono tracking-[0.08em] whitespace-nowrap min-w-[170px]"
        style={{ color: "var(--cinema-accent)" }}
      >
        {scene}
      </motion.span>
      <div className="relative flex-1 h-4 flex items-center gap-[3px]" aria-hidden>
        {Array.from({ length: HOLES }, (_, i) => {
          const kind = i < exposed ? kindAt(marks, i * PER) : null;
          return (
            <i
              key={i}
              className="flex-1 h-2 rounded-[2px] transition-colors duration-300"
              style={{
                background: kind
                  ? `color-mix(in srgb, ${HOLE_TINT[kind]} 72%, transparent)`
                  : "color-mix(in srgb, var(--foreground) 9%, transparent)",
              }}
            />
          );
        })}
        <motion.span
          className="absolute -top-1 h-[3px] rounded-full"
          initial={false}
          animate={{ opacity: showWindow ? 1 : 0 }}
          style={{
            left: `${(WINDOW_FROM / TOTAL) * 100}%`,
            width: `${((WINDOW_TO - WINDOW_FROM) / TOTAL) * 100}%`,
            background: "color-mix(in srgb, var(--cinema-accent) 45%, transparent)",
          }}
        />
      </div>
      <span className="typo-caption font-mono tabular-nums whitespace-nowrap min-w-[150px] text-right text-foreground">
        {COPY.buildTime} {timecode(elapsed)}
      </span>
    </div>
  );
});
