// The Manage table's COLUMN LADDER.
//
// Extracted from `ProjectManagerPage` 2026-10-05. Every column renders at
// normal weight - the name included (it was `typo-heading`/700 until the
// Projects consolidation; a bold value in every row of a peer list emphasises
// nothing).
//
// `created` is gone (2026-10-05, owner's note). It was a sortable 110px column
// rendering a bare `YYYY-MM-DD`, which is the one fact about a project nobody
// acts on - the table already carries attention, pulse, status and the switch,
// and the width it took came off the name.
import type { Translations } from '@/i18n/useTranslation';
import type { TtlValueCache } from '@/lib/async/createTtlValueCache';
import type { TableColumn } from '@/features/shared/components/display/UnifiedTable';
import type { PersonaStack } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';

import { StatusBadge, type Project } from './projectManagerTypes';
import { ProjectSwitchCell } from './projectSwitch/ProjectSwitchCell';
import { AttentionCell, PulseCell } from './ProjectPulseCells';
import type { ProjectPulse } from './useProjectPulse';
import { MembersCell, RowActionsCell, RowSelectCell, SelectAllHeader } from './projectTableCells';
import { TechStackCell } from './TechStackCell';

export interface ProjectColumnsDeps {
  t: Translations;
  selectedIds: Set<string>;
  allSelected: boolean;
  selectableCount: number;
  onToggleSelection: (id: string) => void;
  onToggleSelectAll: () => void;
  rosters: TtlValueCache<string[]>;
  personaIndex: Parameters<typeof PersonaStack>[0]['index'];
  teamCounts: Record<string, { members: number }>;
  pulses: TtlValueCache<ProjectPulse>;
  onEnterTeam: (teamId: string) => void;
  onEditProject: (id: string) => void;
}

export function buildProjectColumns(d: ProjectColumnsDeps): TableColumn<Project>[] {
  const { t } = d;
  return [
    {
      key: 'select',
      label: '',
      width: '40px',
      // Select-all lives in this column's header via filterComponent.
      filterComponent: (
        <SelectAllHeader
          allSelected={d.allSelected}
          disabled={d.selectableCount === 0}
          onToggle={d.onToggleSelectAll}
        />
      ),
      render: (project) => (
        <RowSelectCell
          project={project}
          selected={d.selectedIds.has(project.id)}
          onToggle={d.onToggleSelection}
        />
      ),
    },
    {
      key: 'name',
      label: t.plugins.dev_tools.col_name,
      // Widest in the ladder, and wider still now that `created` is gone: the
      // name is the one column a long value belongs in.
      width: 'minmax(220px, 1.8fr)',
      sortable: true,
      sortFn: (a, b) => a.name.localeCompare(b.name),
      render: (project) => (
        <span className="typo-body text-foreground flex items-center gap-2 min-w-0">
          <span className="truncate">{project.name}</span>
        </span>
      ),
    },
    {
      key: 'members',
      label: t.pipeline.team_studio.col_members,
      width: '120px',
      render: (project) => (
        <MembersCell
          project={project}
          rosters={d.rosters}
          personaIndex={d.personaIndex}
          teamCounts={d.teamCounts}
          onEnterTeam={d.onEnterTeam}
        />
      ),
    },
    {
      key: 'tech',
      label: t.plugins.dev_tools.col_tech_stack,
      width: 'minmax(100px, 0.9fr)',
      render: (project) => <TechStackCell tokens={project.techStack} />,
    },
    {
      key: 'attention',
      label: t.plugins.dev_projects.col_attention,
      width: '96px',
      sortable: true,
      // Unmeasured sorts LAST on the "needs me" pass rather than mixing in with
      // a measured 0 - an unwatched project is a question, not an answer.
      sortFn: (a, b) => {
        const av = d.pulses.get(a.id)?.attention;
        const bv = d.pulses.get(b.id)?.attention;
        if (av === undefined || av === null) return bv === undefined || bv === null ? 0 : 1;
        if (bv === undefined || bv === null) return -1;
        return bv - av;
      },
      render: (project) => <AttentionCell pulse={d.pulses.get(project.id)} />,
    },
    {
      key: 'pulse',
      label: t.plugins.dev_projects.col_pulse,
      width: '104px',
      render: (project) => <PulseCell pulse={d.pulses.get(project.id)} />,
    },
    {
      key: 'status',
      label: t.plugins.dev_tools.col_status,
      width: '110px',
      render: (project) => <StatusBadge status={project.status} />,
    },
    {
      // The project switch - same act as the Monitor column's right-click.
      key: 'enabled',
      label: t.plugins.dev_projects.project_state_on,
      width: '96px',
      sortable: true,
      sortFn: (a, b) => Number(a.enabled) - Number(b.enabled),
      render: (project) => <ProjectSwitchCell projectId={project.id} />,
    },
    {
      key: 'actions',
      label: '',
      width: '132px',
      align: 'right',
      render: (project) => (
        <RowActionsCell project={project} onEdit={() => d.onEditProject(project.id)} />
      ),
    },
  ];
}
