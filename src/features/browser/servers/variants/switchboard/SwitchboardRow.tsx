/**
 * One Switchboard row: switch, port, name, lamp + state word, stack, the
 * state's own detail (uptime / pid / error / scan), and the dev command.
 * The row is the roving-focus stop; the parent owns the keyboard.
 */
import { forwardRef, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';

import { MonitorSmartphone } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevServerView } from '@/lib/bindings/DevServerView';

import { formatUptime, techTokens } from '../../serverModel';
import { SERVER_TONE, TONE_TEXT } from '../../serverTone';
import { FigureSwitch } from './FigureSwitch';
import { isInert, switchPosition } from './switchboardModel';
import { TechGlyphs } from './TechGlyphs';

export interface SwitchboardRowProps {
  server: DevServerView;
  hostPort: number | null;
  now: number;
  /** The row's workspace: its colour paints the rail, its name labels the group's first row. */
  workspace: { name: string; color: string | null };
  /** First row of a workspace run: it carries the label and the group's top rule. */
  groupStart: boolean;
  active: boolean;
  onFocusRow: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  onMenu: (e: MouseEvent, server: DevServerView) => void;
  onToggle: (server: DevServerView) => void;
}

export const SwitchboardRow = forwardRef<HTMLDivElement, SwitchboardRowProps>(function SwitchboardRow(
  { server, hostPort, now, workspace, groupStart, active, onFocusRow, onKeyDown, onMenu, onToggle },
  ref,
) {
  const { t, tx } = useTranslation();
  const s = t.browser.servers;
  const sb = s.switchboard;
  const { tone, pulse } = SERVER_TONE[server.state];
  const host = hostPort != null && server.devPort === hostPort;
  const inert = isInert(server, hostPort);
  const position = switchPosition(server.state);
  const stateWord = s[`state_${server.state}`];
  const rail = { '--sb-ws': workspace.color ?? 'transparent' } as CSSProperties;

  return (
    <div
      ref={ref}
      role="listitem"
      tabIndex={active ? 0 : -1}
      aria-label={tx(sb.row_label, { name: server.projectName, port: server.devPort, state: stateWord })}
      data-testid="server-item"
      data-project-id={server.projectId}
      data-state={server.state}
      className={`sb-row sbt-${tone}${active ? ' is-active' : ''}${groupStart ? ' is-group-start' : ''}`}
      style={rail}
      onFocus={onFocusRow}
      onClick={onFocusRow}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => onMenu(e, server)}
    >
      <span className="typo-label text-foreground sb-ellipsis sb-ws">{groupStart ? workspace.name : ''}</span>
      <FigureSwitch
        position={position}
        tone={tone}
        pulse={server.state === 'scanning'}
        inert={inert}
        host={host}
        label={tx(position === 'off' ? sb.toggle_start : sb.toggle_stop, { name: server.projectName })}
        disabledReason={host ? s.host_guard : undefined}
        onToggle={() => onToggle(server)}
      />
      <span className={`typo-data sb-port ${position === 'off' ? 'text-foreground' : TONE_TEXT[tone]}`}>
        {server.devPort}
      </span>
      <span className="sb-name">
        <span className="typo-heading text-foreground sb-ellipsis">{server.projectName}</span>
        {host && (
          <Tooltip content={s.host_guard}>
            <span className="typo-label text-primary sb-host" data-testid="server-host-badge">
              <MonitorSmartphone className="w-3.5 h-3.5 shrink-0" aria-hidden />
              <span className="sb-host__text">{sb.host_badge}</span>
            </span>
          </Tooltip>
        )}
      </span>
      <span className="sb-state">
        <span aria-hidden className={`sb-lamp${pulse ? ' is-pulse' : ''}${position !== 'off' ? ' is-lit' : ''}`} />
        <span className={`typo-label sb-ellipsis ${TONE_TEXT[tone]}`}>{stateWord}</span>
      </span>
      <TechGlyphs tokens={techTokens(server)} />
      <Detail server={server} now={now} />
      <span className="sb-cmd">
        {server.devCommand ? (
          <Tooltip content={server.devCommand}>
            <span className="typo-code text-foreground sb-ellipsis">{server.devCommand}</span>
          </Tooltip>
        ) : (
          <span className="typo-caption sb-ellipsis">{sb.no_command}</span>
        )}
      </span>
    </div>
  );
});

/** The one line of detail each state earns; nothing for a state that has none. */
function Detail({ server, now }: { server: DevServerView; now: number }) {
  const { t, tx } = useTranslation();
  const s = t.browser.servers;
  const sb = s.switchboard;
  let body: ReactNode = null;
  if (server.state === 'running' || server.state === 'stopping') {
    const up = formatUptime(server.startedAt, now);
    if (up) body = <span className="typo-data k-regular text-foreground">{tx(s.uptime, { duration: up })}</span>;
  } else if (server.state === 'starting') {
    body = <span className="typo-caption">{sb.starting_hint}</span>;
  } else if (server.state === 'external' && server.externalPid != null) {
    body = <span className="typo-data text-status-info">{tx(s.external_pid, { pid: server.externalPid })}</span>;
  } else if (server.state === 'failed' && server.error) {
    body = (
      <Tooltip content={server.error}>
        <span className="typo-caption text-status-error sb-ellipsis" data-testid="server-error">{server.error}</span>
      </Tooltip>
    );
  } else if (server.state === 'scanning') {
    body = <span className="typo-caption text-status-info">{sb.scanning_hint}</span>;
  }
  return <span className="sb-detail">{body}</span>;
}
