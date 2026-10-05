/**
 * Under the Port map's axis: how many servers sit in each state (lamp, word,
 * count), which workspace each card edge colour means, and the honest scale
 * note, because a banded axis is not a linear one.
 */
import type { CSSProperties } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import type { DevServerState } from '@/lib/bindings/DevServerState';
import type { DevServerView } from '@/lib/bindings/DevServerView';

import type { WorkspaceTag } from '../../serverModel';
import { SERVER_TONE } from '../../serverTone';

const ORDER: DevServerState[] = ['running', 'starting', 'stopping', 'external', 'scanning', 'failed', 'stopped', 'unconfigured'];

interface PortLegendProps {
  servers: readonly DevServerView[];
  workspaces: ReadonlyMap<string, WorkspaceTag>;
}

export default function PortLegend({ servers, workspaces }: PortLegendProps) {
  const { t } = useTranslation();
  const s = t.browser.servers;

  const counts = new Map<DevServerState, number>();
  for (const server of servers) counts.set(server.state, (counts.get(server.state) ?? 0) + 1);
  const wsIds: (string | null)[] = [];
  for (const server of servers) if (!wsIds.includes(server.workspaceId)) wsIds.push(server.workspaceId);

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-3 mt-1 border-t border-border/60">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {ORDER.filter((st) => counts.has(st)).map((st) => {
          const spec = SERVER_TONE[st];
          return (
            <li key={st} className={`pm-t-${spec.tone} flex items-center gap-1.5`} data-testid={`portmap-legend-${st}`}>
              <span className={`pm-lamp ${spec.tone !== 'off' ? 'is-lit' : ''}`} aria-hidden />
              <span className="typo-data text-foreground">{counts.get(st)}</span>
              <span className="typo-caption text-foreground">{s[`state_${st}`]}</span>
            </li>
          );
        })}
      </ul>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {wsIds.map((id) => {
          const ws = id ? workspaces.get(id) : undefined;
          return (
            <li key={id ?? 'none'} className="flex items-center gap-1.5" style={ws ? ({ '--pm-ws': ws.color } as CSSProperties) : undefined}>
              <span className="pm-swatch" aria-hidden />
              <span className="typo-caption text-foreground">{ws?.name ?? s.portmap.no_workspace}</span>
            </li>
          );
        })}
      </ul>
      <span className="typo-caption text-foreground ml-auto">{s.portmap.scale_note}</span>
    </div>
  );
}
