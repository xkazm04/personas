/**
 * The Review step is the commit boundary for a generated template: what the
 * operator sees there is what `saveCustomTemplate` must persist.
 *
 * Before this module the save path chose between two whole payloads —
 * `state.designResultJson` when the generator produced one, else a hand-built
 * fallback object — so every Prompt / Settings / JSON edit made on Review was
 * dropped whenever the generator JSON was present, and everything the
 * generator produced beyond four fields (tools, connectors, adoption
 * requirements, feasibility, use cases) was dropped whenever it was not.
 *
 * Merging instead of choosing keeps both: the generator's payload is the base,
 * and the draft the user actually edited overwrites the fields it owns. Keys
 * are the ones `commands/design/template_adopt.rs` reads back out of
 * `design_result` — anything else in the base survives untouched.
 */
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

/** `notification_channels` rides on the draft as a JSON string (that is the
 *  persona column's shape); `design_result` carries it as an array under
 *  `suggested_notification_channels`. */
function parseChannels(raw: string | null | undefined): unknown[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    // A malformed channel blob is the draft editor's problem, not the save
    // path's: keep whatever the base already declared.
    return null;
  }
}

export function mergeDraftIntoDesignResult(
  designResultJson: string,
  draft: N8nPersonaDraft,
): string {
  let base: Json = {};
  if (designResultJson) {
    try {
      base = asObject(JSON.parse(designResultJson)) ?? {};
    } catch {
      // Unparseable generator output must not block the save — the draft is a
      // complete payload on its own (that was the old fallback's whole job).
      base = {};
    }
  }

  const basePersonaMeta = asObject(base.persona_meta) ?? {};
  const merged: Json = {
    ...base,
    structured_prompt: draft.structured_prompt ?? base.structured_prompt ?? null,
    full_prompt_markdown: draft.system_prompt || (base.full_prompt_markdown as string | undefined) || '',
    summary: draft.description || (base.summary as string | undefined) || '',
    persona_meta: {
      ...basePersonaMeta,
      name: draft.name,
      icon: draft.icon,
      color: draft.color,
      model_profile: draft.model_profile,
      max_budget_usd: draft.max_budget_usd,
      max_turns: draft.max_turns,
    },
  };

  const channels = parseChannels(draft.notification_channels);
  if (channels) merged.suggested_notification_channels = channels;

  if (draft.tools && draft.tools.length > 0) merged.suggested_tools = draft.tools;

  return JSON.stringify(merged);
}
