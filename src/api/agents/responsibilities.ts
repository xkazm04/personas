import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { PersonaResponsibility } from "@/lib/bindings/PersonaResponsibility";
import type { CreatePersonaResponsibilityInput } from "@/lib/bindings/CreatePersonaResponsibilityInput";
import type { UpdatePersonaResponsibilityInput } from "@/lib/bindings/UpdatePersonaResponsibilityInput";
import type { AttentionLedgerEntry } from "@/lib/bindings/AttentionLedgerEntry";
import type { AdoptAppMasterInput } from "@/lib/bindings/AdoptAppMasterInput";
import type { AppMasterAdoption } from "@/lib/bindings/AppMasterAdoption";
import type { AdoptArchitectInput } from "@/lib/bindings/AdoptArchitectInput";
import type { ArchitectAdoption } from "@/lib/bindings/ArchitectAdoption";

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
 * The three `Option<Option<T>>` columns of the update door. Like
 * `PERSONA_NULLABLE_FIELDS` in `personas.ts`, the flattened ts-rs binding
 * loses the three-way wire meaning (absent = skip · `null` = clear · value =
 * set), so the payload type below re-adds optionality for exactly these keys —
 * sending `null` where you meant "skip" would erase the column.
 *
 * `workspaceId` joined them with the Architect (the cross-project charter
 * binding). It has to be listed here rather than left to the flattened
 * binding: omitting it made the key REQUIRED on every update payload, so the
 * two existing call sites stopped compiling — which is the compiler catching
 * exactly the erasure this list exists to prevent.
 */
export const RESPONSIBILITY_NULLABLE_FIELDS = [
  "budgetMonthlyUsd",
  "projectId",
  "workspaceId",
] as const;

type ResponsibilityNullableField = (typeof RESPONSIBILITY_NULLABLE_FIELDS)[number];

/** Wire payload for `update_persona_responsibility` — see the note above. */
export type ResponsibilityUpdatePayload = Omit<
  UpdatePersonaResponsibilityInput,
  ResponsibilityNullableField
> &
  Partial<Pick<UpdatePersonaResponsibilityInput, ResponsibilityNullableField>>;

/**
 * Partial update. Omitted fields stay unchanged; the three nullable columns
 * (`budgetMonthlyUsd`, `projectId`, `workspaceId`) clear with an explicit
 * `null`. A charter binds to a project OR a workspace, never both — the merged
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

// ============================================================================
// App Master adoption
// ============================================================================

/**
 * Adopt (or re-adopt) the App Master for a registered dev project: one persona
 * pinned to the project, one charter per named recipe, every charter enrolled
 * in the attention loop, and the mandate written into the persona's manifest
 * law sections.
 *
 * Idempotent — the persona is keyed by `(design_context.devProjectId, name)`
 * and each charter by its recipe slug, so calling twice with the same body
 * updates in place. A slug dropped from `recipes` SUSPENDS its charter (never
 * deletes it: the charter carries the attention loop's coverage memory).
 *
 * Partial outcomes are reported rather than rounded up: read `notes` and
 * `manifestPath` before treating an adoption as complete. The same operation
 * is on the loopback dev-tools bridge at `POST /dev-tools/app-master/adopt`.
 */
export const adoptAppMaster = (input: AdoptAppMasterInput) =>
  invoke<AppMasterAdoption>("adopt_app_master", { input });

/**
 * Adopt (or re-adopt) the ARCHITECT of a workspace — the cross-project twin of
 * {@link adoptAppMaster}. The persona binds to the `dev_workspaces` row rather
 * than to one project, so its decision each wake sees every project in the
 * workspace, each project's App Master, the goals across the portfolio and how
 * many personas are active app-wide.
 *
 * Same operation and same guarantees as the App Master door — it shares that
 * door's body — with the binding one scope up: the persona is keyed by
 * `(design_context.workspaceId, name)`, each charter by its recipe slug, and a
 * slug dropped from `recipes` SUSPENDS its charter rather than deleting it.
 *
 * The Architect designs and directs; it does not write application code, and
 * its manifest Mandate says so. The same operation is on the loopback
 * dev-tools bridge at `POST /dev-tools/architect/adopt`.
 */
export const adoptArchitect = (input: AdoptArchitectInput) =>
  invoke<ArchitectAdoption>("adopt_architect", { input });
