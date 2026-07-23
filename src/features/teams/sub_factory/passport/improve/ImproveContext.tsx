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
  /** Shared-vs-codebase-specific skill tallies + dormant count (see usePassportData). */
  skillCounts?: { reused: number; own: number; dormant?: number };
  /** Usage telemetry per INSTALLED skill (P1 transcript mining). */
  skillUsage?: Record<string, { invokes30d: number; lastInvokedAt: string | null; dormant: boolean }>;
  /** Source-side liveliness per ADOPTABLE skill (how alive it is where it lives). */
  catalogUsage?: Record<string, { invokes30d: number; lastInvokedAt: string | null }>;
  /** Doc-rot rollup (P2 git scan): absent = the scan hasn't run for this project. */
  docRot?: { tracked: number; dirty: number; neverRead: number };
  /** Memory-health snapshot rollup (P3): absent = no bound team / sweep not run. */
  memHealth?: { score: number; prevScore: number | null; disputed: number; capturedAt: string };
  /** Deterministic repo file-evidence (D1) — real test/CI/CLAUDE.md/migration signals. */
  evidence?: RepoEvidence | null;
  /** Skills installed elsewhere (other projects / global) but missing here. */
  skillsToAdd?: { name: string; source: string | null; description: string | null }[];
  /** This project's skills the global library doesn't have yet — shareable. */
  skillsToShare?: { name: string; description: string | null }[];
}

export interface ImproveEngine {
  /** Raw project row + its scan metadata, for projecting a hypothetical passport. */
  getRaw: (slug: string) => ImproveRaw | undefined;
  /** Every project's raw row — backs cross-project batch ("apply to all N"). */
  allRaw: () => ImproveRaw[];
  /** Write a project's standards_config and re-derive the matrix (Tier-0). */
  applyStandards: (slug: string, standardsJson: string) => Promise<void>;
  /** Run the project's context scan (Tier-1) — maps the repo into contexts.
   *  `delta` = incremental (only re-derives what changed since the last scan,
   *  same delta_mode as the Dev-Tools Context Map). Returns the scan id. */
  runContextScan: (slug: string, delta?: boolean) => Promise<string | undefined>;
  /** Bind a vault credential to a project slot (Tier-2 connector wire) + re-derive. */
  bindConnector: (slug: string, credentialId: string, field: 'monitoring' | 'pr' | 'llm_tracking') => Promise<void>;
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
