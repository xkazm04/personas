// Standards & branching policy — the Tier-0 (instant, reversible, no-code) upgrade
// engine for the passport matrix. A project's `standards_config` JSON drives its
// CI level, security policy, and self-verify pips in the passport; toggling these
// golden-standard practices is the cheapest readiness lift. The parse/serialize
// shape itself lives in the shared `@/lib/standards/standardsConfig` module
// (also consumed by the dev-tools pipeline UI, so both surfaces agree on what
// an empty config means) — this module owns the action catalog on top of it.
import type { DevProject } from '@/lib/bindings/DevProject';
import {
  type StandardsConfig, parseStandards, serializeStandards,
} from '@/lib/standards/standardsConfig';

export type Standards = StandardsConfig;
export { parseStandards, serializeStandards };

/** Is `standards_config` already fully golden (every action enabled)? */
export function isGolden(raw: string | null | undefined): boolean {
  return applicableStandardsActions(raw).length === 0;
}

export interface StandardsAction {
  id: string;
  label: string;
  hint: string;
  /** Which passport row this most directly lifts (for grouping / emphasis). */
  row: 'selfverify' | 'ci' | 'security';
  /** Offer only when it isn't already satisfied. */
  applicable: (s: Standards) => boolean;
  /** Pure transform — returns a new Standards with this practice enabled. */
  apply: (s: Standards, project: DevProject) => Standards;
}

export const STANDARDS_ACTIONS: StandardsAction[] = [
  {
    id: 'lint',
    label: 'Enable lint gate',
    hint: 'Require lint to pass before a commit lands',
    row: 'selfverify',
    applicable: (s) => !s.precommit.lint,
    apply: (s) => ({ ...s, precommit: { ...s.precommit, lint: true } }),
  },
  {
    id: 'code_quality',
    label: 'Enable type / quality gate',
    hint: 'Require typecheck + code-quality checks',
    row: 'selfverify',
    applicable: (s) => !s.precommit.code_quality,
    apply: (s) => ({ ...s, precommit: { ...s.precommit, code_quality: true } }),
  },
  {
    id: 'gate',
    label: 'Gate merges on the default branch',
    hint: 'PRs must target the project base branch',
    row: 'ci',
    applicable: (s) => !s.branching.pr_base,
    // pr_base is a *selector* ('main' | 'test'), not the literal branch name —
    // the project's actual main_branch is resolved for display elsewhere
    // (resolveBranchName), so gating always targets the 'main' selector.
    apply: (s) => ({ ...s, branching: { ...s.branching, pr_base: 'main' } }),
  },
  {
    id: 'automerge',
    label: 'Auto-merge on green',
    hint: 'Merge automatically once checks pass',
    row: 'ci',
    applicable: (s) => !s.branching.automerge.enabled,
    apply: (s) => {
      const base = s.branching.pr_base ?? 'main';
      return { ...s, branching: { pr_base: base, automerge: { enabled: true, target: base } } };
    },
  },
  {
    id: 'docs',
    label: 'Require docs in PRs',
    hint: 'Block PRs that ship without doc updates',
    row: 'security',
    applicable: (s) => !s.precommit.docs_required,
    apply: (s) => ({ ...s, precommit: { ...s.precommit, docs_required: true } }),
  },
];

export function applicableStandardsActions(raw: string | null | undefined): StandardsAction[] {
  const s = parseStandards(raw);
  return STANDARDS_ACTIONS.filter((a) => a.applicable(s));
}

/** Fold a set of actions over the current standards to get the projected config. */
export function applyStandardsActions(s: Standards, actions: StandardsAction[], project: DevProject): Standards {
  return actions.reduce((acc, a) => a.apply(acc, project), s);
}
