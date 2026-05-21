import { useState } from "react";
import { motion } from "framer-motion";
import { ActivityPulseIcon } from "@/features/shared/components/icons/ActivityPulseIcon";
import { useOverviewStore } from "@/stores/overviewStore";
import { useTranslation } from "@/i18n/useTranslation";
import { PersonaMonitor } from "@/features/monitor";

/**
 * Titlebar entry point for the Persona Monitor.
 *
 * The badge counts **attention** — pending human reviews plus processes
 * blocked on the user (`input_required` / `draft_ready`). Live work
 * (`running`) is shown instead as a pulsing ring around the icon, so colour
 * answers "do I need to act?" and the pulse answers "is the fleet busy?".
 */
export default function ProcessActivityIndicator() {
  const { t, tx } = useTranslation();
  const [monitorOpen, setMonitorOpen] = useState(false);

  const pendingReviewCount = useOverviewStore((s) => s.pendingReviewCount);
  // Derived counts — selectors return primitives, so with Object.is equality
  // the button re-renders only when a count/flag actually transitions.
  const actionCount = useOverviewStore((s) =>
    Object.values(s.activeProcesses).filter(
      (p) => p.status === "input_required" || p.status === "draft_ready",
    ).length,
  );
  const running = useOverviewStore((s) =>
    Object.values(s.activeProcesses).some((p) => p.status === "running"),
  );

  const attention = pendingReviewCount + actionCount;

  return (
    <>
      <button
        className="titlebar-btn relative"
        data-testid="titlebar-process-activity"
        onClick={() => setMonitorOpen((v) => !v)}
        aria-label={attention > 0 ? tx(t.monitor.titlebar_attention, { count: attention }) : t.monitor.titlebar}
        title={attention > 0 ? tx(t.monitor.titlebar_tooltip, { count: attention }) : t.monitor.titlebar}
      >
        {running && (
          <motion.span
            aria-hidden
            className="absolute inset-[5px] rounded-lg border border-primary/60 pointer-events-none"
            animate={{ opacity: [0.15, 0.7, 0.15], scale: [0.82, 1.1, 0.82] }}
            transition={{ duration: 1.9, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <ActivityPulseIcon
          width={22}
          height={22}
          strokeWidth={1.5}
          className={attention > 0 ? "text-amber-400" : running ? "text-primary" : "text-foreground"}
        />
        {attention > 0 && (
          <span className="absolute top-2 right-1.5 min-w-[16px] h-[16px] px-[3px] flex items-center justify-center text-[9px] font-bold leading-none rounded-full bg-amber-500/25 text-amber-300 shadow-elevation-1">
            {attention > 9 ? "9+" : attention}
          </span>
        )}
      </button>
      {monitorOpen && <PersonaMonitor onClose={() => setMonitorOpen(false)} />}
    </>
  );
}
