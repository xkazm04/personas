import { toEditableStructuredPrompt } from '@/lib/personas/promptMigration';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';

/**
 * Completeness derivation for a persona draft.
 *
 * `DraftPromptTab` already computes `hasContent` per prompt subtab and paints
 * an emerald dot from it, but nothing aggregated that into a save gate: a draft
 * could be saved with a null name and an empty prompt and land in the catalog
 * as a nameless shell. The requirements are DERIVED here, once, so the tab bar
 * and the Save button cannot disagree about what is missing.
 *
 * Two requirements, deliberately: a name, because it is how the draft is
 * addressed everywhere afterwards, and SOME prompt body - either the structured
 * Identity section or a raw `system_prompt` - because a persona with neither
 * has nothing to run. Everything else on the draft has a working default.
 */
export type DraftRequirementId = 'name' | 'identity';

export interface DraftRequirement {
  id: DraftRequirementId;
  met: boolean;
}

export interface DraftCompleteness {
  requirements: DraftRequirement[];
  /** Requirement ids still unmet, in declaration order. */
  missing: DraftRequirementId[];
  complete: boolean;
}

function hasIdentity(draft: N8nPersonaDraft): boolean {
  if (draft.system_prompt?.trim()) return true;
  if (!draft.structured_prompt) return false;
  const editable = toEditableStructuredPrompt(draft.structured_prompt);
  return !!editable.identity?.trim() || !!editable.instructions?.trim();
}

export function deriveDraftCompleteness(draft: N8nPersonaDraft | null): DraftCompleteness {
  const requirements: DraftRequirement[] = [
    { id: 'name', met: !!draft?.name?.trim() },
    { id: 'identity', met: !!draft && hasIdentity(draft) },
  ];
  const missing = requirements.filter((r) => !r.met).map((r) => r.id);
  return { requirements, missing, complete: missing.length === 0 };
}
