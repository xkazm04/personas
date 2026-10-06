/** InkBadge - the numbered caption badge of the drawing (Studio's region and
 *  goal numbers), in the dial's five ink states: dashed ring still to draw,
 *  hatched while drafting, a breathing ring while it needs you, filled when
 *  inked, the error ink when it did not resolve. */
import { LETTERING } from "../blueprint";
import type { Ink } from "./dialMarks";

interface InkBadgeProps {
  num: string;
  ink: Ink;
  color: string;
  populated: boolean;
  size?: number;
}

export function InkBadge({ num, ink, color, populated, size = 20 }: InkBadgeProps) {
  const solid = ink === "done" || ink === "error";
  const fill = ink === "error" ? "var(--status-error)" : populated ? color : "var(--ink)";
  return (
    <span
      aria-hidden
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${ink === "asking" ? "dial-asking" : ""}`}
      style={{
        ...LETTERING,
        fontSize: 10,
        letterSpacing: 0,
        width: size,
        height: size,
        background: solid ? fill : "transparent",
        border: ink === "pending" ? "1px dashed var(--ink-dim)" : `1px solid ${ink === "asking" ? color : solid ? fill : "var(--ink-strong)"}`,
        color: solid ? "var(--background)" : ink === "asking" ? color : ink === "pending" ? "var(--ink-dim)" : "var(--ink-strong)",
        transition: "background 0.5s ease, border-color 0.5s ease, color 0.5s ease",
      }}
    >
      {ink === "drafting" && <span className="drafting-hatch absolute inset-0" />}
      <span className="relative">{num}</span>
    </span>
  );
}
