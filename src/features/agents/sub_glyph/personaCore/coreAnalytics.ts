/** coreAnalytics — the one usage event the persona core reports about itself.
 *
 *  Closing the configurator is the one moment the whole selection is settled
 *  and still in hand: after it the core leaves the component tree only as prose
 *  folded into the build intent, which is why nothing downstream could ever
 *  answer "which archetypes and traits do people actually pick?". Every surface
 *  that hosts the configurator (the modal, the Sheet · Cinema loupe layer)
 *  calls this on EVERY user exit route (Done, Esc, backdrop, back) so an
 *  ABANDONED open is recorded too. It routes through getAnalyticsSink() rather
 *  than Sentry directly so the user's telemetry switch governs it like every
 *  other usage event. */
import { getAnalyticsSink } from "@/lib/analytics/sink";
import { personaCoreSelectionLabel } from "./usePersonaCore";
import { ACCENT } from "./catalog";
import type { PersonaCore } from "./types";

export function recordPersonaCoreClose(core: Pick<PersonaCore, "configured" | "state">): void {
  getAnalyticsSink().interaction({
    category: "persona_core",
    action: core.configured ? "configured" : "dismissed",
    label: personaCoreSelectionLabel(core.state),
  });
}

/** The colour a surface should tint the core with: the picked archetype's own,
 *  else the persona-core accent. */
export function personaCoreAccent(core: Pick<PersonaCore, "preset">): string {
  return core.preset?.color ?? ACCENT;
}
