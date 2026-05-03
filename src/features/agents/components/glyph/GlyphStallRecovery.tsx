import { useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, RefreshCw, RotateCcw, Clock } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { cancelBuildSession } from "@/api/agents/buildSession";
import { silentCatch } from "@/lib/silentCatch";
import type { BuildPhase } from "@/lib/types/buildTypes";

/**
 * A-grade Phase 7 (2026-05-03) — wedged-build recovery affordance.
 *
 * Renders inline below the building-state spinner when
 * `useBuildStallDetector` reports the build has produced no signal
 * for ≥ 60s in a stall-eligible phase. Stays unobtrusive: a single
 * amber row with three buttons, no modal blocker — the user might
 * legitimately want to keep waiting because the LLM is just slow.
 *
 * Recovery actions:
 *   • "Restart" — cancels the current session via
 *     `cancelBuildSession`, then resets the wizard state. Pre-Phase-7
 *     this was a "kill the process and reload" path; now it's
 *     graceful. Cancel command was already exposed; this hook just
 *     wires it to a button.
 *   • "Refine" — opens the existing Refine composer. Useful when the
 *     LLM is stuck mid-resolution because the intent is ambiguous;
 *     the user can nudge it with a more specific prompt.
 *   • "Keep waiting" — hides the warning for another 60s. Lets the
 *     user opt out of the prompt without dismissing the build.
 *
 * The phase-aware copy distinguishes "LLM is thinking" stalls from
 * "test pass is running long" stalls so the user has context about
 * what specifically isn't moving.
 */
interface GlyphStallRecoveryProps {
  stalledPhase: BuildPhase;
  stallSecs: number;
  /** Forwarded to the existing Refine flow — opens the composer. */
  onOpenRefine?: () => void;
  /** Called after the wizard resets. Lets the parent close any
   *  overlays / clear local state in addition to the store reset. */
  onAfterRestart?: () => void;
  /** Hides the warning until the next 60s of silence. Local state in
   *  the parent so the dismissal persists across re-renders. */
  onSnooze: () => void;
}

function copyForPhase(phase: BuildPhase, secs: number): { headline: string; detail: string } {
  const minutes = Math.floor(secs / 60);
  const remainder = secs % 60;
  const elapsed = minutes >= 1 ? `${minutes}m ${remainder}s` : `${secs}s`;
  switch (phase) {
    case "analyzing":
    case "resolving":
      return {
        headline: "The agent is taking longer than usual to think.",
        detail: `No progress for ${elapsed}. The LLM may be stuck on an ambiguous detail — refining with a more specific instruction often unblocks it.`,
      };
    case "testing":
      return {
        headline: "The test pass is running long.",
        detail: `No progress for ${elapsed}. A connector might be slow to respond, or the test plan generator is struggling. You can wait, restart, or refine the build.`,
      };
    default:
      return {
        headline: "Build appears stuck.",
        detail: `No progress for ${elapsed}.`,
      };
  }
}

export function GlyphStallRecovery({
  stalledPhase,
  stallSecs,
  onOpenRefine,
  onAfterRestart,
  onSnooze,
}: GlyphStallRecoveryProps) {
  const [restarting, setRestarting] = useState(false);
  const buildSessionId = useAgentStore((s) => s.buildSessionId);
  const resetBuildSession = useAgentStore((s) => s.resetBuildSession);

  const { headline, detail } = copyForPhase(stalledPhase, stallSecs);

  const handleRestart = async () => {
    if (restarting) return;
    setRestarting(true);
    try {
      // Best-effort cancel the server-side session so the CLI process
      // doesn't keep producing events into a wizard that's been reset.
      // A failure here is non-fatal — we still want to clear the store.
      if (buildSessionId) {
        await cancelBuildSession(buildSessionId).catch(silentCatch("stall:cancel"));
      }
    } finally {
      resetBuildSession();
      onAfterRestart?.();
      setRestarting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -2 }}
      transition={{ duration: 0.2 }}
      className="mt-2 w-[min(360px,90vw)] rounded-modal border border-amber-500/30 bg-amber-500/5 px-3 py-2 flex flex-col gap-1.5 pointer-events-auto"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="typo-body text-amber-200/90 leading-snug">{headline}</div>
          <div className="typo-caption text-foreground/60 leading-snug mt-0.5">{detail}</div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => void handleRestart()}
          disabled={restarting}
          className="px-2.5 py-1 rounded-full bg-rose-500/15 hover:bg-rose-500/25 disabled:opacity-50 border border-rose-500/30 typo-caption text-foreground cursor-pointer flex items-center gap-1"
          title="Cancel this build and start fresh — your intent stays in the input"
        >
          <RotateCcw className="w-3 h-3" />
          {restarting ? "Restarting…" : "Restart"}
        </button>
        {onOpenRefine && (
          <button
            type="button"
            onClick={onOpenRefine}
            className="px-2.5 py-1 rounded-full bg-primary/15 hover:bg-primary/25 border border-primary/30 typo-caption text-foreground cursor-pointer flex items-center gap-1"
            title="Open Refine and tell the agent what to focus on"
          >
            <RefreshCw className="w-3 h-3" />
            Refine
          </button>
        )}
        <button
          type="button"
          onClick={onSnooze}
          className="px-2.5 py-1 rounded-full bg-foreground/5 hover:bg-foreground/10 border border-border/30 typo-caption text-foreground/70 cursor-pointer flex items-center gap-1"
          title="Hide this warning for another 60 seconds"
        >
          <Clock className="w-3 h-3" />
          Keep waiting
        </button>
      </div>
    </motion.div>
  );
}
