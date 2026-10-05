/**
 * One server on a Port map pin: the `server-item`. A pin usually holds one; a
 * port two projects share stacks them in the same card. Hover or keyboard focus
 * grows the item into its detail card (`PinDetail`), right-click or the Menu key
 * opens the shared server menu, and the lamp button is the primary toggle.
 */
import type { KeyboardEvent, MouseEvent } from 'react';
import { Play, Square } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevServerView } from '@/lib/bindings/DevServerView';

import { formatUptime, type WorkspaceTag } from '../../serverModel';
import { SERVER_TONE, TONE_TEXT, canStart, canStop } from '../../serverTone';
import PinDetail from './PinDetail';
import TechMarks from './TechMarks';

export interface PinItemProps {
  server: DevServerView;
  hostPort: number | null;
  now: number;
  workspace: WorkspaceTag | undefined;
  onMenu: (e: MouseEvent, server: DevServerView) => void;
  onToggle: (server: DevServerView) => void;
  /** Detail card opening side: toward the middle of the figure. */
  align: 'start' | 'end';
}

/** States whose start stamp is worth an uptime readout. */
const TIMED = new Set(['running', 'starting', 'stopping']);

/** The Menu key and Shift+F10 open the same menu a right-click does, at the item. */
function openMenuFromKey(e: KeyboardEvent<HTMLElement>) {
  if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return;
  e.preventDefault();
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.dispatchEvent(
    new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 16, clientY: r.top + r.height / 2 }),
  );
}

export default function PinItem({ server, hostPort, now, workspace, onMenu, onToggle, align }: PinItemProps) {
  const { t, tx } = useTranslation();
  const s = t.browser.servers;
  const spec = SERVER_TONE[server.state];
  const isHost = server.devPort === hostPort;
  const stoppable = canStop(server.state);
  const startable = canStart(server.state);
  const stateWord = s[`state_${server.state}`];
  const uptime = TIMED.has(server.state) ? formatUptime(server.startedAt, now) : null;

  let detail = (
    <span className="typo-code text-foreground truncate">{server.devCommand ?? s.portmap.no_command}</span>
  );
  if (server.state === 'failed' && server.error) {
    // The whole error is one hover away, in the detail card.
    detail = <span className="typo-caption text-status-error truncate">{server.error}</span>;
  } else if (server.state === 'external' && server.externalPid != null) {
    detail = <span className="typo-data pm-tone-ink truncate">{tx(s.external_pid, { pid: server.externalPid })}</span>;
  } else if (uptime) {
    detail = <span className="typo-data pm-tone-ink truncate">{tx(s.uptime, { duration: uptime })}</span>;
  }

  return (
    <div
      className={`pm-item pm-t-${spec.tone}`}
      tabIndex={0}
      role="group"
      aria-label={`${server.projectName}, ${server.devPort}, ${stateWord}`}
      data-testid="server-item"
      data-project-id={server.projectId}
      data-state={server.state}
      onContextMenu={(e) => onMenu(e, server)}
      onKeyDown={openMenuFromKey}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={`pm-lamp ${spec.tone !== 'off' ? 'is-lit' : ''} ${spec.pulse ? 'is-pulse' : ''}`} aria-hidden />
        <span className="typo-title-lg truncate min-w-0 flex-1">{server.projectName}</span>
      </div>
      <div className={`typo-label truncate ${TONE_TEXT[spec.tone]}`}>{stateWord}</div>
      <div className="flex min-w-0">{detail}</div>
      <div className="flex items-center gap-2 min-w-0 mt-1">
        <span className="flex items-center min-w-0 flex-1">
          <TechMarks server={server} />
        </span>
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label={stoppable ? s.menu_stop : s.menu_start}
          disabled={isHost || (!stoppable && !startable)}
          disabledReason={isHost ? s.host_guard : undefined}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(server);
          }}
          data-testid="server-toggle"
        >
          {stoppable ? <Square className={`w-3.5 h-3.5 ${TONE_TEXT[spec.tone]}`} /> : <Play className="w-3.5 h-3.5" />}
        </Button>
      </div>
      <PinDetail server={server} uptime={uptime} workspace={workspace} isHost={isHost} align={align} />
    </div>
  );
}
