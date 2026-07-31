/**
 * suggestionCommit — maps a mined automation suggestion onto the EXISTING
 * Studio commit path (`studioCommit.ts`), so the ghost-cable accept flow can
 * never drift from what hand-wiring the same route would produce.
 *
 * A suggestion "event E → persona P" IS an `event_listener` trigger with
 * `listen_event_type: E` on P — exactly what `formConfigToTriggerInput`
 * builds for a form-committed event_listener source. We fabricate the
 * equivalent DraftLink and delegate; the only deviation is `enabled: false`,
 * because the accept flow dry-runs BEFORE arming (create-disabled → dry-run
 * → enable). Nothing auto-commits: this is only ever called from the user's
 * explicit accept click.
 */
import type { CreateTriggerInput } from '@/lib/bindings/CreateTriggerInput';
import type { AutomationSuggestion } from '@/lib/bindings/AutomationSuggestion';
import { formConfigToTriggerInput } from '../libs/studioCommit';
import type { DraftLink } from '../libs/studioDraftModel';

/** The synthetic draft link a suggestion is equivalent to. */
export function suggestionToDraftLink(s: AutomationSuggestion): DraftLink {
  return {
    id: `suggestion-${s.id}`,
    source: { kind: 'trigger', triggerType: 'event_listener' },
    targetPersonaId: s.personaId,
    condition: null,
  };
}

/**
 * Build the `create_trigger` input for an accepted suggestion, DISABLED so
 * the dry-run gate runs before the route can ever fire.
 */
export function suggestionToTriggerInput(s: AutomationSuggestion): CreateTriggerInput {
  const input = formConfigToTriggerInput(suggestionToDraftLink(s), 'event_listener', {
    listen_event_type: s.eventType,
  });
  return { ...input, enabled: false };
}
