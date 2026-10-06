/** sheetParts - the small pieces of drafting line language every sheet uses:
 *  a title-block cell, a numbered caption badge, the tick a finished part
 *  carries, text lettered in by hand, the stamp, a dimension line with end
 *  ticks and a centred label chip, and the invisible hit area that makes a
 *  drawn part a door (the shared Button, so the figure keeps its own look). */
import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Button from "@/features/shared/components/buttons/Button";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import { LETTERING } from "../blueprint";

export function Cell({ label, children, dashed = false, className = "", cellRef }: {
  label: string;
  children: ReactNode;
  dashed?: boolean;
  className?: string;
  cellRef?: (el: HTMLElement | null) => void;
}) {
  const { shouldAnimate } = useMotion();
  return (
    <motion.div
      ref={cellRef}
      initial={shouldAnimate ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className={`relative flex min-h-0 min-w-0 flex-col gap-1 px-3 py-2 ${className}`}
      style={{ border: `1px ${dashed ? "dashed" : "solid"} var(--ink-faint)` }}
    >
      <span style={{ ...LETTERING, color: "var(--ink)" }}>{label}</span>
      {children}
    </motion.div>
  );
}

/** A numbered caption badge: open while pending, filled once inked. */
export function Badge({ n, filled, color = "var(--ink)", dashed = false }: { n: string | number; filled: boolean; color?: string; dashed?: boolean }) {
  return (
    <span
      className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1"
      style={{
        ...LETTERING,
        letterSpacing: 0,
        border: `1px ${dashed ? "dashed" : "solid"} ${color}`,
        background: filled ? color : "transparent",
        color: filled ? "var(--background)" : color,
        transition: "background-color 0.5s ease, color 0.5s ease",
      }}
    >
      {n}
    </span>
  );
}

/** The mark a finished part carries. */
export function Tick({ color = "var(--ink)" }: { color?: string }) {
  return (
    <motion.i
      aria-hidden
      initial={{ opacity: 0, scale: 2, rotate: 45 }}
      animate={{ opacity: 0.9, scale: 1, rotate: 45 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="absolute bottom-2 right-3 block h-2.5 w-1.5"
      style={{ borderRight: `1.5px solid ${color}`, borderBottom: `1.5px solid ${color}` }}
    />
  );
}

/** Text lettered in by hand, a few characters at a time (Studio's Lettered). */
export function Lettered({ text }: { text: string }) {
  const { shouldAnimate } = useMotion();
  const [n, setN] = useState(shouldAnimate ? 0 : text.length);
  useEffect(() => {
    if (!shouldAnimate) { setN(text.length); return; }
    setN(0);
    const step = Math.max(1, Math.round(text.length / 60));
    const timer = window.setInterval(() => {
      setN((c) => {
        const next = Math.min(text.length, c + step);
        if (next >= text.length) window.clearInterval(timer);
        return next;
      });
    }, 30);
    return () => window.clearInterval(timer);
  }, [text, shouldAnimate]);
  // Read whole by assistive tech; the lettering is for the eye only.
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {text.slice(0, n)}
        <span className="invisible">{text.slice(n)}</span>
      </span>
    </>
  );
}

/** The stamp that lands on approval, issue or void. Always-mounted live region. */
export function Stamp({ text, tone }: { text: string | null; tone: string }) {
  const { shouldAnimate } = useMotion();
  return (
    <>
      <span className="sr-only" aria-live="polite">{text ?? ""}</span>
      <AnimatePresence>
        {text && (
          <motion.span
            key={text}
            aria-hidden
            initial={shouldAnimate ? { opacity: 0, scale: 2.4, rotate: -8 } : { opacity: 0.92, rotate: -8 }}
            animate={{ opacity: 0.92, scale: 1, rotate: -8 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 16 }}
            className="pointer-events-none absolute right-4 top-3 z-10 rounded-interactive px-2.5 py-1"
            style={{ ...LETTERING, fontSize: 15, letterSpacing: "0.18em", color: tone, border: `2.5px solid ${tone}`, background: "color-mix(in srgb, var(--background) 70%, transparent)" }}
          >
            {text}
          </motion.span>
        )}
      </AnimatePresence>
    </>
  );
}

/** A dimension line: drawn left to right, end ticks, the label on a chip in the middle. */
export function DimensionLine({ label }: { label: string }) {
  const { shouldAnimate } = useMotion();
  return (
    <div className="relative h-4 shrink-0" aria-hidden>
      <motion.div
        initial={shouldAnimate ? { scaleX: 0 } : false}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="absolute inset-x-0 top-2 h-px origin-left"
        style={{ background: "var(--ink-faint)" }}
      />
      <div className="absolute left-0 top-0.5 h-3 w-px" style={{ background: "var(--ink-dim)" }} />
      <div className="absolute right-0 top-0.5 h-3 w-px" style={{ background: "var(--ink-dim)" }} />
      <span className="absolute left-1/2 top-0 -translate-x-1/2 px-1.5" style={{ ...LETTERING, lineHeight: "16px", background: "var(--background)", color: "var(--ink-dim)" }}>
        {label}
      </span>
    </div>
  );
}

/** The invisible door over a drawn part. */
export function HitArea({ label, onPress, testId }: { label: string; onPress: () => void; testId?: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      onClick={onPress}
      data-testid={testId}
      className="absolute inset-0 h-full w-full"
      style={{ padding: 0, borderRadius: "var(--radius-interactive)" }}
    />
  );
}
