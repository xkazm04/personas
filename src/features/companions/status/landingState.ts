/**
 * One companion's standing, reduced to the four states a surface draws.
 *
 * The order of the tests is the design: a missing prerequisite outranks the
 * switch (a companion that cannot run is `blocked`, not `off`), and Athena's
 * unfinished onboarding outranks both, because it is the one state with an
 * action she owns herself.
 */
import type { CompanionStatusDto, LandingState } from "../types";

export function landingStateOf(status: CompanionStatusDto): LandingState {
  if (!status.onboarded) return "needs_onboarding";
  if (!status.eligible) return "blocked";
  if (!status.enabled) return "off";
  return "active";
}

/** True when the companion is doing its work right now. */
export function isCompanionActive(status: CompanionStatusDto): boolean {
  return landingStateOf(status) === "active";
}
