// Variant A3 — "Cockpit": you are IN one org. The page assumes a single
// active workspace (the same selection the footer SwitcherBreadcrumb drives —
// selecting here updates the app-wide scope) and gives it an identity header
// band, stat tiles, and side-by-side membership | library panes. A top chip
// strip switches org. Optimised for the "one org at a time, live in it"
// mental model where the workspace colours the whole session.
import { Landmark } from 'lucide-react';

import {
  CreateWorkspaceInline,
  KnowledgePeek,
  MembershipPanel,
  useWorkspaceCenter,
} from './centerShared';
import { setActiveWorkspace } from './workspaceStore';

export default function WorkspacesCockpit() {
  const center = useWorkspaceCenter();
  const active = center.workspaces.find((w) => w.id === center.activeId) ?? null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="px-6 pt-4 flex items-center gap-2 flex-wrap">
        {center.workspaces.map((ws) => {
          const isActive = active?.id === ws.id;
          return (
            <button
              key={ws.id}
              type="button"
              onClick={() => setActiveWorkspace(isActive ? null : ws.id)}
              className={`flex items-center gap-2 rounded-interactive border px-3 py-1.5 transition-colors ${
                isActive
                  ? 'border-primary/40 bg-primary/10 text-foreground'
                  : 'border-primary/10 text-foreground/80 hover:bg-secondary/40'
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ws.color }} />
              <span className="typo-body">{ws.name}</span>
            </button>
          );
        })}
        <div className="ml-auto w-64">
          <CreateWorkspaceInline />
        </div>
      </div>

      {!active ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center px-6">
          <div className="w-14 h-14 rounded-xl border border-primary/15 bg-secondary/35 flex items-center justify-center">
            <Landmark className="w-6 h-6 text-primary/70" />
          </div>
          <p className="typo-body text-foreground max-w-md">
            Pick a workspace above to step into it — or create one. The active workspace also
            scopes the footer switcher and the Project Manager.
          </p>
        </div>
      ) : (
        <div className="px-6 pb-6">
          <header
            className="mt-4 rounded-card border border-primary/10 p-5 relative overflow-hidden"
            style={{ backgroundColor: `${active.color}14` }}
          >
            <div
              className="absolute inset-y-0 left-0 w-1.5"
              style={{ backgroundColor: active.color }}
            />
            <h1 className="typo-title-lg text-foreground">{active.name}</h1>
            <div className="mt-3 flex items-center gap-8">
              <StatTile value={active.projectIds.length} label="Projects" />
              <StatTile value={center.stats[active.id]?.adopted ?? 0} label="Adopted practices" />
              <StatTile value={center.stats[active.id]?.proposed ?? 0} label="Awaiting review" />
            </div>
          </header>

          <div className="mt-5 grid grid-cols-[3fr_2fr] gap-5 items-start">
            <div className="rounded-card border border-primary/10 p-4">
              <h2 className="typo-section-title text-foreground mb-3">Projects</h2>
              <MembershipPanel workspace={active} projects={center.projects} />
            </div>
            <div className="rounded-card border border-primary/10 p-4">
              <h2 className="typo-section-title text-foreground mb-3">Knowledge library</h2>
              <KnowledgePeek items={center.knowledge[active.id] ?? []} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="typo-data-lg text-foreground">{value}</div>
      <div className="typo-caption text-muted-foreground">{label}</div>
    </div>
  );
}
