// RemoteSessionTile — a fleet session this device sent to a paired device.
//
// A SIBLING of `SessionTile`, not a third kind inside `FleetNode`: the node's
// rows are strict (the title row holds the title, the symbol row holds icons),
// and a remote session has to say three things in words — WHICH device, and
// either "queued until it wakes", "last seen <ago>" or the returned work's
// receipt. So it wears the node's shell, hue wash and state glyph, and adds a
// device chip (the shared `Badge`) and one status line (`REMOTE_TILE_H`).
//
// THE STATE IS NEVER ASSUMED. It is `effectiveRemoteState(view, now)`, re-read
// on the shared 15 s ticker, so a session whose mirror went quiet turns
// `unknown` (dimmed) on this device's clock without waiting for an event.
// Clicking opens `RemoteSessionDrawer` through the Monitor's drawer shell.

import { memo, type ReactNode } from 'react';
import { HelpCircle, Laptop } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import { Badge } from '@/features/shared/components/display/Badge';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RemoteReceiptLine } from '@/features/shared/dispatch/RemoteReceiptLine';
import { useFixedTicker } from '@/hooks/utility/timing/relativeTimeTicker';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import type { RemoteSessionState } from '@/lib/bindings/RemoteSessionState';
import type { RemoteSessionView } from '@/lib/bindings/RemoteSessionView';
import { effectiveRemoteState, isRemoteSessionSettled, remoteLastSeenMs } from '@/lib/network/remoteSessionModel';
import { sessionStateMeta } from '../fleetSessionModel';
import { frameClass, sessionHue, symbolClass, type NodeHue } from '../board/node/nodeHues';
import { SESSION_STATE_MARK, type StateMark } from '../board/node/nodeSymbols';
import { StateGlyph, Sym } from '../board/node/NodeSymbolParts';

/** How often a remote tile re-reads its liveness: a third of the 45 s rule. */
const LIVENESS_TICK_MS = 15_000;

const UNKNOWN_HUE: NodeHue = { dot: 'bg-foreground/40', tint: 'bg-foreground/[0.03]' };
const UNKNOWN_MARK: StateMark = { kind: 'icon', icon: HelpCircle };

function visualFor(state: RemoteSessionState): { hue: NodeHue; mark: StateMark } {
  if (state === 'unknown') return { hue: UNKNOWN_HUE, mark: UNKNOWN_MARK };
  return { hue: sessionHue(state), mark: SESSION_STATE_MARK[state] };
}

export const RemoteSessionTile = memo(function RemoteSessionTile({
  view, width, height, onOpen,
}: {
  view: RemoteSessionView;
  width: number;
  height: number;
  /** Open the remote session's drawer. Absent = an inert, labelled tile. */
  onOpen?: (jobId: string) => void;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  useFixedTicker(LIVENESS_TICK_MS);
  const reducedMotion = useReducedMotion() ?? false;
  const state = effectiveRemoteState(view, Date.now());
  const { hue, mark } = visualFor(state);
  const stateLabel = state === 'unknown' ? m.remote_state_unknown : t.plugins.fleet[sessionStateMeta(state).labelKey];
  const device = view.peerDisplayName || view.peerId.slice(0, 8);
  const title = view.title?.trim() || view.projectLabel || view.jobId.slice(0, 8);
  const summary = [title, stateLabel, tx(m.remote_on_device, { device })].join(' · ');
  const lastSeen = remoteLastSeenMs(view);

  let status: ReactNode;
  if (state === 'queued') {
    status = tx(m.remote_queued_until, { device });
  } else if (state === 'unknown') {
    status = lastSeen === null
      ? m.remote_never_seen
      : <>{m.remote_last_seen} <RelativeTime timestamp={lastSeen} showTooltip={false} /></>;
  } else if (isRemoteSessionSettled(view)) {
    status = view.receipt
      ? <RemoteReceiptLine receipt={view.receipt} className="max-w-full" />
      : tokenLabel(t, 'remote_job', view.jobStatus);
  } else {
    status = view.stateReason ?? stateLabel;
  }

  const body = (
    <>
      <Tooltip content={<span className="whitespace-pre-line">{summary}</span>}>
        <span className="block min-w-0 truncate typo-body leading-5 text-foreground">{title}</span>
      </Tooltip>
      <span aria-hidden className="h-px w-full bg-foreground/10" />
      <span className="flex h-[18px] min-w-0 items-center gap-1">
        <Sym id="state" label={stateLabel} testId="fleet-remote-state" data={{ 'data-state': state }} className={symbolClass(hue)}>
          <StateGlyph mark={mark} reducedMotion={reducedMotion} />
        </Sym>
        <Badge variant="sky" size="xs" className="min-w-0 max-w-full" data-testid="fleet-remote-device">
          <Laptop className="h-2.5 w-2.5 flex-shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{device}</span>
        </Badge>
      </span>
      <span className="flex h-3.5 min-w-0 items-center truncate typo-label text-foreground" data-testid="fleet-remote-status">
        {status}
      </span>
    </>
  );

  const bodyClass = 'relative flex h-full w-full min-w-0 flex-col justify-between px-1 py-0.5 text-left';
  return (
    <div
      className={`group relative flex flex-shrink-0 overflow-hidden rounded-input transition-[opacity,filter] ${frameClass(hue)} ${
        state === 'unknown' ? 'opacity-60 grayscale' : ''
      }`}
      style={{ width, height }}
      data-testid="fleet-grid-remote"
      data-job-id={view.jobId}
      data-state={state}
    >
      {onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(view.jobId)}
          aria-label={tx(m.remote_tile_aria, { title, state: stateLabel, device })}
          data-testid="fleet-grid-remote-open"
          className={`${bodyClass} focus-ring rounded-interactive transition-[filter] hover:brightness-110`}
        >
          {body}
        </button>
      ) : (
        <span role="img" aria-label={summary} className={bodyClass}>{body}</span>
      )}
    </div>
  );
});

export default RemoteSessionTile;
