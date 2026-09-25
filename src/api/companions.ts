// Companions - wrappers over the `companions_*` Tauri commands.
//
// The CATEGORY's door: who exists, who may be switched on, who is on. Each
// companion's own surface (Athena's chat, Overseer's reviews, Curator's
// registry work) keeps its own api module.
import type { CompanionId } from "@/lib/bindings/CompanionId";
import type { CompanionsStatusDto } from "@/lib/bindings/CompanionsStatusDto";
import { EventName } from "@/lib/eventRegistry";
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

/**
 * Emitted whenever a term of the status changes: a switch, a star, a delete,
 * an onboarding finish. Carries the whole `CompanionsStatusDto`, so a listener
 * never has to read back.
 *
 * The literal now comes FROM the registry rather than repeating it: the name
 * crosses the Rust -> JS boundary, and two copies of a string is one typo away
 * from a surface that listens to nothing and says nothing about it.
 */
export const COMPANIONS_STATUS_EVENT = EventName.COMPANIONS_STATUS_CHANGED;

/** The standing of all three companions, in category order. */
export async function companionsStatus(): Promise<CompanionsStatusDto> {
  return invoke<CompanionsStatusDto>("companions_status");
}

/**
 * Switch one companion on or off. Refuses when the prerequisite is missing
 * (Overseer with no starred agent, Curator with no mapped registry), so the
 * caller surfaces the refusal rather than pretending the switch moved.
 */
export async function companionsSetEnabled(
  companionId: CompanionId,
  enabled: boolean,
): Promise<CompanionsStatusDto> {
  return invoke<CompanionsStatusDto>("companions_set_enabled", { companionId, enabled });
}

/** Record that Athena's onboarding wizard was finished. */
export async function athenaMarkOnboarded(): Promise<void> {
  return invoke<void>("athena_mark_onboarded");
}
