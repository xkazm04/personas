// Shared data hook + leaf components for the Workspaces-module /prototype
// round A variants (Rail / Atlas / Cockpit). Hoisted from day one so every
// variant refinement is made once. Strings hardcoded-EN until consolidation.
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';

import { listWorkspaceKnowledge, type KnowledgeStatus } from '@/api/devTools/workspaces';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { WorkspaceKnowledge } from '@/lib/bindings/WorkspaceKnowledge';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

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
  /** Knowledge rows per workspace id (all statuses, newest first). */
  knowledge: Record<string, WorkspaceKnowledge[]>;
  stats: Record<string, WorkspaceStats>;
  projectById: Map<string, DevProject>;
}

/** One hook feeding every shell variant: store snapshot + projects + a
 *  per-workspace knowledge fetch (small N — one query per workspace). */
export function useWorkspaceCenter(): WorkspaceCenter {
  const { workspaces, activeId } = useWorkspaces();
  const projects = useSystemStore((s) => s.projects);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const [knowledge, setKnowledge] = useState<Record<string, WorkspaceKnowledge[]>>({});

  useEffect(() => {
    if (projects.length === 0) void fetchProjects();
  }, [projects.length, fetchProjects]);

  const wsKey = workspaces.map((w) => w.id).join(',');
  useEffect(() => {
    if (!wsKey) return;
    let cancelled = false;
    void Promise.all(
      wsKey.split(',').map(async (id) => [id, await listWorkspaceKnowledge(id)] as const),
    )
      .then((pairs) => {
        if (!cancelled) setKnowledge(Object.fromEntries(pairs));
      })
      .catch(silentCatch('workspaces:knowledgeFetch'));
    return () => { cancelled = true; };
  }, [wsKey]);

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

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  return { workspaces, activeId, projects, knowledge, stats, projectById };
}

// -- leaf components ---------------------------------------------------------

const STATUS_INK: Record<KnowledgeStatus, string> = {
  observed: 'bg-secondary/40 text-foreground/80 border-primary/10',
  proposed: 'bg-status-info/10 text-status-info border-status-info/30',
  adopted: 'bg-status-success/10 text-status-success border-status-success/30',
  deprecated: 'bg-secondary/40 text-muted-foreground border-primary/10',
  rejected: 'bg-status-error/10 text-status-error border-status-error/30',
};

export function KnowledgeStatusChip({ status }: { status: string }) {
  const ink = STATUS_INK[status as KnowledgeStatus] ?? STATUS_INK.observed;
  return (
    <span className={`typo-label rounded-interactive border px-1.5 py-0.5 ${ink}`}>
      {status}
    </span>
  );
}

/** Round-B placeholder: the library gets its real presentation next round —
 *  this peek proves where knowledge lives in each shell. */
export function KnowledgePeek({ items }: { items: WorkspaceKnowledge[] }) {
  if (items.length === 0) {
    return (
      <p className="typo-body text-muted-foreground">
        No practices yet. The library fills from harvesting and manual authoring (round B).
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {items.slice(0, 8).map((k) => (
        <li key={k.id} className="flex items-center gap-2 min-w-0">
          <KnowledgeStatusChip status={k.status} />
          <span className="typo-body text-foreground truncate">{k.title}</span>
          <span className="typo-caption text-muted-foreground shrink-0">{k.kind}</span>
        </li>
      ))}
      {items.length > 8 && (
        <li className="typo-caption text-muted-foreground">+{items.length - 8} more</li>
      )}
    </ul>
  );
}

/** Two-column membership editor: members on the left, the rest of the
 *  portfolio on the right; a project lives in exactly one workspace. */
export function MembershipPanel({
  workspace,
  projects,
}: {
  workspace: Workspace;
  projects: DevProject[];
}) {
  const memberSet = new Set(workspace.projectIds);
  const members = projects.filter((p) => memberSet.has(p.id));
  const candidates = projects.filter((p) => !memberSet.has(p.id));

  return (
    <div className="grid grid-cols-2 gap-3 min-w-0">
      <div className="min-w-0">
        <div className="typo-label text-muted-foreground uppercase tracking-wide mb-2">
          Members · {members.length}
        </div>
        <div className="flex flex-col gap-1.5">
          {members.length === 0 && (
            <p className="typo-body text-muted-foreground">No projects yet.</p>
          )}
          {members.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              actionIcon={<X className="w-3.5 h-3.5" />}
              actionLabel="Remove from workspace"
              onAction={() => assignProject(p.id, null)}
            />
          ))}
        </div>
      </div>
      <div className="min-w-0">
        <div className="typo-label text-muted-foreground uppercase tracking-wide mb-2">
          Other projects · {candidates.length}
        </div>
        <div className="flex flex-col gap-1.5">
          {candidates.length === 0 && (
            <p className="typo-body text-muted-foreground">Every project is a member.</p>
          )}
          {candidates.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              actionIcon={<ArrowRight className="w-3.5 h-3.5" />}
              actionLabel="Add to workspace"
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
      <div className="min-w-0 flex-1">
        <div className="typo-body text-foreground truncate">{project.name}</div>
        {project.tech_stack && (
          <div className="typo-caption text-muted-foreground truncate">{project.tech_stack}</div>
        )}
      </div>
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

/** Inline "name → create" form shared by the variants' empty/new states. */
export function CreateWorkspaceInline({ autoFocus }: { autoFocus?: boolean }) {
  const [name, setName] = useState('');
  const submit = () => {
    if (!name.trim()) return;
    createWorkspace(name);
    setName('');
  };
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        className={INPUT_FIELD}
        placeholder="Workspace name…"
        value={name}
        autoFocus={autoFocus}
        onChange={(e) => setName(e.target.value)}
      />
      <button
        type="submit"
        disabled={!name.trim()}
        className="typo-body shrink-0 rounded-interactive border border-primary/20 bg-primary/10 px-3 py-2 text-foreground hover:bg-primary/15 disabled:opacity-40 transition-colors"
      >
        Create
      </button>
    </form>
  );
}
