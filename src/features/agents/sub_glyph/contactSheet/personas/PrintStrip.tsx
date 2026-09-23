/** PrintStrip - a strip of prints between sprocket rules: the draft's
 *  capabilities, then the tested tools with a PASSED / FAILED stamp. */
import { motion } from "framer-motion";
import { RevealItem } from "@/features/shared/components/display/RevealItem";
import { useRevealTracker } from "@/hooks/utility/interaction/useProgressiveReveal";
import { COPY } from "./copy";

export type PrintStatus = "idle" | "running" | "passed" | "failed" | "skipped";

export interface PrintItem {
  id: string;
  title: string;
  status?: PrintStatus;
}

const STAMP: Partial<Record<PrintStatus, { text: string; tone: string }>> = {
  passed: { text: COPY.stampPassed, tone: "text-status-success" },
  failed: { text: COPY.stampFailed, tone: "text-status-error" },
  skipped: { text: COPY.stampSkipped, tone: "text-muted" },
};

const FRAME: Record<PrintStatus, string> = {
  idle: "border-primary/40 bg-primary/10",
  running: "border-status-processing bg-status-processing/10",
  passed: "border-status-success/50 bg-status-success/10",
  failed: "border-status-error/60 bg-status-error/10",
  skipped: "border-card-border bg-secondary/40",
};

const MAX = 5;

export function PrintStrip({ items, resetKey }: { items: PrintItem[]; resetKey: string }) {
  const enter = useRevealTracker(resetKey);
  if (items.length === 0) return null;
  const shown = items.slice(0, MAX);
  return (
    <div className="flex items-start justify-center gap-2 px-3 py-2 rounded-card bg-secondary/40 border-y-2 border-dotted border-foreground/15 max-w-full">
      {shown.map((it, i) => {
        const status = it.status ?? "idle";
        const stamp = STAMP[status];
        return (
          <RevealItem key={it.id} revealId={it.id} order={i} {...enter} className="w-28 flex flex-col items-center gap-1.5">
            <span className={`relative w-full h-10 rounded-interactive border grid place-items-center overflow-hidden transition-colors duration-300 ${FRAME[status]}`}>
              {stamp ? (
                <motion.span
                  key={status}
                  initial={{ scale: 2, opacity: 0, rotate: -8 }}
                  animate={{ scale: 1, opacity: 1, rotate: -8 }}
                  transition={{ type: "spring", stiffness: 420, damping: 18 }}
                  className={`typo-label px-1.5 border-2 border-current rounded-interactive ${stamp.tone}`}
                >
                  {stamp.text}
                </motion.span>
              ) : (
                <span className="typo-code text-foreground">{String(i + 1).padStart(2, "0")}</span>
              )}
            </span>
            <span className="typo-caption text-center truncate w-full">{it.title}</span>
          </RevealItem>
        );
      })}
      {items.length > MAX && <span className="self-center typo-label text-muted">+{items.length - MAX}</span>}
    </div>
  );
}
