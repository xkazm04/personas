/**
 * Where a landing column takes the operator.
 *
 * The rule (operator, 2026-09-22): an un-onboarded Athena opens her own module
 * with the onboarding experience; everyone else opens the Setup page of that
 * companion, because Setup is where a blocker is explained and resolved.
 */
import type { CompanionId, CompanionStatusDto, CompanionsPage } from "../types";
import { landingStateOf } from "./landingState";

export function landingTarget(status: CompanionStatusDto): CompanionsPage {
  switch (status.id) {
    case "athena":
      return landingStateOf(status) === "needs_onboarding" ? "athena:create-athena" : "athena:setup";
    case "overseer":
      return "overseer:setup";
    case "curator":
      return "curator:setup";
  }
}

/** The page a companion's group header points at when its status is unknown. */
export function defaultPageFor(id: CompanionId): CompanionsPage {
  switch (id) {
    case "athena":
      return "athena:setup";
    case "overseer":
      return "overseer:reviews";
    case "curator":
      return "curator:council";
  }
}
