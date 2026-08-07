// Shared data hook + leaf components for the Workspaces module (Atlas shell).
// Hoisted so every refinement is made once. Strings hardcoded-EN until
// consolidation.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';

import { listWorkspaceKnowledge, type KnowledgeStatus } from '@/api/devTools/workspaces';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { resolveTechIcon } from '@/features/teams/sub_factory/passport/techIcons';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { WorkspaceKnowledge } from '@/lib/bindings/WorkspaceKnowledge';
import { extractMessage, silentCatch } from '@/lib/silentCatch';
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

export interface WorkspaceStats {
  adopted: number;
  proposed: number;
  observed: number;
}

export interface WorkspaceCenter {
  workspaces: Workspace[];
  activeId: string | null;
  projects: DevProject[];
  /** Knowledge rows per workspace id, newest first. Every status unless the
   *  caller narrowed it — see {@link WorkspaceCenterOptions.statuses}. */
  knowledge: Record<string, WorkspaceKnowledge[]>;
  /**
   * Why {@link knowledge} is empty, when it is empty because the read FAILED.
   *
   * The fetch ends in `silentCatch`, which is right for a shell that can show
   * an empty library — and wrong for a caller that turns these rows into a
   * DECISION QUEUE. The triage deck reads pending practices from here, and a
   * failed read reached it as "no practices are waiting", which is the one
   * thing this surface must never say when it does not know.
   *
   * Null while the last read succeeded; cleared by the next successful refresh.
   */
  knowledgeError: string | null;
  /** Per-status tallies over whatever `knowledge` holds. A caller that narrowed
   *  the fetch gets zeroes for the statuses it did not ask for — by
   *  construction, since the rows were never read. */
  stats: Record<string, WorkspaceStats>;
  projectById: Map<string, DevProject>;
  /** Re-fetch knowledge after a mutation (adopt/reject/create). */
  refreshKnowledge: () => void;
}

export interface WorkspaceCenterOptions {
  /**
   * Narrow the fetch to these statuses.
   *
   * The Tauri command has always taken a status filter and this hook never
   * passed one, so the triage deck was reading every workspace's ENTIRE library
   * — adopted, rejected, deprecated and all — to keep the `observed`/`proposed`
   * slice and discard the rest. Adopted is the biggest bucket in a mature
   * workspace, so that is most of the payload thrown away on every refresh.
   *
   * Omit for every status. The library shell and the Approvals knowledge tab
   * both legitimately need all of them, which is why this is opt-in rather than
   * a new default.
   */
  statuses?: readonly KnowledgeStatus[];
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** One hook feeding the shell: store snapshot + projects + a per-workspace
 *  knowledge fetch (small N — one query per workspace per requested status). */
export function useWorkspaceCenter(options: WorkspaceCenterOptions = {}): WorkspaceCenter {
  const { workspaces, activeId } = useWorkspaces();
  const projects = useSystemStore((s) => s.projects);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const [knowledge, setKnowledge] = useState<Record<string, WorkspaceKnowledge[]>>({});
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);
  const [fetchGen, setFetchGen] = useState(0);

  useEffect(() => {
    if (projects.length === 0) void fetchProjects();
  }, [projects.length, fetchProjects]);

  const wsKey = workspaces.map((w) => w.id).join(',');
  // Joined into a string so a caller passing a fresh array literal every render
  // does not re-fire the fetch on every render.
  const statusKey = options.statuses?.join(',') ?? '';
  useEffect(() => {
    if (!wsKey) return;
    void fetchGen; // re-run on manual refresh
    let cancelled = false;
    // `undefined` is the "every status" query the command already supported.
    const statuses: (KnowledgeStatus | undefined)[] = statusKey
      ? (statusKey.split(',') as KnowledgeStatus[])
      : [undefined];
    void Promise.all(
      wsKey.split(',').map(async (id) => {
        const pages = await Promise.all(statuses.map((status) => listWorkspaceKnowledge(id, status)));
        return [id, pages.flat()] as const;
      }),
    )
      .then((pairs) => {
        if (cancelled) return;
        setKnowledge(Object.fromEntries(pairs));
        setKnowledgeError(null);
      })
      .catch((err) => {
        // Still silent for the shell (an empty library is a legible state), but
        // no longer INVISIBLE: a caller that presents these rows as a queue can
        // now tell "nothing pending" from "we could not read it".
        if (!cancelled) setKnowledgeError(extractMessage(err));
        silentCatch('workspaces:knowledgeFetch')(err);
      });
    return () => { cancelled = true; };
  }, [wsKey, fetchGen, statusKey]);

  const stats = useMemo(() => {
    const out: Record<string, WorkspaceStats> = {};
    for (const [id, rows] of Object.entries(knowledge)) {
      out[id] = {
        adopted: rows.filter((r) => r.status === 'adopted').length,
        proposed: rows.filter((r) => r.status === 'proposed').length,
        observed: rows.filter((r) => r.status === 'observed').length,
      };
    }
    return out;
  }, [knowledge]);

  const sortedProjects = useMemo(() => [...projects].sort(byName), [projects]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const refreshKnowledge = useCallback(() => setFetchGen((g) => g + 1), []);

  // Memoised, and `refreshKnowledge` with it: the triage deck folds this object
  // into the injected write ports behind `queue.decide`, which every card's
  // `onCommit` closes over. A new object (or a new arrow) each render defeated
  // the memoisation of all three stacked cards.
  return useMemo(
    () => ({
      workspaces,
      activeId,
      projects: sortedProjects,
      knowledge,
      knowledgeError,
      stats,
      projectById,
      refreshKnowledge,
    }),
    [
      workspaces,
      activeId,
      sortedProjects,
      knowledge,
      knowledgeError,
      stats,
      projectById,
      refreshKnowledge,
    ],
  );
}

// -- leaf components ---------------------------------------------------------

const STATUS_INK: Record<KnowledgeStatus, string> = {
  observed: 'bg-secondary/40 text-foreground/80 border-primary/10',
  proposed: 'bg-status-info/10 text-status-info border-status-info/30',
  adopted: 'bg-status-success/10 text-status-success border-status-success/30',
  deprecated: 'bg-secondary/40 text-muted-foreground border-primary/10',
  rejected: 'bg-status-error/10 text-status-error border-status-error/30',
};

export function KnowledgeStatusChip({ status, label }: { status: string; label?: string }) {
  const ink = STATUS_INK[status as KnowledgeStatus] ?? STATUS_INK.observed;
  return (
    <span className={`typo-label rounded-interactive border px-1.5 py-0.5 ${ink}`}>
      {label ?? status}
    </span>
  );
}

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
