import { AnimatePresence, motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/utility/interaction/useMotion";
import { ActivityPulseIcon } from "@/features/shared/components/icons/ActivityPulseIcon";
import { useOverviewStore } from "@/stores/overviewStore";
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { useTranslation } from "@/i18n/useTranslation";
import { PersonaMonitor } from "@/features/shared/components/layout/monitor";
import { QuickAnswerPopover } from "@/features/shared/components/layout/quick-answer/QuickAnswerPopover";

/**
 * Titlebar entry point for the Quick Answer popover and the Persona Monitor.
 *
 * The badge counts **attention** — pending build/adoption questions, human
 * reviews, unread messages, and drafts ready to test/promote. Live work
 * (`running`) is shown instead as a pulsing ring around the icon, so colour
 * answers "do I need to act?" and the pulse answers "is the fleet busy?".
 *
 * Click is **split**: when there's something to answer directly (questions or
 * reviews) the click opens the lightweight Quick Answer popover so the user can
 * respond and keep working; otherwise it opens the full-screen Monitor (fleet
 * view / drafts / messages). The popover itself links back to the Monitor.
 * Open state lives in the system store so Athena can open it too (see
 * `uiSlice.headerOverlay`).
 */
export default function ProcessActivityIndicator() {
  const { t, tx } = useTranslation();
  // The pulse loops on opacity, which the global <MotionConfig reducedMotion>
  // does NOT disable (it only stops one-shot transforms). Gate it explicitly.
  const prefersReducedMotion = useReducedMotion();
  // Header-overlay controller (mutually exclusive with Notifications; closed by
  // route nav / Back / Esc). This button owns 'monitor' and 'quick-answer'.
  const headerOverlay = useSystemStore((s) => s.headerOverlay);
  const setHeaderOverlay = useSystemStore((s) => s.setHeaderOverlay);
  const overlayOpen = headerOverlay === 'monitor' || headerOverlay === 'quick-answer';

  const pendingReviewCount = useOverviewStore((s) => s.pendingReviewCount);
  const unreadMessageCount = useOverviewStore((s) => s.unreadMessageCount);
  // Derived counts — selectors return primitives, so with Object.is equality
  // the button re-renders only when a count/flag actually transitions.
  // Drafts ready to test/promote — a "needs you" state that lives in the Monitor.
  const draftReadyCount = useOverviewStore((s) =>
    Object.values(s.activeProcesses).filter((p) => p.status === "draft_ready").length,
  );
  const running = useOverviewStore((s) =>
    Object.values(s.activeProcesses).some((p) => p.status === "running"),
  );
  // Pending build/adoption questions, read straight from the build slice — the
  // single source of truth. Works whether or not the matrix surface is mounted,
  // so it neither undercounts when the user is elsewhere nor double-counts the
  // `input_required` process the matrix surface pushes while mounted.
  const questionCount = useAgentStore((s) => {
    let n = 0;
    for (const sess of Object.values(s.buildSessions)) {
      if (sess.phase === "awaiting_input") n += sess.pendingQuestions.length;
    }
    return n;
  });

  // What the Quick Answer popover can act on directly (v1: questions + reviews).
  const quickCount = questionCount + pendingReviewCount;
  const attention = quickCount + unreadMessageCount + draftReadyCount;

  return (
    <>
      <button
        className={`titlebar-btn relative ${overlayOpen ? 'titlebar-btn-active' : ''}`}
        data-testid="titlebar-process-activity"
        aria-pressed={overlayOpen}
        onClick={() => {
          if (overlayOpen) { setHeaderOverlay('none'); return; }
          // Something to answer → fast popover; otherwise the full Monitor.
          setHeaderOverlay(quickCount > 0 ? 'quick-answer' : 'monitor');
        }}
        aria-label={attention > 0 ? tx(t.monitor.titlebar_attention, { count: attention }) : t.monitor.titlebar}
        title={attention > 0 ? tx(t.monitor.titlebar_tooltip, { count: attention }) : t.monitor.titlebar}
      >
        {running && (
          prefersReducedMotion ? (
            // Static "busy" affordance — a steady ring at the pulse's mid opacity.
            <span
              aria-hidden
              className="absolute inset-[5px] rounded-lg border border-primary/60 opacity-50 pointer-events-none"
            />
          ) : (
            <motion.span
              aria-hidden
              className="absolute inset-[5px] rounded-lg border border-primary/60 pointer-events-none"
              animate={{ opacity: [0.15, 0.7, 0.15], scale: [0.82, 1.1, 0.82] }}
              transition={{ duration: 1.9, repeat: Infinity, ease: "easeInOut" }}
            />
          )
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
      {/* AnimatePresence so the overlay's motion.div plays its fade-in on open
          AND its exit fade-out on close (a bare conditional unmounts instantly,
          skipping the exit animation). */}
      <AnimatePresence>
        {headerOverlay === 'monitor' && <PersonaMonitor onClose={() => setHeaderOverlay('none')} />}
        {headerOverlay === 'quick-answer' && (
          <QuickAnswerPopover
            onClose={() => setHeaderOverlay('none')}
            onOpenMonitor={() => setHeaderOverlay('monitor')}
          />
        )}
      </AnimatePresence>
    </>
  );
}
