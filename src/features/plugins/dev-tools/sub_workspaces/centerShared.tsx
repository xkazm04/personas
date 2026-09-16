// Shared data hook + leaf components for the Workspaces module (Atlas shell).
// Hoisted so every refinement is made once. Strings hardcoded-EN until
// consolidation.
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { resolveTechIcon } from '@/features/teams/sub_factory/passport/techIcons';
import type { DevProject } from '@/lib/bindings/DevProject';
import { useSystemStore } from '@/stores/systemStore';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';

import {
  assignProject,
  createWorkspace,
  useWorkspaces,
  type Workspace,
} from './workspaceStore';

// -- data --------------------------------------------------------------------

export interface WorkspaceCenter {
  workspaces: Workspace[];
  activeId: string | null;
  projects: DevProject[];
  projectById: Map<string, DevProject>;
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** One hook feeding the shell: store snapshot + projects. (It also fetched each
 *  workspace's knowledge library until that library was retired.) */
export function useWorkspaceCenter(): WorkspaceCenter {
  const { workspaces, activeId } = useWorkspaces();
  const projects = useSystemStore((s) => s.projects);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);

  useEffect(() => {
    if (projects.length === 0) void fetchProjects();
  }, [projects.length, fetchProjects]);

  const sortedProjects = useMemo(() => [...projects].sort(byName), [projects]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  return useMemo(
    () => ({ workspaces, activeId, projects: sortedProjects, projectById }),
    [workspaces, activeId, sortedProjects, projectById],
  );
}

// -- leaf components ---------------------------------------------------------

/** Compact brand-icon strip for a project's tech stack — passport-wall visual
 *  language, sized for a one-line project row. Unmatched tokens are dropped
 *  (the row must stay one line); if nothing matches, nothing renders. */
export function TechIconStrip({ techStack, max = 5 }: { techStack: string | null; max?: number }) {
  const matches = useMemo(() => {
    if (!techStack) return [];
    const seen = new Set<string>();
    const out: { title: string; path: string; color?: string; label: string }[] = [];
    for (const raw of techStack.split(/[,/+·;|]/)) {
      const label = raw.trim();
      if (!label) continue;
      const match = resolveTechIcon(label);
      if (match && !seen.has(match.icon.title)) {
        seen.add(match.icon.title);
        out.push({ ...match.icon, label });
      }
    }
    return out;
  }, [techStack]);

  if (matches.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      {matches.slice(0, max).map((m) => (
        <Tooltip key={m.title} content={m.label}>
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill={m.color ?? 'currentColor'}
            aria-label={m.title}
            className="flex-shrink-0"
          >
            <path d={m.path} />
          </svg>
        </Tooltip>
      ))}
      {matches.length > max && (
        <span className="typo-caption text-muted-foreground">+{matches.length - max}</span>
      )}
    </span>
  );
}

/** Two-column membership editor: members left, rest of the portfolio right;
 *  a project lives in exactly one workspace. One row per project, name-asc. */
export function MembershipPanel({
  workspace,
  projects,
}: {
  workspace: Workspace;
  projects: DevProject[];
}) {
  const { t, tx } = useTranslation();
  const tw = t.plugins.dev_tools.workspaces;
  const memberSet = new Set(workspace.projectIds);
  const members = projects.filter((p) => memberSet.has(p.id));
  const candidates = projects.filter((p) => !memberSet.has(p.id));

  return (
    <div className="grid grid-cols-2 gap-3 min-w-0">
      <div className="min-w-0">
        <div className="typo-label text-muted-foreground mb-2">
          {tx(tw.members_count, { count: members.length })}
        </div>
        <div className="flex flex-col gap-1">
          {members.length === 0 && (
            <p className="typo-body text-muted-foreground">{tw.no_projects_yet}</p>
          )}
          {members.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              actionIcon={<X className="w-3.5 h-3.5" />}
              actionLabel={tw.remove_from_workspace}
              onAction={() => assignProject(p.id, null)}
            />
          ))}
        </div>
      </div>
      <div className="min-w-0">
        <div className="typo-label text-muted-foreground mb-2">
          {tx(tw.other_projects, { count: candidates.length })}
        </div>
        <div className="flex flex-col gap-1">
          {candidates.length === 0 && (
            <p className="typo-body text-muted-foreground">{tw.every_project_member}</p>
          )}
          {candidates.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              actionIcon={<ArrowRight className="w-3.5 h-3.5" />}
              actionLabel={tw.add_to_workspace}
              onAction={() => assignProject(p.id, workspace.id)}
              subdued={Boolean(p.workspace_id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProjectRow({
  project,
  actionIcon,
  actionLabel,
  onAction,
  subdued,
}: {
  project: DevProject;
  actionIcon: React.ReactNode;
  actionLabel: string;
  onAction: () => void;
  subdued?: boolean;
}) {
  return (
    <div
      className={`group flex items-center gap-2 rounded-interactive border border-primary/10 px-2.5 py-1.5 min-w-0 ${
        subdued ? 'opacity-70' : ''
      } hover:bg-secondary/40 transition-colors`}
    >
      <span className="typo-body text-foreground truncate min-w-0 flex-1">{project.name}</span>
      <TechIconStrip techStack={project.tech_stack} />
      <button
        type="button"
        aria-label={actionLabel}
        onClick={onAction}
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-foreground/80 hover:text-foreground rounded-interactive p-1 hover:bg-primary/10 transition-all"
      >
        {actionIcon}
      </button>
    </div>
  );
}

/** Inline "name → create" form shared by the shell's empty/new states. */
export function CreateWorkspaceInline({ autoFocus }: { autoFocus?: boolean }) {
  const { t } = useTranslation();
  const tw = t.plugins.dev_tools.workspaces;
  const [name, setName] = useState('');
  const [adoptSkills, setAdoptSkills] = useState(false);
  const submit = () => {
    if (!name.trim()) return;
    createWorkspace(name, undefined, adoptSkills);
    setName('');
    setAdoptSkills(false);
  };
  return (
    <form
      className="flex flex-col gap-2 min-w-0 flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-center gap-2">
        <input
          className={INPUT_FIELD}
          placeholder={tw.workspace_name_placeholder}
          value={name}
          autoFocus={autoFocus}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="typo-body shrink-0 rounded-interactive border border-primary/20 bg-primary/10 px-3 py-2 text-foreground hover:bg-primary/15 disabled:opacity-40 transition-colors"
        >
          {tw.create}
        </button>
      </div>
      {/* Consent to seed the app's preset scan skills into member projects. */}
      <label className="flex items-start gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={adoptSkills}
          onChange={(e) => setAdoptSkills(e.target.checked)}
          className="mt-0.5 accent-[var(--color-primary)] flex-shrink-0"
          data-testid="workspace-adopt-skills"
        />
        <span className="min-w-0">
          <span className="typo-caption text-foreground block">{tw.adopt_skills_label}</span>
          <span className="typo-caption block">{tw.adopt_skills_hint}</span>
        </span>
      </label>
    </form>
  );
}
