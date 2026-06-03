/**
 * Standards & branching policy (Pipeline Stage 3).
 *
 * Persisted on `dev_projects.standards_config` as an opaque JSON string (the
 * Rust side validates parseability only — this module owns the shape). The
 * connected team's personas must respect it; it's injected into member
 * executions via team_context + CODEBASE_* env (3c).
 */

/** Branch selector — resolves to the project's main_branch / test_env_branch. */
export type BranchSel = 'main' | 'test';

export interface StandardsConfig {
  precommit: { lint: boolean; docs_required: boolean; code_quality: boolean };
  branching: { pr_base: BranchSel; automerge: { enabled: boolean; target: BranchSel } };
}

export function defaultStandards(): StandardsConfig {
  return {
    precommit: { lint: true, docs_required: true, code_quality: true },
    branching: { pr_base: 'main', automerge: { enabled: false, target: 'main' } },
  };
}

/** Parse the stored JSON into a fully-populated config (defaults fill gaps). */
export function parseStandards(json?: string | null): StandardsConfig {
  if (!json) return defaultStandards();
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
        pr_base: br.pr_base === 'test' ? 'test' : 'main',
        automerge: { enabled: !!am.enabled, target: am.target === 'test' ? 'test' : 'main' },
      },
    };
  } catch {
    return defaultStandards();
  }
}

export function serializeStandards(config: StandardsConfig): string {
  return JSON.stringify(config);
}

/** Resolve a branch selector to its actual branch name for display. */
export function resolveBranchName(sel: BranchSel, mainBranch: string, testEnvBranch: string): string {
  return sel === 'test' ? (testEnvBranch || '—') : (mainBranch || 'main');
}
