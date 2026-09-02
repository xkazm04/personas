import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore } from "../../../agentStore";

/**
 * The build progress bar has ONE producer: the runner's `percent` on the
 * `progress` event (`engine/build_session/runner.rs::progress_percent`).
 *
 * Until 2026-09-02 there were two. The backend divided by a hardcoded 9 and
 * `handleBuildSessionStatus` independently computed `resolved/total*100` from a
 * `total_count` the backend also hardcoded to 9 — so whichever event arrived
 * last won, and the fallback branch (`total_count === 0`) actively RESET a live
 * bar to zero. The runner now sends `TOTAL_COUNT_UNKNOWN` (0) on every status,
 * because a build's true denominator is not knowable up front, so that branch
 * is on the hot path for every real build.
 *
 * These tests pin the derivation, not the rendering: a status with no knowable
 * total must leave the last true reading alone.
 */

function ensureSession(sessionId = "s1", personaId = "p-1") {
  useAgentStore.getState().createBuildSession(personaId, sessionId);
}

function setProgress(percent: number, sessionId = "s1") {
  useAgentStore.getState().handleBuildProgress({
    type: "progress",
    session_id: sessionId,
    dimension: null,
    message: "working",
    percent,
  });
}

function status(
  phase: string,
  resolved_count: number,
  total_count: number,
  sessionId = "s1",
) {
  useAgentStore.getState().handleBuildSessionStatus({
    type: "session_status",
    session_id: sessionId,
    phase,
    resolved_count,
    total_count,
  });
}

describe("matrixBuildSlice — progress derivation (one producer)", () => {
  beforeEach(() => {
    useAgentStore.getState().resetBuildSession();
  });

  it("does not reset a live bar when a status carries no knowable total", () => {
    ensureSession();
    setProgress(60);

    // What the runner now sends on every SessionStatus: TOTAL_COUNT_UNKNOWN.
    status("resolving", 4, 0);

    expect(useAgentStore.getState().buildPhase).toBe("resolving");
    expect(useAgentStore.getState().buildProgress).toBe(60);
  });

  it("still applies the phase from a status with no total", () => {
    ensureSession();
    setProgress(100);

    status("draft_ready", 4, 0);

    expect(useAgentStore.getState().buildPhase).toBe("draft_ready");
    expect(useAgentStore.getState().buildProgress).toBe(100);
  });

  it("a status can never contradict the percent the runner just emitted", () => {
    ensureSession();
    // DraftReady: the runner's one producer says 100.
    setProgress(100);
    // The status for the same transition. Under the old derivation this landed
    // last and overwrote 100 with 0 — the bar visibly fell back at the moment
    // the build finished.
    status("draft_ready", 5, 0);

    expect(useAgentStore.getState().buildProgress).toBe(100);
  });

  it("the runner's percent is the only thing that moves the bar", () => {
    ensureSession();
    status("analyzing", 0, 0);
    expect(useAgentStore.getState().buildProgress).toBe(0);

    setProgress(100);
    expect(useAgentStore.getState().buildProgress).toBe(100);

    // A capability count of 2 vs 5 changes nothing on this side either: the
    // backend emits no fraction at all until DraftReady.
    useAgentStore.getState().handleBuildProgress({
      type: "progress",
      session_id: "s1",
      dimension: "triggers",
      message: "Resolved: triggers",
      percent: null,
    });
    expect(useAgentStore.getState().buildProgress).toBe(100);
  });

  it("honours a total the backend genuinely vouches for", () => {
    // The derivation is kept for a positive total so a future producer that
    // does know its denominator is not silently ignored.
    ensureSession();
    status("resolving", 3, 8);
    expect(useAgentStore.getState().buildProgress).toBeCloseTo(37.5);
  });
});
