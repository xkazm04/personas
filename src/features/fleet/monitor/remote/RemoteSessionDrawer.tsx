// RemoteSessionDrawer — one fleet session running on a paired device, opened
// from its `remote:<jobId>` tile through the Monitor's drawer shell.
//
// Top to bottom: the state header (title, device, the effective state and its
// reason), the returned work once the job is done, the read-only terminal
// mirror, the steer row, and the job's progress notes.
//
// The view is read LIVE from the slice by job id, so a push that moves the
// session re-renders the drawer in place. The state is `effectiveRemoteState`
// on the shared 15 s ticker - the same read the tile makes, so the two never
// disagree about whether the session is alive.
//
// CLOSING NEVER CANCELS. Unmounting unsubscribes the terminal tail and nothing
// else; the session keeps running on the other machine.

import { Laptop, X } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Badge } from '@/features/shared/components/display/Badge';
import { RemoteReceiptLine } from '@/features/shared/dispatch/RemoteReceiptLine';
import { useFixedTicker } from '@/hooks/utility/timing/relativeTimeTicker';
import { useTranslation } from '@/i18n/useTranslation';
import { effectiveRemoteState } from '@/lib/network/remoteSessionModel';
import { useSystemStore } from '@/stores/systemStore';
import { sessionStateMeta } from '../grid/fleetSessionModel';
import { RemoteNotesList } from './RemoteNotesList';
import { RemoteSteerRow } from './RemoteSteerRow';
import { RemoteTerminalMirror } from './RemoteTerminalMirror';

export function RemoteSessionDrawer({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const view = useSystemStore((s) => s.remoteSessions[jobId]);
  useFixedTicker(15_000);

  const close = (
    <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t.common.close} data-testid="remote-drawer-close">
      <X className="h-4 w-4" aria-hidden />
    </Button>
  );

  if (!view) {
    return (
      <div className="flex items-center justify-between gap-3 px-5 py-4" data-testid="remote-drawer-gone">
        <p className="typo-body text-foreground">{m.remote_session_gone}</p>
        {close}
      </div>
    );
  }

  const state = effectiveRemoteState(view, Date.now());
  const stateLabel = state === 'unknown' ? m.remote_state_unknown : t.plugins.fleet[sessionStateMeta(state).labelKey];
  const device = view.peerDisplayName || view.peerId.slice(0, 8);
  const title = view.title?.trim() || view.projectLabel || view.jobId.slice(0, 8);

  return (
    <div
      className="flex max-h-full min-h-0 flex-col"
      role="region"
      aria-label={tx(m.remote_drawer_aria, { device })}
      data-testid="remote-session-drawer"
      data-state={state}
    >
      <div className="flex h-14 flex-shrink-0 items-center justify-between gap-3 border-b border-primary/10 bg-secondary/20 px-5">
        <div className="min-w-0">
          <h3 className="truncate typo-heading text-foreground">{title}</h3>
          <p className="flex min-w-0 items-center gap-2 typo-caption text-foreground">
            <Badge variant="sky" size="xs" className="flex-shrink-0">
              <Laptop className="h-2.5 w-2.5" aria-hidden />
              {device}
            </Badge>
            <span className="flex-shrink-0" data-testid="remote-drawer-state">{stateLabel}</span>
            {view.stateReason && <span className="min-w-0 truncate opacity-70">{view.stateReason}</span>}
          </p>
        </div>
        {close}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {view.receipt && (
          <section aria-label={m.remote_receipt_title}>
            <h4 className="typo-label text-primary">{m.remote_receipt_title}</h4>
            <RemoteReceiptLine receipt={view.receipt} className="mt-1 typo-caption" />
          </section>
        )}
        <RemoteTerminalMirror jobId={view.jobId} device={device} />
        <RemoteSteerRow view={view} state={state} device={device} />
        <RemoteNotesList jobId={view.jobId} refreshKey={`${view.jobStatus}:${view.state}`} />
      </div>
    </div>
  );
}

export default RemoteSessionDrawer;
