/** LetteredSection - one labelled zone on the exploded view's bus line: a
 *  short branch off the bus, a lettered badge (A, B, C...) in the opened
 *  dimension's colour and an engraved title, then the zone's content. It
 *  slides in off the bus, one zone per beat. Shared by the dimension's
 *  controls and by the question round, so both read as the same drawing. */
import { motion } from "framer-motion";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import { LETTERING } from "../../blueprint";
import { tint } from "../tint";

interface LetteredSectionProps {
  letter: string;
  title: string | null;
  /** Position on the bus: staggers the entrance. */
  i: number;
  color: string;
  /** Anything beside the title (a progress row). */
  aside?: React.ReactNode;
  children: React.ReactNode;
}

export function LetteredSection({ letter, title, i, color, aside, children }: LetteredSectionProps) {
  const { shouldAnimate } = useMotion();
  return (
    <motion.section
      className="relative flex flex-col gap-2 pl-5"
      initial={shouldAnimate ? { opacity: 0, x: 14 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.45, delay: 0.55 + i * 0.12, ease: "easeOut" }}
    >
      <span aria-hidden className="absolute -left-px top-[11px] h-px w-3" style={{ background: tint(color, 0.5) }} />
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          style={{ ...LETTERING, letterSpacing: 0, fontSize: 10, background: color, color: "var(--background)" }}
        >
          {letter}
        </span>
        {title && <span style={{ ...LETTERING, color }}>{title}</span>}
        {aside}
      </span>
      {children}
    </motion.section>
  );
}

/** The bus the sections hang off: a hairline down the column, in the colour. */
export function SectionBus({ color, busRef, children }: { color: string; busRef: (el: HTMLDivElement | null) => void; children: React.ReactNode }) {
  return (
    <div ref={busRef} className="relative my-auto flex flex-col gap-5 py-1" style={{ borderLeft: `1px solid ${tint(color, 0.5)}` }}>
      {children}
    </div>
  );
}
