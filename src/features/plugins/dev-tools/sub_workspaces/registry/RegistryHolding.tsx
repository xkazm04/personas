// Direction B — **Shared holding**. The registry as a jointly-held asset that
// this workspace is one of several holders of.
//
// Metaphor: joining, not connecting. The registry exists independently of any
// workspace; wiring is membership in something already there. So the section
// leads with the holding itself — the repo, what it publishes, who else holds it —
// and treats this workspace's link as one row among them.
//
// Why this direction is genuinely different from Supply line: the cardinality is
// 1 registry : N workspaces, and Supply line cannot show that at all. A per-
// territory feed strip reads identically whether this workspace is the only
// holder or the fourth, which means "Disconnect" looks equally safe in both
// cases — and it is not. Making the co-holders visible is the whole argument
// here: it turns an invisible shared dependency into something the operator can
// see before they act on it.

import { Boxes, GitBranch, Link2Off, Loader2, TriangleAlert, Users } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';

import { RegistryWiring } from './RegistryWiring';
import { LANES, unlinkRegistry, workspacesOn, type Registry } from './registryLinkStore';

export function RegistryHolding({
  workspaceId,
  registry,
  dispatchCwd,
  workspaceNameById,
}: {
  workspaceId: string;
  registry: Registry | null;
  dispatchCwd: string | null;
  /** Names for the co-holders. A workspace id tells the operator nothing. */
  workspaceNameById: Map<string, string>;
}) {
  if (!registry) {
    return (
      <div className="flex flex-col gap-3">
        <p className="typo-body text-muted-foreground">
          This workspace holds no registry. A registry is shared property — pick the same repository in
          another workspace and both hold the one clone, at the one commit, rather than forking a copy each.
        </p>
        <RegistryWiring workspaceId={workspaceId} dispatchCwd={dispatchCwd} />
      </div>
    );
  }

  const holders = workspacesOn(registry.id);
  const others = holders.filter((id) => id !== workspaceId);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-primary/15 bg-secondary/20 p-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <GitBranch className="w-4 h-4 text-foreground/60" aria-hidden />
          <span className="typo-body text-foreground">{registry.fullName}</span>
          <span className="typo-caption text-muted-foreground">{registry.defaultBranch}</span>
          {registry.state === 'pairing' && (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary ml-auto" aria-hidden />
          )}
          {registry.state === 'error' && (
            <TriangleAlert className="w-3.5 h-3.5 text-status-error ml-auto" aria-hidden />
          )}
        </div>

        {registry.state === 'error' && registry.error && (
          <p className="typo-caption text-status-error">{registry.error}</p>
        )}

        {registry.state === 'paired' && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 typo-caption text-muted-foreground">
                <Boxes className="w-3.5 h-3.5" aria-hidden />
                publishes
              </span>
              {LANES.filter((l) => registry.lanes.includes(l)).map((lane) => (
                <span key={lane} className="typo-caption text-foreground">
                  {lane}
                </span>
              ))}
              {registry.lanes.length === 0 && (
                <span className="typo-caption text-muted-foreground">no lanes carry content yet</span>
              )}
            </div>
            {registry.domains.length > 0 && (
              <p className="typo-caption text-muted-foreground">
                knowledge domains: <span className="text-foreground/80">{registry.domains.join(', ')}</span>
              </p>
            )}
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 typo-caption text-muted-foreground">
              {registry.sha && (
                <span>
                  at <span className="text-foreground/80 font-mono">{registry.sha.slice(0, 9)}</span>
                </span>
              )}
              {registry.pairedAt && (
                <span>
                  paired <RelativeTime timestamp={registry.pairedAt} />
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="inline-flex items-center gap-1.5 typo-label text-muted-foreground">
          <Users className="w-3.5 h-3.5" aria-hidden />
          Held by {holders.length} {holders.length === 1 ? 'workspace' : 'workspaces'}
        </span>
        <div className="flex flex-wrap gap-1.5">
          <span className="typo-caption rounded-interactive border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-foreground">
            {workspaceNameById.get(workspaceId) ?? 'this workspace'}
          </span>
          {others.map((id) => (
            <span
              key={id}
              className="typo-caption rounded-interactive border border-primary/10 bg-secondary/40 px-1.5 py-0.5 text-muted-foreground"
            >
              {workspaceNameById.get(id) ?? id}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          icon={<Link2Off className="w-3.5 h-3.5" />}
          onClick={() => unlinkRegistry(workspaceId)}
        >
          Leave registry
        </Button>
        <span className="typo-caption text-muted-foreground">
          {others.length > 0
            ? `${others.length} other ${others.length === 1 ? 'workspace keeps' : 'workspaces keep'} the clone — leaving does not remove it.`
            : 'No other holder, so the clone goes with it.'}
        </span>
      </div>
    </div>
  );
}
