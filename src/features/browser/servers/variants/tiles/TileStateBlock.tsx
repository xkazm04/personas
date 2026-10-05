/**
 * Live tiles: the foot of a tile. The state as a lamp and a word in its tone,
 * one line of detail under it (uptime, the outside pid, the failure, or what is
 * happening), and the power control on the right.
 */
import { Power } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevServerView } from '@/lib/bindings/DevServerView';

import { SERVER_TONE } from '../../serverTone';
import type { TileControl } from './tileModel';

interface Props {
  server: DevServerView;
  control: TileControl;
  uptime: string | null;
  onToggle: (server: DevServerView) => void;
}

export function TileStateBlock({ server, control, uptime, onToggle }: Props) {
  const { t, tx } = useTranslation();
  const s = t.browser.servers;
  const lt = s.tiles;
  const spec = SERVER_TONE[server.state];
  const lit = spec.tone !== 'off';

  let detail: string | null = null;
  if ((server.state === 'running' || server.state === 'starting') && uptime) detail = tx(s.uptime, { duration: uptime });
  else if (server.state === 'external' && server.externalPid != null) detail = tx(s.external_pid, { pid: server.externalPid });
  else if (server.state === 'stopped') detail = lt.hint_stopped;
  else if (server.state === 'scanning') detail = lt.hint_scanning;
  else if (server.state === 'stopping') detail = lt.hint_stopping;
  else if (server.state === 'unconfigured') detail = lt.hint_unconfigured;
  else if (server.state === 'starting') detail = lt.hint_starting;

  const actionLabel = control === 'stop' ? s.menu_stop : s.menu_start;
  const reason =
    control === 'host' ? s.host_guard
    : control === 'unconfigured' ? lt.hint_unconfigured
    : control === 'busy' ? lt.busy_reason
    : undefined;
  const inert = control !== 'start' && control !== 'stop';

  return (
    <div className="lt-state">
      <span className={`lt-lamp${lit ? ' is-lit' : ''}${spec.pulse ? ' is-pulse' : ''}`} aria-hidden="true" />
      <div className="lt-state__text">
        <span className="lt-state__word typo-heading">{s[`state_${server.state}`]}</span>
        {server.state === 'failed' && server.error ? (
          <Tooltip content={server.error}>
            <span className="lt-state__error typo-caption" data-testid="server-item-error">
              {server.error}
            </span>
          </Tooltip>
        ) : (
          detail && <span className="lt-state__detail typo-caption text-foreground">{detail}</span>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-lg"
        className="lt-power"
        aria-label={actionLabel}
        disabled={inert}
        disabledReason={reason}
        data-testid="server-item-toggle"
        data-control={control}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(server);
        }}
        icon={<Power className="w-5 h-5" aria-hidden />}
      />
    </div>
  );
}
