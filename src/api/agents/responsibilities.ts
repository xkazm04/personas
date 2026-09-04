import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { PersonaResponsibility } from "@/lib/bindings/PersonaResponsibility";
import type { CreatePersonaResponsibilityInput } from "@/lib/bindings/CreatePersonaResponsibilityInput";
import type { UpdatePersonaResponsibilityInput } from "@/lib/bindings/UpdatePersonaResponsibilityInput";
import type { AttentionLedgerEntry } from "@/lib/bindings/AttentionLedgerEntry";

// ============================================================================
// Responsibilities (living-agent charters)
// ============================================================================

/**
 * A persona's standing charters, newest first. Retired charters are hidden
 * unless `includeRetired` is set.
 */
export const listPersonaResponsibilities = (
  personaId: string,
  includeRetired = false,
) =>
  invoke<PersonaResponsibility[]>("list_persona_responsibilities", {
    personaId,
    includeRetired,
  });

/**
 * Create an operator-authored charter (`source = 'operator'`). Intake
 * validation mirrors the App-master mandate: scope rung above 2 is refused,
 * refusal classes must come from a domain library or carry a `custom:` prefix.
 */
export const createPersonaResponsibility = (
  input: CreatePersonaResponsibilityInput,
) =>
  invoke<PersonaResponsibility>("create_persona_responsibility", { input });

/**
 * The two `Option<Option<T>>` columns of the update door. Like
 * `PERSONA_NULLABLE_FIELDS` in `personas.ts`, the flattened ts-rs binding
 * loses the three-way wire meaning (absent = skip · `null` = clear · value =
 * set), so the payload type below re-adds optionality for exactly these keys —
 * sending `null` where you meant "skip" would erase the column.
 */
export const RESPONSIBILITY_NULLABLE_FIELDS = ["budgetMonthlyUsd", "projectId"] as const;

type ResponsibilityNullableField = (typeof RESPONSIBILITY_NULLABLE_FIELDS)[number];

/** Wire payload for `update_persona_responsibility` — see the note above. */
export type ResponsibilityUpdatePayload = Omit<
  UpdatePersonaResponsibilityInput,
  ResponsibilityNullableField
> &
  Partial<Pick<UpdatePersonaResponsibilityInput, ResponsibilityNullableField>>;

/**
 * Partial update. Omitted fields stay unchanged; the two nullable columns
 * (`budgetMonthlyUsd`, `projectId`) clear with an explicit `null`. The merged
 * charter is re-validated server-side. Status moves through
 * {@link retirePersonaResponsibility}, never here.
 */
export const updatePersonaResponsibility = (
  id: string,
  input: ResponsibilityUpdatePayload,
) =>
  invoke<PersonaResponsibility>("update_persona_responsibility", { id, input });

/**
 * The `persona_responsibilities.status` vocabulary. The Rust enum is
 * deliberately not ts-exported (the wire carries the lowercase string, like
 * `Persona.lifecycle`), so the union is declared here and the server re-parses
 * it — an unknown value is refused there, not silently stored.
 */
export type ResponsibilityStatusValue =
  | "draft"
  | "active"
  | "suspended"
  | "retired";

/** Retire a charter (status -> `retired`); returns the refreshed row. */
export const retirePersonaResponsibility = (id: string) =>
  invoke<PersonaResponsibility>("retire_persona_responsibility", { id });

/**
 * Move a charter along the status ladder. This is the door that makes `draft`
 * escapable: an agent-proposed charter is minted as a draft on approval, so
 * without an activation path every proposed charter would stay inert.
 */
export const setPersonaResponsibilityStatus = (
  id: string,
  status: ResponsibilityStatusValue,
) =>
  invoke<PersonaResponsibility>("set_persona_responsibility_status", {
    id,
    status,
  });

/**
 * A persona's attention/consolidation passes, newest first (read-only — the
 * loop that writes them lands with the attention scheduler, WP5).
 */
export const listAttentionLedger = (personaId: string, limit = 50) =>
  invoke<AttentionLedgerEntry[]>("list_attention_ledger", { personaId, limit });
