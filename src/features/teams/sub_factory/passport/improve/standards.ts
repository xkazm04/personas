// Standards & branching policy — the Tier-0 (instant, reversible, no-code) upgrade
// engine for the passport matrix. A project's `standards_config` JSON drives its
// CI level, security policy, and self-verify pips in the passport; toggling these
// golden-standard practices is the cheapest readiness lift. Single source of truth
// for parsing the shape (also consumed by passportDerive) + the action catalog.
import type { DevProject } from '@/lib/bindings/DevProject';

export interface Standards {
  precommit: { lint: boolean; docs_required: boolean; code_quality: boolean };
  branching: { pr_base: string | null; automerge: { enabled: boolean; target: string | null } };
}

function empty(): Standards {
  return { precommit: { lint: false, docs_required: false, code_quality: false }, branching: { pr_base: null, automerge: { enabled: false, target: null } } };
}

export function parseStandards(raw: string | null | undefined): Standards {
  if (!raw) return empty();
  try {
    const j = JSON.parse(raw) as {
      precommit?: { lint?: unknown; docs_required?: unknown; code_quality?: unknown };
      branching?: { pr_base?: unknown; automerge?: { enabled?: unknown; target?: unknown } };
    };
    return {
      precommit: {
        lint: Boolean(j?.precommit?.lint),
        docs_required: Boolean(j?.precommit?.docs_required),
        code_quality: Boolean(j?.precommit?.code_quality),
      },
      branching: {
        pr_base: typeof j?.branching?.pr_base === 'string' ? j.branching.pr_base : null,
        automerge: {
          enabled: Boolean(j?.branching?.automerge?.enabled),
          target: typeof j?.branching?.automerge?.target === 'string' ? j.branching.automerge.target : null,
        },
      },
    };
  } catch {
    return empty();
  }
}

export function serializeStandards(s: Standards): string {
  return JSON.stringify(s);
}

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
    apply: (s, p) => ({ ...s, branching: { ...s.branching, pr_base: p.main_branch ?? 'main' } }),
  },
  {
    id: 'automerge',
    label: 'Auto-merge on green',
    hint: 'Merge automatically once checks pass',
    row: 'ci',
    applicable: (s) => !s.branching.automerge.enabled,
    apply: (s, p) => {
      const base = s.branching.pr_base ?? p.main_branch ?? 'main';
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
