// Direction A — **Supply line**. The registry as an inbound feed to this territory.
//
// Metaphor continues the Atlas's own: a workspace is a territory seen from above,
// and a registry is the line that supplies it. The section answers "is the line
// connected, and is what came down it fresh?" — origin, commit, lanes carried,
// when it last ran. Setup is a short path that disappears once the line is up.
//
// Why this direction: wiring is a means, not a subject. Most of the time the
// operator is not thinking about the registry at all — they want a glance that
// says the feed is live and current, and to be left alone. So the resting state
// is one strip, and the machinery only appears when something needs doing.
//
// What it does not do: it never lists the other workspaces on the same registry.
// That is Direction B's whole argument, deliberately left out so the two are a
// real choice rather than a superset and a subset.

import { CheckCircle2, GitBranch, Link2Off, Loader2, TriangleAlert } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';

import { RegistryWiring } from './RegistryWiring';
import { LANES, unlinkRegistry, type Registry } from './registryLinkStore';

function StateBadge({ registry }: { registry: Registry }) {
  if (registry.state === 'pairing') {
    return (
      <span className="inline-flex items-center gap-1.5 typo-label text-primary">
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
        Pairing
      </span>
    );
  }
  if (registry.state === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 typo-label text-status-error">
        <TriangleAlert className="w-3.5 h-3.5" aria-hidden />
        Pairing failed
      </span>
    );
  }
  if (registry.state === 'paired') {
    return (
      <span className="inline-flex items-center gap-1.5 typo-label text-status-success">
        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
        Line open
      </span>
    );
  }
  return null;
}

export function RegistrySupplyLine({
  workspaceId,
  registry,
  dispatchCwd,
}: {
  workspaceId: string;
  registry: Registry | null;
  dispatchCwd: string | null;
}) {
  if (!registry) {
    return (
      <div className="flex flex-col gap-3">
        <p className="typo-body text-muted-foreground">
          Nothing supplies this workspace yet. A knowledge registry is a repository the fleet reads from —
          skills, practices, memory and knowledge bundles all arrive down the same line.
        </p>
        <RegistryWiring workspaceId={workspaceId} dispatchCwd={dispatchCwd} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <GitBranch className="w-4 h-4 text-foreground/60" aria-hidden />
        <span className="typo-body text-foreground">{registry.fullName}</span>
        <span className="typo-caption text-muted-foreground">{registry.defaultBranch}</span>
        <span className="ml-auto">
          <StateBadge registry={registry} />
        </span>
      </div>

      {registry.state === 'error' && registry.error && (
        <p className="typo-caption text-status-error">{registry.error}</p>
      )}

      {registry.state === 'paired' && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {LANES.map((lane) => {
              const carried = registry.lanes.includes(lane);
              return (
                <span
                  key={lane}
                  className={`typo-caption rounded-interactive border px-1.5 py-0.5 ${
                    carried
                      ? 'border-primary/25 bg-primary/10 text-foreground'
                      : 'border-primary/10 text-muted-foreground line-through'
                  }`}
                  title={carried ? `${lane} is published by this registry` : `${lane} lane is empty`}
                >
                  {lane}
                </span>
              );
            })}
            {registry.domains.length > 0 && (
              <span className="typo-caption text-muted-foreground">
                · {registry.domains.length} knowledge {registry.domains.length === 1 ? 'domain' : 'domains'}
              </span>
            )}
          </div>

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
            {registry.clonePath && <span className="truncate">{registry.clonePath}</span>}
          </div>
        </>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          icon={<Link2Off className="w-3.5 h-3.5" />}
          onClick={() => unlinkRegistry(workspaceId)}
        >
          Disconnect
        </Button>
      </div>
    </div>
  );
}
