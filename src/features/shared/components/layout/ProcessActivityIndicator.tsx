import { AnimatePresence, motion } from "framer-motion";
import { ClipboardCheck } from "lucide-react";
import { useReducedMotion } from "@/hooks/utility/interaction/useMotion";
import { ActivityPulseIcon } from "@/features/shared/components/icons/ActivityPulseIcon";
import { useOverviewStore } from "@/stores/overviewStore";
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { useTranslation } from "@/i18n/useTranslation";
import { PersonaMonitor } from "@/features/shared/components/layout/monitor";
import { QuickAnswerPopover } from "@/features/shared/components/layout/quick-answer/QuickAnswerPopover";

/**
 * Titlebar entry points for the two human-in-the-loop surfaces — kept as TWO
 * separate buttons so each toggles its own overlay cleanly:
 *
 *  - **Human review** (clipboard icon) → the lightweight Quick Answer popover
 *    (pending build/adoption questions + human reviews). Badged with the count
 *    of things to answer.
 *  - **Persona Monitor** (activity pulse) → the full-screen fleet monitor.
 *    Badged with drafts-ready + unread messages; a pulsing ring while the fleet
 *    is running.
 *
 * Previously a single button opened the popover whenever a review existed, so
 * the Monitor was unreachable when reviews were pending and the popover's
 * click-outside raced the re-click (couldn't toggle closed). Splitting fixes
 * both. Open state lives in the system store so Athena can open it too (see
 * `uiSlice.headerOverlay`).
 */
export default function ProcessActivityIndicator() {
  const { t, tx } = useTranslation();
  // The pulse loops on opacity, which the global <MotionConfig reducedMotion>
  // does NOT disable (it only stops one-shot transforms). Gate it explicitly.
  const prefersReducedMotion = useReducedMotion();
  // Header-overlay controller (mutually exclusive with Notifications; closed by
  // route nav / Back / Esc). These buttons own 'monitor' and 'quick-answer'.
  const headerOverlay = useSystemStore((s) => s.headerOverlay);
  const setHeaderOverlay = useSystemStore((s) => s.setHeaderOverlay);

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

  // The Quick Answer popover acts on questions + reviews; the Monitor owns
  // drafts + messages. Split the badges to match each button's domain.
  const quickCount = questionCount + pendingReviewCount;
  const monitorAttention = unreadMessageCount + draftReadyCount;

  const reviewOpen = headerOverlay === 'quick-answer';
  const monitorOpen = headerOverlay === 'monitor';

  return (
    <>
      {/* Human review → Quick Answer popover. `data-quick-answer-trigger` lets
          the popover's click-outside ignore this button so a re-click toggles
          closed instead of racing (close-then-reopen). */}
      <button
        className={`titlebar-btn relative ${reviewOpen ? 'titlebar-btn-active' : ''}`}
        data-testid="titlebar-human-review"
        data-quick-answer-trigger
        aria-pressed={reviewOpen}
        onClick={() => setHeaderOverlay(reviewOpen ? 'none' : 'quick-answer')}
        aria-label={quickCount > 0 ? tx(t.monitor.review_titlebar_attention, { count: quickCount }) : t.monitor.review_titlebar}
        title={quickCount > 0 ? tx(t.monitor.review_titlebar_attention, { count: quickCount }) : t.monitor.review_titlebar}
      >
        <ClipboardCheck
          width={20}
          height={20}
          strokeWidth={1.5}
          className={quickCount > 0 ? "text-amber-400" : "text-foreground"}
        />
        {quickCount > 0 && (
          <span className="absolute top-2 right-1.5 min-w-[16px] h-[16px] px-[3px] flex items-center justify-center text-[9px] font-bold leading-none rounded-full bg-amber-500/25 text-amber-300 shadow-elevation-1">
            {quickCount > 9 ? "9+" : quickCount}
          </span>
        )}
      </button>

      {/* Persona Monitor → full-screen fleet view. */}
      <button
        className={`titlebar-btn relative ${monitorOpen ? 'titlebar-btn-active' : ''}`}
        data-testid="titlebar-process-activity"
        aria-pressed={monitorOpen}
        onClick={() => setHeaderOverlay(monitorOpen ? 'none' : 'monitor')}
        aria-label={monitorAttention > 0 ? tx(t.monitor.titlebar_attention, { count: monitorAttention }) : t.monitor.titlebar}
        title={monitorAttention > 0 ? tx(t.monitor.titlebar_tooltip, { count: monitorAttention }) : t.monitor.titlebar}
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
          className={monitorAttention > 0 ? "text-amber-400" : running ? "text-primary" : "text-foreground"}
        />
        {monitorAttention > 0 && (
          <span className="absolute top-2 right-1.5 min-w-[16px] h-[16px] px-[3px] flex items-center justify-center text-[9px] font-bold leading-none rounded-full bg-amber-500/25 text-amber-300 shadow-elevation-1">
            {monitorAttention > 9 ? "9+" : monitorAttention}
          </span>
        )}
      </button>
      {/* AnimatePresence so the overlay's motion.div plays its fade-in on open
          AND its exit fade-out on close (a bare conditional unmounts instantly,
          skipping the exit animation). */}
      <AnimatePresence>
        {monitorOpen && <PersonaMonitor onClose={() => setHeaderOverlay('none')} />}
        {reviewOpen && (
          <QuickAnswerPopover
            onClose={() => setHeaderOverlay('none')}
            onOpenMonitor={() => setHeaderOverlay('monitor')}
          />
        )}
      </AnimatePresence>
    </>
  );
}
