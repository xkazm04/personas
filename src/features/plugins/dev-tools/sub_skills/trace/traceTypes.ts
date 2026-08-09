// Trace tab types — the two-level traceability model over workspace skills
// (docs/skill-standard.md; plan: heat matrix overview → per-skill tree).
// Deliberately independent of registryTypes: Trace is about ACTIVITY and
// VERSION FLOW, Registry about adoption/coverage operations.
import type { LucideIcon } from 'lucide-react';

import type { SkillLessonRow, SkillRevisionRow } from '@/api/devTools/devTools';

/** Recency-weighted activity tier of one (skill × project) cell.
 *  `cold` = adopted but no recent invokes — the drift-risk signal;
 *  `absent` = not installed there at all. */
export type HeatTier = 'hot' | 'warm' | 'cool' | 'cold' | 'absent';

export interface TraceCell {
  adopted: boolean;
  invokes30d: number;
  /** ms epoch of the last invocation, or null. */
  lastInvokedAt: number | null;
  /** Normalized 0..1 against the matrix maximum. */
  heat: number;
  tier: HeatTier;
  installedVersion: string | null;
  /** SkillEntry.syncState pass-through ('in_sync' | 'diverged' | 'local_only'). */
  syncState: string | null;
}

export interface TraceSkillRow {
  name: string;
  visual: { icon: LucideIcon; color: string; label: string } | null;
  /** Frontmatter `contexts: tracked` on the library copy — drives the row
   *  icon (context-specific vs context-agnostic method). */
  contextTracked: boolean;
  libraryVersion: string | null;
  /** Sum of cell heat across projects — the row ranking key. */
  totalHeat: number;
  adoptedCount: number;
  totalInvokes: number;
}

export interface TraceProject {
  id: string;
  name: string;
  rootPath: string;
}

export interface TraceModel {
  /** The workspace under inspection (null = none configured). */
  header: { id: string; name: string; color: string | null } | null;
  projects: TraceProject[];
  /** Ranked by totalHeat desc, then name. */
  skills: TraceSkillRow[];
  cell: (skillName: string, projectId: string) => TraceCell;
  loading: boolean;
}

/** Version drift of a project's copy vs the workspace library. */
export type DriftState = 'in_sync' | 'behind' | 'ahead' | 'customized' | 'unversioned';

export interface TreeBranch {
  project: TraceProject;
  /** 0..1 usage share across branches (max-normalized). */
  weight: number;
  invokes30d: number;
  lastInvokedAt: number | null;
  installedVersion: string | null;
  drift: DriftState;
  /** This project's lessons for the skill. */
  lessons: SkillLessonRow[];
}

export interface SkillTreeModel {
  skillName: string;
  visual: { icon: LucideIcon; color: string; label: string } | null;
  /** `contexts: tracked` on the library copy (icon semantics, mirrors L1). */
  contextTracked: boolean;
  libraryVersion: string | null;
  totalInvokes: number;
  /** Sorted weight desc. */
  branches: TreeBranch[];
  /** Library revision history, newest first. */
  timeline: SkillRevisionRow[];
  /** Lessons found on the library copy (no project attribution). */
  workspaceLessons: SkillLessonRow[];
  loading: boolean;
}
