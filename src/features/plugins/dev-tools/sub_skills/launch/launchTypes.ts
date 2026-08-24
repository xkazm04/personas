// Skill Launch wire contract — the data shape the Launch tab's UI builders
// consume. One row per workspace project for the selected skill, carrying the
// derived launch status plus the version/sync facts the cell renders.
import type { SkillEntry } from '@/api/devTools/devTools';
import type { DevProject } from '@/lib/bindings/DevProject';

export type LaunchStatus = 'ready' | 'needs_adopt' | 'adopting' | 'running';

export interface ProjectLaunchCell {
  project: DevProject;
  status: LaunchStatus;
  /** Version of the skill installed in this project, if known. */
  installedVersion: string | null;
  /** Version in the registry library, if known. */
  libraryVersion: string | null;
  /** SkillEntry.syncState of the installed copy, if known. */
  syncState: string | null;
  running: boolean;
  adopting: boolean;
}

export interface SkillLaunchData {
  skills: SkillEntry[];
  selectedSkill: string | null;
  setSelectedSkill: (name: string | null) => void;
  cells: ProjectLaunchCell[];
  loading: boolean;
  /** False only when neither pairing nor manifest fallback yielded a root. */
  registryWired: boolean;
  adopt: (cell: ProjectLaunchCell) => Promise<void>;
  launch: (cell: ProjectLaunchCell) => void;
  refresh: () => void;
}
