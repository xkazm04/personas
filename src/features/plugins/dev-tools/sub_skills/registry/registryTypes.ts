// Shared types for the Skills Registry heatmap.
//
// The matrix is skills (rows) × SOMETHING (columns), and there are two
// somethings — which is why the column axis is generic rather than "projects":
//
//   · workspace mode — columns are the workspace's PROJECTS. "Is this skill
//     installed in that repo, and how much of it has it touched?" Empty cells
//     adopt. This is the Dev Tools → Skills → Registry tab.
//   · project mode — columns are ONE project's CONTEXT GROUPS. "Where inside
//     this repo has this skill actually run?" Nothing is adopted per context,
//     so every cell dispatches. This is the Mastermind canvas's Skills modal.
//
// Both render through the same component with the same visual language; only
// the axis, the denominator and the empty-cell affordance differ.
import type { LucideIcon } from 'lucide-react';

export type RegistryMode = 'workspace' | 'project';

/** One column of the matrix — a project, or a context group. */
export interface RegistryColumn {
  id: string;
  name: string;
  /** Spawn cwd for a Fleet dispatch. Per-project in workspace mode; the same
   *  repo root for every column in project mode. */
  rootPath: string;
  /** Coverage denominator: contexts in the project (workspace mode) or in the
   *  group (project mode). */
  units: number;
  /** How many of the matrix's skills are present in this column. */
  presentCount: number;
  /** Column accent; falls back to the model header colour when absent. */
  color?: string | null;
}

export interface RegistrySkill {
  name: string;
  /** Preset visual identity (lens icon + color) or null for a custom skill. */
  visual: { icon: LucideIcon; color: string; label: string } | null;
  /** Display category (frontmatter category, or the preset lens family). */
  category: string;
  /** Stable grouping key. */
  categoryGroup: string;
  /** Columns this skill is present in. */
  adoptedCount: number;
  /** Sum of 30d invokes across the matrix. */
  totalInvokes: number;
  /** Description — the adopt/dispatch confirmation modal shows it. */
  description?: string | null;
}

export interface RegistryCell {
  /** Workspace mode: installed here. Project mode: has touched this group. */
  adopted: boolean;
  /** Units (contexts) of this column the skill has covered. */
  coveredUnits: number;
  invokes30d: number;
  /** A Fleet session is actively dispatching this skill in this column. */
  running: boolean;
}

export interface RegistryModel {
  mode: RegistryMode;
  /** Matrix identity — the workspace, or the project. */
  header: { id: string; name: string; color: string } | null;
  columns: RegistryColumn[];
  skills: RegistrySkill[];
  cell: (skillName: string, columnId: string) => RegistryCell;
  loading: boolean;
}

/** Props the heatmap receives — identical shape in both modes. */
export interface SkillsRegistryProps {
  model: RegistryModel;
  /** In-flight adoptions, keyed `${skill}|${columnId}`. */
  adopting: Set<string>;
  /** Workspace mode only — project mode has nothing to adopt into. */
  onAdopt: (skill: string, columnId: string) => void;
  onUse: (skill: string, columnId: string) => void;
}

export function cellKey(skill: string, columnId: string): string {
  return `${skill}|${columnId}`;
}

export type CellStatus = 'adopted' | 'adopting' | 'blocked' | 'unadopted';

/** The interaction state of a cell. Adoption is blocked while a dispatch of the
 *  skill is still running in that column; parallel adoptions are tracked in the
 *  `adopting` set. */
export function cellStatus(
  cell: RegistryCell, adopting: Set<string>, skill: string, columnId: string,
): CellStatus {
  if (cell.adopted) return 'adopted';
  if (adopting.has(cellKey(skill, columnId))) return 'adopting';
  if (cell.running) return 'blocked';
  return 'unadopted';
}

/** Coverage % (0–100) for a cell against its column's denominator. */
export function coveragePct(cell: RegistryCell, units: number): number {
  return units > 0 ? Math.round((cell.coveredUnits / units) * 100) : 0;
}
