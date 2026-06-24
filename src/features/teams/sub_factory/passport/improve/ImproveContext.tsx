// Improve engine context — lets any matrix cell reach the row-action machinery
// without prop-drilling through the table. Holds the raw data (DevProject + scan
// metadata) needed to project a hypothetical passport, and the executor that
// writes a config change and re-derives. Provided by ProjectsLayer.
import { createContext, useContext } from 'react';

import type { DevProject } from '@/lib/bindings/DevProject';
import type { CrossProjectProjectMetadata, RepoEvidence } from '@/api/devTools/devTools';

export interface ImproveRaw {
  project: DevProject;
  meta: CrossProjectProjectMetadata;
  /** Whether the project has reusable skills in `.claude/skills` (drives the passport). */
  hasSkills?: boolean;
  /** Deterministic repo file-evidence (D1) — real test/CI/CLAUDE.md/migration signals. */
  evidence?: RepoEvidence | null;
  /** Skills installed elsewhere (other projects / global) but missing here. */
  skillsToAdd?: { name: string; source: string | null; description: string | null }[];
}

export interface ImproveEngine {
  /** Raw project row + its scan metadata, for projecting a hypothetical passport. */
  getRaw: (slug: string) => ImproveRaw | undefined;
  /** Every project's raw row — backs cross-project batch ("apply to all N"). */
  allRaw: () => ImproveRaw[];
  /** Write a project's standards_config and re-derive the matrix (Tier-0). */
  applyStandards: (slug: string, standardsJson: string) => Promise<void>;
  /** Run the project's context scan (Tier-1) — maps the repo into the graph. Returns the scan id. */
  runContextScan: (slug: string) => Promise<string | undefined>;
  /** Bind a vault credential to a project slot (Tier-2 connector wire) + re-derive. */
  bindConnector: (slug: string, credentialId: string, field: 'monitoring' | 'pr' | 'llm_tracking') => Promise<void>;
  /** Install reusable skills (from sibling projects / global) into the project + re-derive. */
  installSkills: (slug: string, items: { name: string; source: string | null }[]) => Promise<void>;
  /** Queue a Claude-Code upgrade task (Tier-3) without running it yet. */
  queueTask: (slug: string, title: string, prompt: string) => Promise<void>;
  /** Queue AND dispatch a Claude-Code upgrade task — runs the CLI, auto-PRs on green. Returns the task id. */
  deployNow: (slug: string, title: string, prompt: string) => Promise<string>;
}

const ImproveContext = createContext<ImproveEngine | null>(null);

export const ImproveProvider = ImproveContext.Provider;

export function useImprove(): ImproveEngine | null {
  return useContext(ImproveContext);
}
