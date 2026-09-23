/** LoupeHeader - the strip across the top of an inner layer, laid out like a
 *  length of film base: the way back (with its Esc key shown), the frame's
 *  edge number, the frame's name in its colour, where that frame stands right
 *  now, and on the far right where you are in the build (the question count
 *  inside a question round, otherwise the scene). */
import { ArrowLeft } from "lucide-react";
import Button from "@/features/shared/components/buttons/Button";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { COPY } from "./copy";

export interface LoupeHead {
  /** Edge number, "01".."08", or "00" for the centre frame's pages. */
  code: string;
  title: string;
  /** Where this frame stands; `strong` is for "needs you". */
  status: { label: string; strong: boolean } | null;
  /** Right-hand context: "Question 2 of 4", or the scene. */
  context: string;
}

function StatusChip({ label, strong, color }: { label: string; strong: boolean; color: string }) {
  return (
    <span
      className="typo-caption px-2 py-0.5 rounded-full border whitespace-nowrap"
      style={strong
        ? { color, borderColor: colorWithAlpha(color, 0.6), background: colorWithAlpha(color, 0.12) }
        : { color: "var(--foreground)", borderColor: "color-mix(in srgb, var(--foreground) 18%, transparent)" }}
    >
      {label}
    </span>
  );
}

export function LoupeHeader({ head, color, onClose }: { head: LoupeHead; color: string; onClose: () => void }) {
  return (
    <header
      className="flex items-center gap-3 px-[18px] py-3 2xl:py-4 border-b border-card-border flex-shrink-0"
      style={{ background: `linear-gradient(90deg, ${colorWithAlpha(color, 0.16)}, ${colorWithAlpha(color, 0.04)} 55%, transparent)` }}
    >
      <Button variant="secondary" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={onClose} aria-label={COPY.back}>
        <kbd className="font-mono typo-caption px-1.5 rounded-[4px] border border-card-border text-foreground">{COPY.loupe.esc}</kbd>
      </Button>
      <span className="font-mono typo-body tracking-[0.14em]" style={{ color }} aria-hidden>
        {`▸ ${head.code}`}
      </span>
      <h2 className="m-0 min-w-0 truncate typo-heading-lg font-semibold uppercase tracking-[0.08em]" style={{ color }}>
        {head.title}
      </h2>
      {head.status && <StatusChip label={head.status.label} strong={head.status.strong} color={color} />}
      <span className="ml-auto hidden md:inline font-mono typo-caption uppercase tracking-[0.12em] text-foreground whitespace-nowrap">
        {head.context}
      </span>
    </header>
  );
}
