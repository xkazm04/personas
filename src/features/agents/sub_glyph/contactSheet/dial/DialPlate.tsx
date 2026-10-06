/** The dial's furniture, in the drawing's corners. Top-left, the KEY to its
 *  ink (what a dashed, hatched and inked part means), so the dial reads at
 *  first sight. Bottom-right, the maker's plate: the instrument's serial and
 *  name, how many marks its rim carries, the brief lettered in, and a stamp
 *  that lands when the persona is screened and when it goes into service. A
 *  corner with no room for its furniture leaves it out. */
import { AnimatePresence, motion } from "framer-motion";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import { LETTERING } from "../blueprint";
import { Lettered } from "./Lettered";
import { COPY } from "./copy";

function Swatch({ kind }: { kind: "pending" | "drafting" | "done" }) {
  return (
    <span
      aria-hidden
      className={`relative inline-block h-2.5 w-5 overflow-hidden rounded-interactive ${kind === "drafting" ? "drafting-hatch" : ""}`}
      style={{
        border: `1px ${kind === "pending" ? "dashed" : "solid"} ${kind === "pending" ? "var(--ink-dim)" : "var(--ink-strong)"}`,
        background: kind === "done" ? "color-mix(in srgb, var(--ink) 45%, transparent)" : undefined,
      }}
    />
  );
}

export function DialLegend({ room }: { room: number }) {
  if (room < 44) return null;
  return (
    <ul className="pointer-events-none absolute left-3 top-2 m-0 flex list-none flex-col gap-1 p-0" aria-label={COPY.root}>
      {(["pending", "drafting", "done"] as const).map((k) => (
        <li key={k} className="flex items-center gap-2">
          <Swatch kind={k} />
          <span style={{ ...LETTERING, fontSize: 10, color: "var(--ink-dim)" }}>{COPY.legend[k]}</span>
        </li>
      ))}
    </ul>
  );
}

interface DialPlateProps {
  top: number;
  width: number;
  stageH: number;
  name: string;
  serial: string | null;
  brief: string;
  rimCount: number;
  stamp: string | null;
}

export function DialPlate({ top, width, stageH, name, serial, brief, rimCount, stamp }: DialPlateProps) {
  const { shouldAnimate } = useMotion();
  if (stageH - top < 54 || width < 140) return null;
  return (
    <motion.div
      className="absolute bottom-2 right-3 flex flex-col gap-0.5 px-2.5 py-1.5"
      style={{ width, border: "1px solid var(--ink-dim)", background: "color-mix(in srgb, var(--background) 82%, transparent)" }}
      initial={shouldAnimate ? { clipPath: "inset(0 0 100% 0)", opacity: 0.4 } : false}
      animate={{ clipPath: "inset(0 0 0% 0)", opacity: 1 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
    >
      <span className="flex items-baseline gap-2 min-w-0">
        {width >= 200 && <span className="shrink-0" style={{ ...LETTERING, fontSize: 10, color: "var(--ink)" }}>{serial ? COPY.plate.serial(serial) : COPY.plate.schematic}</span>}
        <span className="truncate typo-body text-foreground">{name}</span>
        <span className="ml-auto shrink-0 typo-code">{COPY.plate.rim(rimCount)}</span>
      </span>
      {brief && (
        <span className="truncate typo-caption">
          <span style={{ ...LETTERING, fontSize: 10, color: "var(--ink)" }}>{COPY.plate.brief}</span>{" "}
          <Lettered text={brief} />
        </span>
      )}
      <span className="sr-only" aria-live="polite">{stamp ?? ""}</span>
      <AnimatePresence>
        {stamp && (
          <motion.span
            key={stamp}
            aria-hidden
            initial={shouldAnimate ? { opacity: 0, scale: 2.4, rotate: -8 } : { opacity: 0.92, rotate: -8 }}
            animate={{ opacity: 0.92, scale: 1, rotate: -8 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 16 }}
            className="absolute -top-9 right-2 rounded-interactive px-2.5 py-1"
            style={{ ...LETTERING, fontSize: 15, letterSpacing: "0.18em", color: "var(--ink-strong)", border: "2.5px solid var(--ink-strong)", background: "color-mix(in srgb, var(--background) 70%, transparent)" }}
          >
            {stamp}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
