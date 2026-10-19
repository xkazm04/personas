/**
 * The once-per-app-launch latch behind the radio's "Resume on launch" setting.
 *
 * Module scope on purpose: the footer that makes the decision unmounts and
 * remounts all session long (the fleet grid takes its slot, the radio can be
 * switched off and on), so a per-mount ref re-ran the launch decision on every
 * remount and resumed a station the user had paused minutes earlier.
 *
 * The backend persists `status` as it was when the app quit, so a session that
 * quit mid-song launches with `playing`. The decision is what turns that
 * persisted word into either a resume (setting on) or silence (setting off).
 * Anything that drives the radio before the footer decides (a Settings preview)
 * marks the session as driven, so its fresh `playing` is never mistaken for a
 * persisted one.
 *
 * It guards a decision, not a registration: an HMR re-evaluation of this file
 * only lets the next footer mount decide once more, it leaks nothing.
 */
let launchDecided = false;

/** This session already drove the radio; skip the launch decision. */
export function markRadioDriven(): void {
  launchDecided = true;
}

/** True exactly once per launch, and never after `markRadioDriven`. */
export function claimRadioLaunchDecision(): boolean {
  if (launchDecided) return false;
  launchDecided = true;
  return true;
}

/** A fresh launch, for tests. */
export function resetRadioLaunchDecision(): void {
  launchDecided = false;
}
