/** DraftPart - one drawn part of a sheet: a dimension region on sheet 1, a
 *  sub-part on a dimension's own sheet. Same line language at every depth:
 *  dashed while pending, hatched under the pen while drafting, dashed in the
 *  dimension's colour while it asks for you, inked solid in that colour with a
 *  tick once done, and ruled in the error colour when it failed. It is wiped
 *  in from its top-left corner the beat it is drawn; until then it is not
 *  rendered at all, and since every part is placed absolutely its slot holds
 *  and nothing around it reflows (the spacer trick). */
import { memo, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import { LETTERING } from "../blueprint";
import type { Box, Ink } from "./sheetGeometry";
import { Badge, HitArea, Tick } from "./sheetParts";
import { COPY } from "./copy";

interface DraftPartProps {
  box: Box;
  /** Caption number: "3" on sheet 1, "3.2" on sheet 3. */
  n: string;
  label: string;
  ink: Ink;
  color: string;
  /** One value line (the frame caption, a part's detail). */
  caption?: string | null;
  /** A small mark before the label (a brand tile, a channel icon). */
  mark?: ReactNode;
  partRef?: (el: HTMLElement | null) => void;
  /** Makes the part a door (sheet 1's regions open their sheet). */
  onOpen?: () => void;
  openLabel?: string;
  testId?: string;
}

const WORD: Partial<Record<Ink, string>> = { drafting: COPY.ink.drafting, asking: COPY.ink.asking, error: COPY.ink.error };

export function inkLine(ink: Ink, color: string): string {
  if (ink === "done" || ink === "asking") return color;
  if (ink === "error") return "var(--status-error)";
  return ink === "drafting" ? "var(--ink-strong)" : "var(--ink-dim)";
}

export const DraftPart = memo(function DraftPart({ box, n, label, ink, color, caption, mark, partRef, onOpen, openLabel, testId }: DraftPartProps) {
  const { shouldAnimate } = useMotion();
  const line = inkLine(ink, color);
  const word = WORD[ink];
  return (
    <motion.div
      ref={partRef}
      initial={shouldAnimate ? { clipPath: "inset(0 100% 100% 0)" } : false}
      animate={{ clipPath: "inset(0 0% 0% 0)" }}
      transition={{ duration: 0.9, ease: "easeOut" }}
      className="absolute overflow-hidden rounded-interactive"
      style={{
        left: box.x, top: box.y, width: box.w, height: box.h,
        border: `${ink === "asking" ? 1.5 : 1}px ${ink === "pending" || ink === "asking" ? "dashed" : "solid"} ${line}`,
        background: ink === "done" ? `color-mix(in srgb, ${color} 8%, var(--background))` : "color-mix(in srgb, var(--background) 72%, transparent)",
        boxShadow: ink === "drafting" ? "0 0 0 1px var(--ink-faint), 0 0 24px color-mix(in srgb, var(--bp-accent) 18%, transparent)" : undefined,
        transition: "border-color 0.6s ease, background-color 0.6s ease",
      }}
    >
      {ink === "drafting" && <div aria-hidden className="drafting-hatch pointer-events-none absolute inset-0" />}
      <div className="relative flex min-w-0 items-center gap-2 px-2 pt-1.5">
        <Badge n={n} filled={ink === "done"} color={ink === "pending" || ink === "drafting" ? "var(--ink)" : line} dashed={ink === "pending"} />
        {mark}
        <span className="min-w-0 truncate" style={{ ...LETTERING, color: ink === "done" ? color : "var(--ink-strong)" }}>{label}</span>
        {word && (
          <span className={`ml-auto shrink-0 typo-caption ${ink === "error" ? "text-status-error" : ink === "asking" ? "text-status-warning" : ""}`}>
            {word}
          </span>
        )}
      </div>
      {caption && <p className="relative truncate px-2 pt-0.5 typo-body text-foreground">{caption}</p>}
      {ink === "done" && <Tick color={color} />}
      {onOpen && <HitArea label={openLabel ?? label} onPress={onOpen} testId={testId} />}
    </motion.div>
  );
});
