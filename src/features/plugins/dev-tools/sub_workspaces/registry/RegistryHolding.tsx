// **Shared holding** — the registry as a jointly-held asset that this workspace
// is one of several holders of.
//
// Metaphor: joining, not connecting. The registry exists independently of any
// workspace; wiring is membership in something already there. So the section
// leads with the holding itself — the repo, its working copy, what it publishes,
// who else holds it — and treats this workspace's link as one row among them.
//
// The co-holder list is the reason this direction won. The cardinality is
// 1 registry : N workspaces, and a per-territory "feed" reading of the same data
// cannot show that at all: it looks identical whether this workspace is the only
// holder or the fourth, which makes leaving look equally safe in both cases —
// and it is not. Showing the other holders turns an invisible shared dependency
// into something the operator can see before acting on it.

import { Boxes, GitBranch, Link2Off, Loader2, TriangleAlert, Users } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';

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
  const { t, tx } = useTranslation();
  const tr = t.plugins.dev_tools.registry;

  if (!registry) {
    return (
      <div className="flex flex-col gap-3">
        <p className="typo-body text-foreground">{tr.empty_body}</p>
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
          <GitBranch className="w-4 h-4 text-foreground" aria-hidden />
          <span className="typo-body text-foreground">{registry.fullName}</span>
          <span className="typo-caption text-foreground/70">{registry.defaultBranch}</span>
          {registry.state === 'pairing' && (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary ml-auto" aria-hidden />
          )}
          {registry.state === 'error' && (
            <TriangleAlert className="w-3.5 h-3.5 text-status-error ml-auto" aria-hidden />
          )}
        </div>

        {/* The working copy is half the wiring, so it is shown at rest, not
            hidden behind a detail toggle — a scan runs against this path. */}
        <p className="typo-caption text-foreground/70 truncate">{registry.clonePath}</p>

        {registry.state === 'error' && registry.error && (
          <p className="typo-caption text-status-error">{registry.error}</p>
        )}

        {registry.state === 'paired' && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 typo-caption text-foreground/70">
                <Boxes className="w-3.5 h-3.5" aria-hidden />
                {tr.publishes}
              </span>
              {LANES.filter((l) => registry.lanes.includes(l)).map((lane) => (
                <span key={lane} className="typo-caption text-foreground">
                  {lane}
                </span>
              ))}
              {registry.lanes.length === 0 && (
                <span className="typo-caption text-foreground/70">{tr.no_lanes}</span>
              )}
            </div>
            {registry.domains.length > 0 && (
              <p className="typo-caption text-foreground/70">
                {tr.domains_label} <span className="text-foreground">{registry.domains.join(', ')}</span>
              </p>
            )}
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 typo-caption text-foreground/70">
              {registry.sha && (
                <span>
                  {tr.at_commit} <span className="text-foreground font-mono">{registry.sha.slice(0, 9)}</span>
                </span>
              )}
              {registry.pairedAt && (
                <span>
                  {tr.paired} <RelativeTime timestamp={registry.pairedAt} />
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="inline-flex items-center gap-1.5 typo-label text-foreground/70">
          <Users className="w-3.5 h-3.5" aria-hidden />
          {tx(holders.length === 1 ? tr.held_by_one : tr.held_by_other, { count: holders.length })}
        </span>
        <div className="flex flex-wrap gap-1.5">
          <span className="typo-caption rounded-interactive border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-foreground">
            {workspaceNameById.get(workspaceId) ?? tr.this_workspace}
          </span>
          {others.map((id) => (
            <span
              key={id}
              className="typo-caption rounded-interactive border border-primary/10 bg-secondary/40 px-1.5 py-0.5 text-foreground/70"
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
          {tr.leave}
        </Button>
        <span className="typo-caption text-foreground/70">
          {others.length > 0
            ? tx(others.length === 1 ? tr.others_keep_one : tr.others_keep_other, { count: others.length })
            : tr.no_other_holder}
        </span>
      </div>
    </div>
  );
}
