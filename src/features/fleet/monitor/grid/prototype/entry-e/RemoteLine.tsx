// A session running on ANOTHER device, as a line of its bay (WP11 C): the same
// 36px line a local session wears (`SessionLine`), folded into the same piles,
// with a terminal in the face where a local line has its origin (the snapshot
// carries no origin), and the device's mesh glyph at the right edge, exactly
// where a peer's persona line wears it, so 'All' reads which device every line
// is on. Only what the device's snapshot carries is
// drawn: title, state, project, age. A remote row whose state could not be read
// is off, and says "Unknown".

import { memo } from 'react';
import { CircleHelp, SquareTerminal } from 'lucide-react';
import type { RemoteSessionView } from '@/lib/bindings/RemoteSessionView';
import { effectiveRemoteState } from '@/lib/network/remoteSessionModel';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { sessionStateMeta } from '../../fleetSessionModel';
import { pileOfKey } from './pileSkin';
import { sessionStateIcon } from './sessionBits';
import { DeviceGlyph } from './devices/DeviceGlyph';
import { Lamp } from './parts';
import { GlyphFace } from './LineParts';
import { SessionHead, lineStyle, sessionLineClass } from './SessionLine';
import { sessionSentence, sessionTail } from './sessionTailModel';

export const RemoteLine = memo(function RemoteLine({
  view, now, onOpen,
}: {
  view: RemoteSessionView;
  now: number;
  onOpen?: (jobId: string) => void;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const read = effectiveRemoteState(view, now);
  const state = read === 'unknown' ? null : read;
  const known = state !== null;
  const base = sessionTail({ state: state ?? 'exited', exitCode: null, startedAt: view.createdAtMs, now });
  const tail = known ? base : { ...base, kind: 'off' as const, tone: 'off' as const, lamp: { tone: 'off' as const, lit: false } };
  const title = view.title?.trim() || view.projectLabel || view.jobId.slice(0, 8);
  const device = view.peerDisplayName || view.peerId.slice(0, 8);
  const stateLabel = state ? (t.plugins.fleet[sessionStateMeta(state).labelKey] as string) : m.remote_state_unknown;
  const sentence = sessionSentence({ label: title, stateLabel, device, project: view.projectLabel || null, age: tail.age }, m, tx);

  return (
    <Tooltip content={sentence} placement="right" delay={450}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen?.(view.jobId)}
        onKeyDown={(e) => { if (e.key === 'Enter') onOpen?.(view.jobId); }}
        aria-label={sentence}
        data-testid="fleet-grid-remote"
        data-pile={pileOfKey(tail.kind)}
        data-kind={tail.kind}
        className={`${sessionLineClass(tail)} flex min-w-0 cursor-pointer items-center gap-1.5 pl-2 pr-2.5`}
        style={lineStyle(view.jobId)}
      >
        <GlyphFace Icon={SquareTerminal} />
        <SessionHead label={title} State={state ? sessionStateIcon(state) : CircleHelp} tail={{ ...tail, word: tail.word || !known }} stateLabel={stateLabel} project={null} />
        <span className="ml-auto flex flex-shrink-0 items-center gap-2 pl-1">
          <DeviceGlyph peerId={view.peerId} name={device} />
          <span className={`flex-shrink-0 typo-data tabular-nums ${tail.kind === 'working' ? 'ae-tone-text' : 'text-foreground'}`}>{tail.age}</span>
          <Lamp lamp={tail.lamp} />
        </span>
      </div>
    </Tooltip>
  );
});
