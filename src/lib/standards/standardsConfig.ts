/**
 * Standards & branching policy — shared parse/serialize for the
 * `dev_projects.standards_config` JSON column (the Rust side validates
 * parseability only; this module owns the shape). Two UI surfaces read this
 * column — the dev-tools pipeline (Overview/ProjectModal) and the team
 * passport (readiness matrix) — and used to run two independent, drifted
 * parsers with different empty-config defaults, so the SAME project row
 * rendered differently across the two surfaces. This module is now the single
 * parser both surfaces use.
 *
 * Default policy (reconciled): an empty/unparseable config parses to
 * **all-false / null** — the safe "nothing is actually enforced" read, since
 * that's what's really stored. UI surfaces that want to *pre-fill* an editor
 * with sensible starting values for a project that has no config yet should
 * call {@link defaultStandards} explicitly at the moment the editor opens —
 * never as the parse-time default, so passive reads (dashboards, passport
 * scoring) never assume a gate that was never actually turned on.
 */

/** Branch selector — resolves to the project's main_branch / test_env_branch. */
export type BranchSel = 'main' | 'test';

export interface StandardsConfig {
  precommit: { lint: boolean; docs_required: boolean; code_quality: boolean };
  branching: { pr_base: BranchSel | null; automerge: { enabled: boolean; target: BranchSel | null } };
}

/** Safe read-default: nothing enabled, no branch policy set. Used for parse-time gaps/failures. */
export function emptyStandards(): StandardsConfig {
  return {
    precommit: { lint: false, docs_required: false, code_quality: false },
    branching: { pr_base: null, automerge: { enabled: false, target: null } },
  };
}

/**
 * Sensible starting values for a standards EDITOR opened against a project
 * that has no stored config yet. Intentionally distinct from the parse-time
 * default ({@link emptyStandards}) — apply this only at the moment a user
 * opens the editor, never as what a read-only surface assumes is enforced.
 */
export function defaultStandards(): StandardsConfig {
  return {
    precommit: { lint: true, docs_required: true, code_quality: true },
    branching: { pr_base: 'main', automerge: { enabled: false, target: 'main' } },
  };
}

function toBranchSel(v: unknown): BranchSel | null {
  return v === 'main' || v === 'test' ? v : null;
}

/** Parse the stored JSON into a fully-populated config. Empty/invalid → {@link emptyStandards}. */
export function parseStandards(json?: string | null): StandardsConfig {
  if (!json) return emptyStandards();
  try {
    const v = JSON.parse(json) as Partial<StandardsConfig> & Record<string, unknown>;
    const pc = (v.precommit ?? {}) as Partial<StandardsConfig['precommit']>;
    const br = (v.branching ?? {}) as Partial<StandardsConfig['branching']>;
    const am = (br.automerge ?? {}) as Partial<StandardsConfig['branching']['automerge']>;
    return {
      precommit: {
        lint: !!pc.lint,
        docs_required: !!pc.docs_required,
        code_quality: !!pc.code_quality,
      },
      branching: {
        pr_base: toBranchSel(br.pr_base),
        automerge: { enabled: !!am.enabled, target: toBranchSel(am.target) },
      },
    };
  } catch {
    return emptyStandards();
  }
}

export function serializeStandards(config: StandardsConfig): string {
  return JSON.stringify(config);
}

/** Resolve a branch selector to its actual branch name for display. Null/unset → the main branch. */
export function resolveBranchName(sel: BranchSel | null, mainBranch: string, testEnvBranch: string): string {
  if (sel === 'test') return testEnvBranch || '—';
  return mainBranch || 'main';
}
