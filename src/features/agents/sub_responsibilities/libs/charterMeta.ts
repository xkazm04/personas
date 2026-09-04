import type { StatusVariant } from '@/features/shared/components/display/StatusBadge';
import type { PersonaResponsibility } from '@/lib/bindings/PersonaResponsibility';
import type { ResponsibilityCadence } from '@/lib/bindings/ResponsibilityCadence';
import type { ResponsibilityObjective } from '@/lib/bindings/ResponsibilityObjective';
import type { ResponsibilityOutcome } from '@/lib/bindings/ResponsibilityOutcome';

/**
 * Refusal-class vocabulary offered by the picker. The server is the invariant
 * holder, not this file: intake re-validates every class and refuses a bare
 * string outside its libraries (see `src-tauri/engine/src/responsibility.rs`),
 * so drift here fails loudly at save time instead of storing a charter that
 * only looks strict.
 */
export const DOMAIN_SOFTWARE_ENGINEERING = 'software_engineering';
export const DOMAIN_GENERAL = 'general';

export const SOFTWARE_ENGINEERING_CLASSES = [
  'test_deletion_or_skip',
  'suppression_directive',
  'gate_configuration',
  'dependency_bump_to_satisfy_check',
  'credentials_or_permissions',
  'delivery_configuration',
] as const;

export const GENERAL_CLASSES = [
  'ExternalSend',
  'CredentialUse',
  'DataDeletion',
  'PublicPublish',
] as const;

export const CUSTOM_CLASS_PREFIX = 'custom:';

/** The refusal-class library for a domain (any unknown domain gets general). */
export function classesForDomain(domain: string): readonly string[] {
  return domain === DOMAIN_SOFTWARE_ENGINEERING
    ? SOFTWARE_ENGINEERING_CLASSES
    : GENERAL_CLASSES;
}

/** Rung ceiling mirrored from `MAX_GRANTABLE_RUNG` (App-master mandate intake). */
export const MAX_SCOPE_RUNG = 2;

export const STATUS_VARIANT: Record<string, StatusVariant> = {
  draft: 'neutral',
  active: 'success',
  suspended: 'warning',
  retired: 'neutral',
};

/** A local, editable draft of a charter (create + edit share it). */
export interface ResponsibilityDraft {
  title: string;
  domain: string;
  owner: string;
  scopeRung: number;
  outcomes: ResponsibilityOutcome[];
  objectives: ResponsibilityObjective[];
  refusalClasses: string[];
  cadence: ResponsibilityCadence;
  /** Blank input = no budget (cleared on update). */
  budgetMonthlyUsd: number | undefined;
}

export function draftFromResponsibility(r: PersonaResponsibility): ResponsibilityDraft {
  return {
    title: r.title,
    domain: r.domain,
    owner: r.owner,
    scopeRung: r.scopeRung,
    outcomes: r.outcomes.map((o) => ({ ...o, successCriteria: [...o.successCriteria] })),
    objectives: r.objectives.map((o) => ({ ...o })),
    refusalClasses: [...r.refusalClasses],
    cadence: { ...r.cadence },
    budgetMonthlyUsd: r.budgetMonthlyUsd,
  };
}

export function emptyDraft(): ResponsibilityDraft {
  return {
    title: '',
    domain: DOMAIN_GENERAL,
    owner: '',
    scopeRung: 0,
    outcomes: [],
    objectives: [],
    refusalClasses: [],
    cadence: { attentionEnabled: false },
    budgetMonthlyUsd: undefined,
  };
}
