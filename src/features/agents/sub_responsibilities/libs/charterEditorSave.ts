import type { PersonaResponsibility } from '@/lib/bindings/PersonaResponsibility';
import {
  createPersonaResponsibility,
  updatePersonaResponsibility,
  type ResponsibilityUpdatePayload,
} from '@/api/agents/responsibilities';
import type { ResponsibilityDraft } from './charterMeta';

/**
 * Persist the charter editor's GOVERNANCE draft.
 *
 * On this wire `null` on a regular field means "leave unchanged" (serde
 * `Option` -> `None`), NOT a blank-fill — so the runtime columns this form does
 * not own (`connectors`, `procedure`, `spec`, `approvalGates`, `tenure`) are
 * sent as `null` and stay whatever the per-dimension sigil editors last wrote.
 * `budgetMonthlyUsd` is the double-`Option` exception where an explicit `null`
 * CLEARS the column, which is exactly right when the operator emptied the
 * field. `projectId` is omitted on purpose: absent = leave unchanged.
 */
export async function saveCharterDraft(args: {
  personaId: string;
  draft: ResponsibilityDraft;
  existing?: PersonaResponsibility;
  /** Create-only: which rung of the ladder the new charter starts on. */
  createStatus: 'active' | 'draft';
}): Promise<PersonaResponsibility> {
  const { personaId, draft, existing, createStatus } = args;
  const common = {
    title: draft.title,
    domain: draft.domain,
    outcomes: draft.outcomes,
    objectives: draft.objectives.filter((o) => o.key && o.label),
    scopeRung: draft.scopeRung,
    refusalClasses: draft.refusalClasses,
    owner: draft.owner,
    cadence: draft.cadence,
  };

  if (existing) {
    const payload: ResponsibilityUpdatePayload = {
      ...common,
      approvalGates: null,
      tenure: null,
      budgetMonthlyUsd: draft.budgetMonthlyUsd ?? null,
      connectors: null,
      procedure: null,
      spec: null,
    };
    return updatePersonaResponsibility(existing.id, payload);
  }

  return createPersonaResponsibility({
    personaId,
    ...common,
    approvalGates: [],
    budgetMonthlyUsd: draft.budgetMonthlyUsd,
    tenure: { retireCriteria: [] },
    status: createStatus,
    // Manifest columns (WP1): a hand-created charter starts empty and is
    // filled in per dimension from the sigil.
    connectors: [],
    procedure: '',
    spec: {},
  });
}
