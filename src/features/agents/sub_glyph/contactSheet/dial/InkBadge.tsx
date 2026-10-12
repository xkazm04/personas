/** InkBadge - the numbered caption badge of the drawing (Studio's region and
 *  goal numbers), in the dial's five ink states: dashed ring still to draw,
 *  hatched while drafting, a breathing ring while it needs you, filled when
 *  inked, the error ink when it did not resolve; always in the dimension's
 *  own colour, fullest once it carries metadata. */
import { LETTERING } from "../blueprint";
import { tint } from "./tint";
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
  const fill = ink === "error" ? "var(--status-error)" : populated ? color : tint(color, 0.6);
  const faint = tint(color, 0.55);
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
        border: ink === "pending" ? `1px dashed ${faint}` : `1px solid ${solid ? fill : color}`,
        color: solid ? "var(--background)" : ink === "pending" ? faint : color,
        transition: "background 0.5s ease, border-color 0.5s ease, color 0.5s ease",
      }}
    >
      {ink === "drafting" && <span className="drafting-hatch absolute inset-0" />}
      <span className="relative">{num}</span>
    </span>
  );
}
