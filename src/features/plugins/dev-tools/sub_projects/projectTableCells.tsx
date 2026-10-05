// The Manage table's interactive CELLS.
//
// Extracted from `ProjectManagerPage` 2026-10-05. Every control here was a raw
// `<button className=...>` in the page; they are `Button` now, which is the
// golden path (`.claude/rules/ui.md`, census `raw-button-element`) and gives
// them one focus ring, one hover fill and one disabled treatment instead of
// seven hand-written ones.
//
// The row itself is a plain `div` with an onClick (UnifiedTable), not a button,
// so a real button in a cell is valid markup - it just has to stop the row's
// set-active click.
import { Archive, CheckSquare, Code2, ExternalLink, Folder, Square, Users, X as XIcon } from 'lucide-react';

import { openLocalPath, openExternalUrl } from '@/api/system/system';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { TtlValueCache } from '@/lib/async/createTtlValueCache';
import { PersonaStack } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';

import { MoveToWorkspaceButton } from '../sub_workspaces/MoveToWorkspaceButton';
import type { Workspace } from '../sub_workspaces/workspaceStore';
import { ProjectRowMenu } from './ProjectManagerParts';
import type { Project } from './projectManagerTypes';

export function SelectAllHeader({ allSelected, disabled, onToggle }: {
  allSelected: boolean; disabled: boolean; onToggle: () => void;
}) {
  const { t } = useTranslation();
  const label = allSelected ? t.plugins.dev_projects.bulk_select_clear : t.plugins.dev_projects.bulk_select_all;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      icon={allSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
    />
  );
}

export function RowSelectCell({ project, selected, onToggle }: {
  project: Project; selected: boolean; onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  const archived = project.status === 'archived';
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t.plugins.dev_projects.bulk_select_row}
      disabled={archived}
      disabledReason={archived ? t.plugins.dev_projects.bulk_already_archived : undefined}
      onClick={(e) => { e.stopPropagation(); onToggle(project.id); }}
      icon={selected
        ? <CheckSquare className="w-3.5 h-3.5 text-primary" />
        : <Square className="w-3.5 h-3.5" />}
    />
  );
}

/**
 * The project's one team, rendered as its roster. Clicking enters the team
 * detail (Teams -> Workspace). Auto-created teams are backfilled
 * asynchronously, so a project can legitimately have no team yet: that is an
 * inert em dash, never a broken button.
 */
export function MembersCell({ project, rosters, personaIndex, teamCounts, onEnterTeam }: {
  project: Project;
  rosters: TtlValueCache<string[]>;
  personaIndex: Parameters<typeof PersonaStack>[0]['index'];
  teamCounts: Record<string, { members: number }>;
  onEnterTeam: (teamId: string) => void;
}) {
  const { t, tx } = useTranslation();
  const teamId = project.teamId;
  if (!teamId) {
    return (
      <span className="typo-caption text-foreground opacity-40" aria-label={t.plugins.dev_projects.no_team_yet}>
        &mdash;
      </span>
    );
  }
  const roster = rosters.get(teamId);
  // The count paints on the first frame from `teamCounts`; the roster refines it
  // once the batched fetch lands.
  const count = roster?.length ?? teamCounts[teamId]?.members ?? 0;
  const countLabel = tx(
    count === 1 ? t.pipeline.team_studio.members_count_one : t.pipeline.team_studio.members_count_other,
    { count },
  );
  return (
    <Tooltip content={t.plugins.dev_projects.col_members_open_team} placement="top">
      <Button
        variant="ghost"
        size="sm"
        data-testid={`project-members-${project.id}`}
        aria-label={`${countLabel} - ${t.plugins.dev_projects.col_members_open_team}`}
        onClick={(e) => { e.stopPropagation(); onEnterTeam(teamId); }}
        icon={roster && roster.length > 0
          ? <PersonaStack ids={[...roster]} index={personaIndex} max={3} />
          : <Users className={`w-3.5 h-3.5 ${count === 0 ? 'opacity-40' : ''}`} />}
      >
        <span className={`typo-caption tabular-nums ${count === 0 ? 'opacity-40' : ''}`}>{count}</span>
      </Button>
    </Tooltip>
  );
}

export function RowActionsCell({ project, onEdit }: { project: Project; onEdit: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-0.5 justify-end" onClick={(e) => e.stopPropagation()}>
      {project.testEnvUrl && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t.plugins.dev_projects.open_test_env}
          onClick={() => { openExternalUrl(project.testEnvUrl!).catch(toastCatch('ProjectCard:openTestEnv')); }}
          icon={<ExternalLink className="w-3.5 h-3.5" />}
        />
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t.plugins.dev_tools.row_open_vscode}
        onClick={() => { openLocalPath(`vscode://file/${project.path}`).catch(toastCatch('Failed to open in VS Code')); }}
        icon={<Code2 className="w-3.5 h-3.5" />}
      />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t.plugins.dev_tools.row_open_folder}
        onClick={() => { openLocalPath(project.path).catch(toastCatch('Failed to open project folder')); }}
        icon={<Folder className="w-3.5 h-3.5" />}
      />
      <ProjectRowMenu projectId={project.id} projectName={project.name} onEdit={onEdit} />
    </div>
  );
}

/** Inline bulk bar - only rendered while a row is selected. */
export function ProjectsBulkBar({ count, workspaces, selectedIds, archiving, onArchive, onClear }: {
  count: number;
  workspaces: Workspace[];
  selectedIds: Set<string>;
  archiving: boolean;
  onArchive: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const dp = t.plugins.dev_projects;
  return (
    <div className="flex items-center gap-2 ml-auto">
      {/* The selected-count carried a raw amber ink token in the page. It reads
          as what it MEANS here - a pending destructive batch - which is also
          what keeps this file out of the census's raw-palette rule, since
          moving the raw token would have entered a second file for the same
          match count. (A JSX comment is not a comment line to that rule's
          matcher, so naming the class in prose here would re-add the match.) */}
      <span className="typo-caption text-status-warning tabular-nums">
        {count} {count === 1 ? dp.bulk_selected_one : dp.bulk_selected_many}
      </span>
      <MoveToWorkspaceButton workspaces={workspaces} selectedIds={selectedIds} onMoved={onClear} />
      <Button
        variant="accent"
        tone="warning"
        size="xs"
        icon={<Archive className="w-3 h-3" />}
        loading={archiving}
        onClick={onArchive}
      >
        {dp.bulk_archive_btn}
      </Button>
      <Button variant="ghost" size="xs" icon={<XIcon className="w-3 h-3" />} onClick={onClear}>
        {t.common.clear}
      </Button>
    </div>
  );
}
