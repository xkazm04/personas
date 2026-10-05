/**
 * Server control prototype: Port map. The dev-server fleet drawn on a banded
 * port axis: each app is a pin at its port carrying its state tone, name and
 * tech icons; external listeners are ghost pins; hover or focus grows a pin into
 * its detail card. A figure under kit doctrine 6c, framed by ServerSection.
 * Owns presentation only; see `../serverVariantProps.ts`.
 */
import { useMemo } from 'react';

import { useNowSeconds, useWorkspaceIndex } from '../serverModel';
import type { ServerVariantProps } from '../serverVariantProps';
import PortAxisFigure from './portmap/PortAxisFigure';
import PortLegend from './portmap/PortLegend';
import { buildPortAxis } from './portmap/portAxis';
import './portmap/portmap.css';

/** Loading: the figure's own silhouette (two callout rows over an axis), still. */
function PortMapGhost() {
  return (
    <div className="pm-root" data-testid="portmap-ghost" aria-busy>
      <div className="pm-cards" style={{ gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={i % 2 ? 'pm-row-far' : 'pm-row-near'} style={{ gridColumn: `${2 * i + 1} / ${2 * i + 5}` }}>
            <div className="pm-ghost-card w-full" />
          </div>
        ))}
      </div>
      <div className="h-11" />
      <div className="pm-ghost-bar mx-2" />
      <div className="h-10" />
    </div>
  );
}

export default function PortMapVariant({ servers, loading, hostPort, onMenu, onToggle }: ServerVariantProps) {
  const workspaces = useWorkspaceIndex();
  const axis = useMemo(() => buildPortAxis(servers), [servers]);
  const anyTimed = servers.some((s) => s.startedAt != null);
  const now = useNowSeconds(anyTimed);

  if (loading) return <PortMapGhost />;

  return (
    <div className="pm-root" data-testid="portmap-root">
      <PortAxisFigure
        axis={axis}
        hostPort={hostPort}
        now={now}
        workspaces={workspaces}
        onMenu={onMenu}
        onToggle={onToggle}
      />
      <PortLegend servers={servers} workspaces={workspaces} />
    </div>
  );
}
