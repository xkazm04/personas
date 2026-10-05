/**
 * The detail card a Port map pin grows into on hover or focus: the full dev
 * command, the workspace, the address and whatever the state has to say
 * (uptime, the foreign PID, the whole error, the host guard). Inert content:
 * the actions stay on the pin and in the right-click menu.
 */
import { useTranslation } from '@/i18n/useTranslation';
import type { DevServerView } from '@/lib/bindings/DevServerView';

import type { WorkspaceTag } from '../../serverModel';

interface PinDetailProps {
  server: DevServerView;
  uptime: string | null;
  workspace: WorkspaceTag | undefined;
  isHost: boolean;
  /** Which edge of the item the card opens from: toward the middle of the figure. */
  align: 'start' | 'end';
}

export default function PinDetail({ server, uptime, workspace, isHost, align }: PinDetailProps) {
  const { t, tx } = useTranslation();
  const s = t.browser.servers;
  const p = s.portmap;

  return (
    <div className={`pm-more is-${align}`} data-testid="portmap-detail">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 items-baseline">
        <dt className="typo-label text-foreground">{s.command_label}</dt>
        <dd className="typo-code text-foreground break-all">{server.devCommand ?? p.no_command}</dd>
        <dt className="typo-label text-foreground">{p.workspace_label}</dt>
        <dd className="flex items-center gap-1.5 min-w-0">
          <span className="pm-swatch" aria-hidden />
          <span className="typo-caption text-foreground truncate">{workspace?.name ?? p.no_workspace}</span>
        </dd>
        <dt className="typo-label text-foreground">{p.address_label}</dt>
        <dd className="typo-code text-foreground truncate">{server.url}</dd>
        {uptime && (
          <>
            <dt className="typo-label text-foreground">{p.uptime_label}</dt>
            <dd className="typo-data pm-tone-ink">{uptime}</dd>
          </>
        )}
        {server.externalPid != null && (
          <>
            <dt className="typo-label text-foreground">{p.pid_label}</dt>
            <dd className="typo-data pm-tone-ink">{tx(s.external_pid, { pid: server.externalPid })}</dd>
          </>
        )}
      </dl>
      {server.error && <p className="typo-caption text-status-error mt-1.5 break-words">{server.error}</p>}
      {isHost && <p className="typo-caption text-primary mt-1.5">{s.host_guard}</p>}
    </div>
  );
}
