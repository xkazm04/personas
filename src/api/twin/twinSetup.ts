import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { SetupOpener } from "@/lib/bindings/SetupOpener";
import type { SetupReadiness } from "@/lib/bindings/SetupReadiness";
import type { SetupSessionSnapshot } from "@/lib/bindings/SetupSessionSnapshot";
import type { SetupSteer } from "@/lib/bindings/SetupSteer";

// ============================================================================
// Twin setup plan (spark twin-setup-plan)
//
// Every call returns the WHOLE session snapshot, so the caller replaces its
// state instead of merging. None of these waits on an LLM: planning and
// reconciling run in the background and announce themselves with
// `EventName.TWIN_SETUP_UPDATED`, on which the caller refetches via
// `setupGet`. Default timeouts are therefore enough.
//
// `locale` is the app's language code (the guide asks in it); `readiness` is
// the client's reading of which slots are filled, handed to the planner.
// ============================================================================

/** The current session. Pure read. */
export const setupGet = (twinId: string) =>
  invoke<SetupSessionSnapshot>("twin_setup_get", { twinId });

/**
 * Open (or resume) the session. `opener` is a question the client can ask
 * immediately, before any plan exists.
 */
export const setupOpen = (
  twinId: string,
  readiness: SetupReadiness,
  locale?: string | null,
  opener?: SetupOpener | null,
) =>
  invoke<SetupSessionSnapshot>("twin_setup_open", {
    twinId,
    locale: locale ?? null,
    readiness,
    opener: opener ?? null,
  });

/** Answer the live step; `answer === null` skips it. */
export const setupAnswer = (
  twinId: string,
  stepId: string,
  answer: string | null,
  readiness: SetupReadiness,
  locale?: string | null,
) =>
  invoke<SetupSessionSnapshot>("twin_setup_answer", {
    twinId,
    stepId,
    answer,
    locale: locale ?? null,
    readiness,
  });

/** Steer the plan (`{ action: "dropGoal", goalId }`, `{ action: "redeal" }`, ...). */
export const setupSteer = (
  twinId: string,
  steer: SetupSteer,
  readiness: SetupReadiness,
  locale?: string | null,
) =>
  invoke<SetupSessionSnapshot>("twin_setup_steer", {
    twinId,
    steer,
    locale: locale ?? null,
    readiness,
  });

/** Record the verdict on an offer. */
export const setupOfferVerdict = (
  twinId: string,
  offerId: string,
  verdict: "accepted" | "edited" | "dismissed",
) =>
  invoke<SetupSessionSnapshot>("twin_setup_offer_verdict", {
    twinId,
    offerId,
    verdict,
  });

/** Throw the plan away and build a fresh one. */
export const setupRebuild = (
  twinId: string,
  readiness: SetupReadiness,
  locale?: string | null,
) =>
  invoke<SetupSessionSnapshot>("twin_setup_rebuild", {
    twinId,
    locale: locale ?? null,
    readiness,
  });
