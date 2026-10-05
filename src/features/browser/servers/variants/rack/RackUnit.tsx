/**
 * One app server as a 1U rack unit: lamp, port display and name on the left;
 * tech badges, the uptime readout and a power switch on the right. The whole
 * faceplate opens the shared menu (right-click, Menu key or Shift+F10).
 */
import { AppWindow } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevServerView } from '@/lib/bindings/DevServerView';

import { formatUptime, techTokens } from '../../serverModel';
import { canStart, canStop, SERVER_TONE, TONE_TEXT } from '../../serverTone';
import type { ServerVariantProps } from '../../serverVariantProps';
import { isLitState, Lamp, PortWindow, PowerSwitch, Readout, TechBadges, toneClass } from './RackParts';
import { useMenuKey } from './useMenuKey';

interface RackUnitProps extends Pick<ServerVariantProps, 'hostPort' | 'onMenu' | 'onToggle'> {
  server: DevServerView;
  /** Shared clock (unix seconds) so every unit's uptime ticks together. */
  now: number;
}

export function RackUnit({ server, hostPort, now, onMenu, onToggle }: RackUnitProps) {
  const { t, tx } = useTranslation();
  const s = t.browser.servers;
  const r = s.rack;
  const { state } = server;
  const lit = isLitState(state);
  const isHost = hostPort != null && server.devPort === hostPort;
  const stateWord = s[`state_${state}`];
  const menu = useMenuKey((e) => onMenu(e, server));

  const on = canStop(state);
  const inertReason = isHost
    ? s.host_guard
    : on || canStart(state)
      ? null
      : state === 'unconfigured'
        ? r.switch_unconfigured
        : r.switch_busy;

  const uptime = state === 'running' || state === 'starting' || state === 'stopping' ? formatUptime(server.startedAt, now) : null;
  const readout =
    state === 'external' && server.externalPid != null
      ? tx(s.external_pid, { pid: server.externalPid })
      : uptime
        ? tx(s.uptime, { duration: uptime })
        : null;

  return (
    <li
      data-testid="server-item"
      data-project-id={server.projectId}
      data-state={state}
      tabIndex={0}
      aria-label={tx(r.unit_label, { name: server.projectName, port: server.devPort, state: stateWord })}
      onContextMenu={menu.onContextMenu}
      onKeyDown={menu.onKeyDown}
      className={`rk-unit rounded-input ${toneClass(state)} ${lit ? 'is-lit' : ''}`}
    >
      <span className="rk-ear is-left" aria-hidden />
      <Lamp state={state} />
      <PortWindow port={server.devPort} lit={lit} label={s.port_label} />

      <div className="flex items-baseline gap-3 min-w-0">
        <span className="typo-heading-lg text-foreground truncate min-w-0">{server.projectName}</span>
        {isHost && (
          <Tooltip content={s.host_guard}>
            <span className="rk-host rounded-pill typo-label self-center" data-testid="rack-host-badge">
              <AppWindow className="w-3.5 h-3.5" aria-hidden />
              {r.host_badge}
            </span>
          </Tooltip>
        )}
        <span className={`typo-label shrink-0 ${TONE_TEXT[SERVER_TONE[state].tone]}`}>{stateWord}</span>
        <UnitDetail server={server} noCommand={r.no_command} scanningHint={r.scanning_hint} />
      </div>

      <TechBadges tokens={techTokens(server)} />
      <Readout text={readout} lit={lit} />
      <PowerSwitch
        on={on}
        label={on ? s.menu_stop : s.menu_start}
        inertReason={inertReason}
        onPress={() => onToggle(server)}
      />
      <span className="rk-ear is-right" aria-hidden />
    </li>
  );
}

/** The secondary line: the failure reason first when there is one, then the command. */
function UnitDetail({ server, noCommand, scanningHint }: { server: DevServerView; noCommand: string; scanningHint: string }) {
  return (
    // flex-1 is basis 0: the detail takes only what the name and the state word leave.
    <span className="flex items-baseline gap-3 min-w-0 flex-1">
      {server.error && (
        <Tooltip content={server.error}>
          <span className="typo-body text-status-error truncate min-w-0" data-testid="rack-error">
            {server.error}
          </span>
        </Tooltip>
      )}
      {server.state === 'scanning' ? (
        <span className="typo-body text-status-info truncate min-w-0">{scanningHint}</span>
      ) : (
        <span className="typo-code rk-muted truncate min-w-0">{server.devCommand ?? noCommand}</span>
      )}
    </span>
  );
}
