/**
 * useBuildStallDetector — A-grade Phase 7 (2026-05-03)
 *
 * Watches the active build session for stall conditions. A "stall" is
 * a phase that *should* be making progress (analyzing / resolving /
 * testing) but produces no observable signal — no phase change, no
 * progress increment, no new activity message, no new CLI output —
 * for `thresholdMs` consecutive milliseconds.
 *
 * Excludes phases that legitimately wait on the user:
 *   - `awaiting_input` — user is the bottleneck, not the system.
 *   - `draft_ready` / `test_complete` / `promoted` — terminal-ish; the
 *     user is reviewing.
 *   - `failed` / `cancelled` — already terminal.
 *
 * Default threshold is 60s. Real builds span 1–3 min total, but
 * individual phases rarely sit silent for >60s when the LLM is
 * actually working — that's enough headroom to avoid false positives
 * while still surfacing a stuck wizard within a minute.
 *
 * The hook is read-only — UI consumers decide what to render. Returns
 * `{ isStalled, stallSecs }` so callers can pick between "appears
 * stuck (~75s)" and binary "show / don't show".
 */
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAgentStore } from "@/stores/agentStore";
import type { BuildPhase } from "@/lib/types/buildTypes";

const DEFAULT_THRESHOLD_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;

const STALL_ELIGIBLE_PHASES: ReadonlySet<BuildPhase> = new Set([
  "analyzing",
  "resolving",
  "testing",
] satisfies BuildPhase[]);

export interface BuildStallState {
  /** True when the build has been silent for ≥ thresholdMs in a stall-eligible phase. */
  isStalled: boolean;
  /** Seconds since last observed signal change. 0 when not in a
   *  stall-eligible phase. */
  stallSecs: number;
  /** Convenience: the phase the build was in at stall onset. Useful
   *  for tailoring the recovery copy ("LLM is taking longer than
   *  usual to resolve" vs. "Tests are running long"). */
  stalledPhase: BuildPhase | null;
}

const EMPTY_STATE: BuildStallState = {
  isStalled: false,
  stallSecs: 0,
  stalledPhase: null,
};

export function useBuildStallDetector(
  thresholdMs: number = DEFAULT_THRESHOLD_MS,
): BuildStallState {
  // Pull only the signals that genuinely indicate the build is making
  // progress. Each one resets the stall timer. We project to scalar
  // counts where the underlying state is an array so `useShallow`
  // doesn't re-fire on every appended line — only when the count
  // actually moves.
  const signals = useAgentStore(
    useShallow((s) => ({
      buildPhase: s.buildPhase,
      buildProgress: s.buildProgress,
      buildActivity: s.buildActivity,
      buildOutputLineCount: s.buildOutputLines.length,
      pendingQuestionCount: s.buildPendingQuestions.length,
      sessionId: s.buildSessionId,
    })),
  );

  // Track the last signal snapshot we observed and when it changed.
  const lastSignalsRef = useRef<string>("");
  const lastChangeAtRef = useRef<number>(Date.now());
  const [stallSecs, setStallSecs] = useState(0);

  // Reset the timer when ANY signal changes. Stringify is cheap here
  // since the watched fields are all primitives + integer counts.
  const signalKey = `${signals.sessionId ?? ""}|${signals.buildPhase}|${signals.buildProgress}|${signals.buildActivity ?? ""}|${signals.buildOutputLineCount}|${signals.pendingQuestionCount}`;

  useEffect(() => {
    if (signalKey !== lastSignalsRef.current) {
      lastSignalsRef.current = signalKey;
      lastChangeAtRef.current = Date.now();
      setStallSecs(0);
    }
  }, [signalKey]);

  // Poll once per second to update stallSecs. Cheap — single setState
  // per second when in a stall-eligible phase, no-op otherwise.
  useEffect(() => {
    const phase = signals.buildPhase;
    const eligible = STALL_ELIGIBLE_PHASES.has(phase);
    if (!eligible) {
      // Reset whenever we leave eligibility so re-entering starts fresh.
      lastChangeAtRef.current = Date.now();
      if (stallSecs !== 0) setStallSecs(0);
      return;
    }
    const tick = () => {
      const elapsed = Date.now() - lastChangeAtRef.current;
      setStallSecs(Math.floor(elapsed / 1000));
    };
    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [signals.buildPhase, stallSecs]);

  if (!signals.sessionId) return EMPTY_STATE;
  if (!STALL_ELIGIBLE_PHASES.has(signals.buildPhase)) return EMPTY_STATE;

  const isStalled = stallSecs * 1000 >= thresholdMs;
  return {
    isStalled,
    stallSecs,
    stalledPhase: isStalled ? signals.buildPhase : null,
  };
}
