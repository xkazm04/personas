// Shared types for the Skills Registry tab — a workspace-wide coverage matrix:
// library skills (rows) × the workspace's projects (columns). Every directional
// variant receives the same `SkillsRegistryProps` so they stay swappable behind
// the prototype switcher.
import type { LucideIcon } from 'lucide-react';

import type { SkillCoverageRow } from '@/api/devTools/devTools';

export interface RegistryProject {
  id: string;
  name: string;
  /** Spawn cwd for a Fleet dispatch of a skill in this project. */
  rootPath: string;
  techStack: string[];
  /** Coverage denominator — the project's total dev_contexts. */
  totalContexts: number;
  /** How many library skills are installed in this project. */
  adoptedCount: number;
}

export interface RegistrySkill {
  name: string;
  /** Preset visual identity (lens icon + color) or null for a custom skill. */
  visual: { icon: LucideIcon; color: string; label: string } | null;
  /** Display category (frontmatter category, or the preset lens family). */
  category: string;
  /** Stable grouping key. */
  categoryGroup: string;
  /** Projects in the workspace that have it installed. */
  adoptedCount: number;
  /** Sum of 30d invokes across the workspace's projects. */
  totalInvokes: number;
}

export interface RegistryCell {
  adopted: boolean;
  coverage: SkillCoverageRow | undefined;
  invokes30d: number;
  /** A Fleet session is actively dispatching this skill in this project. */
  running: boolean;
}

export interface RegistryModel {
  workspace: { id: string; name: string; color: string } | null;
  projects: RegistryProject[];
  skills: RegistrySkill[];
  cell: (skillName: string, projectId: string) => RegistryCell;
  loading: boolean;
}

/** Props every Registry variant receives — identical shape → swappable. */
export interface SkillsRegistryProps {
  model: RegistryModel;
  /** In-flight adoptions, keyed `${skill}|${projectId}`. */
  adopting: Set<string>;
  onAdopt: (skill: string, projectId: string) => void;
  onUse: (skill: string, projectId: string) => void;
}

export function cellKey(skill: string, projectId: string): string {
  return `${skill}|${projectId}`;
}

export type CellStatus = 'adopted' | 'adopting' | 'blocked' | 'unadopted';

/** The interaction state of a cell. Adoption is blocked while a dispatch of the
 *  skill is still running in that project; parallel adoptions are tracked in the
 *  `adopting` set. */
export function cellStatus(
  cell: RegistryCell, adopting: Set<string>, skill: string, projectId: string,
): CellStatus {
  if (cell.adopted) return 'adopted';
  if (adopting.has(cellKey(skill, projectId))) return 'adopting';
  if (cell.running) return 'blocked';
  return 'unadopted';
}

/** Coverage % (0–100) for a cell, given the project's context total. */
export function coveragePct(cell: RegistryCell, totalContexts: number): number {
  const covered = cell.coverage?.coveredContexts ?? 0;
  return totalContexts > 0 ? Math.round((covered / totalContexts) * 100) : 0;
}
