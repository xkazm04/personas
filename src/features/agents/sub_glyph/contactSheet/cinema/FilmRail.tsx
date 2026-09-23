/** FilmRail — the sheet's bottom progress bar: a sprocket strip, one hole per
 *  five seconds of machine time, six minutes wide (the top of the real 3-6
 *  min range). It reads the same clock as the centre's action panel, so the
 *  two always agree: holes expose only while the build or the screening
 *  works, tinted by which one it was, and the strip stands still (and says
 *  so) while the build waits for you. A thin marker shows where the first
 *  pass usually lands while casting. */
import { memo } from "react";
import { motion } from "framer-motion";
import { COPY } from "./copy";
import { kindAt, type ClockKind, type ClockMark } from "./useSheetClock";
import { timecode } from "./sheetModel";

const HOLES = 72;
const PER = 5;
const TOTAL = HOLES * PER;
const WINDOW_FROM = 50;
const WINDOW_TO = 155;

const HOLE_TINT: Record<ClockKind, string> = {
  build: "var(--cinema-accent)",
  test: "var(--status-success)",
};

interface FilmRailProps {
  scene: string;
  elapsed: number;
  marks: ClockMark[];
  showWindow: boolean;
  /** What the machine is doing now; null while it waits (the strip pauses). */
  running?: ClockKind | null;
  /** Time before this draft was first seen is unknown. */
  partial?: boolean;
}

export const FilmRail = memo(function FilmRail({ scene, elapsed, marks, showWindow, running, partial = false }: FilmRailProps) {
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
      <span className="typo-caption tabular-nums whitespace-nowrap min-w-[150px] text-right text-foreground">
        {running === null && elapsed > 0 && <span className="mr-2">{COPY.clock.paused}</span>}
        {COPY.buildTime} <span className="font-mono">{partial && elapsed < 1 ? COPY.clock.unknown : timecode(elapsed)}</span>
      </span>
    </div>
  );
});
