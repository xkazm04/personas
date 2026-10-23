import { memo, useMemo } from 'react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { usePipelineStore } from '@/stores/pipelineStore';
import { channelKey, countUnread, EMPTY_CHANNEL } from '@/stores/slices/pipeline/channelSlice';
import { derivePresence, deriveLastSeen } from '@/features/teams/sub_collab/useTeamChannel';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { cleanName } from '../grid/fleetGridModel';
import { Lamp } from '../grid/prototype/entry-e/parts';
import { ProjectTip } from './ProjectTip';
import type { StreamTeam } from './types';

/* ----------------------------------------------------------------------------
 * PROJECT ROW - one line per project, in the Stewards row grammar (WP12).
 *
 * The bay's colour edge, the project's name, its members' presence as the bay
 * header's share strip (working / waiting / idle), then two right-aligned
 * tabular figures under the plate's column heads: NEW (unread, the D6
 * watermark) and YOU (what the project holds for the operator), and a lamp
 * lit ONLY while it holds something. Who works, waits or idles, when each was
 * last seen, a live deliberation and the last message's time are said in the
 * row's tooltip. memo + a per-key store selector: a quiet poll re-renders
 * nothing, a busy team re-renders one row.
 * -------------------------------------------------------------------------- */

/** A right-aligned tabular figure: blank at zero, `null` (unread) never prints. */
export function Figure({ n, warn = false }: { n: number | null; warn?: boolean }) {
  return (
    <span className={`w-8 flex-shrink-0 text-right typo-data tabular-nums ${warn ? 'text-status-warning' : 'text-foreground'}`}>
      {n !== null && n > 0 ? (n > 99 ? '99+' : n) : null}
    </span>
  );
}

export const ProjectRow = memo(function ProjectRow({ tm, active, onSelect, presenceNow, asks }: {
  tm: StreamTeam;
  active: boolean;
  onSelect: (teamId: string) => void;
  /** Coarse minute clock: presence has a staleness window, so the row re-derives it on the tick. */
  presenceNow: number;
  /** What the project holds for the operator; `null` while the queue is unread or unreadable. */
  asks: number | null;
}) {
  const st = usePipelineStore((s) => s.channels[channelKey(tm.teamId)]) ?? EMPTY_CHANNEL;
  const items = st.items;
  const unread = useMemo(() => countUnread(st), [st]);
  const presence = useMemo(() => derivePresence(items, presenceNow), [items, presenceNow]);
  const lastSeen = useMemo(() => deriveLastSeen(items), [items]);
  const live = useMemo(() => items.some((i) => i.deliberationId), [items]);
  const share = useMemo(() => {
    let working = 0;
    let waiting = 0;
    for (const p of presence.values()) { if (p === 'working') working++; else waiting++; }
    return { working, waiting, idle: Math.max(0, tm.members.length - working - waiting) };
  }, [presence, tm.members.length]);
  const name = cleanName(tm.teamName);
  const holding = asks !== null && asks > 0;

  return (
    <Tooltip
      placement="right"
      delay={400}
      content={<ProjectTip name={name} members={tm.members} presence={presence} lastSeen={lastSeen} share={share} live={live} newestAt={items[0]?.at ?? null} />}
    >
      <Button
        variant="ghost"
        size="xs"
        onClick={() => onSelect(tm.teamId)}
        aria-current={active}
        data-testid="conv-project-row"
        className={`ae-plan ae-focus relative pl-3.5! ${active ? 'is-open' : ''}`}
      >
        <span className="flex w-full min-w-0 items-center gap-1">
          <span aria-hidden className="absolute inset-y-1.5 left-1 w-1 rounded-full" style={{ backgroundColor: colorWithAlpha(tm.teamColor, 0.85) }} />
          <span className={`min-w-0 flex-1 truncate typo-body ${active ? 'text-primary' : 'text-foreground'}`}>{name}</span>
          <span className="ae-share w-4 flex-shrink-0" aria-hidden>
            <span className="ae-t-run" style={{ flexGrow: share.working }} />
            <span className="ae-t-warn" style={{ flexGrow: share.waiting }} />
            <span className="ae-t-off" style={{ flexGrow: share.idle }} />
          </span>
          <Figure n={unread} />
          <Figure n={asks} warn />
          <Lamp lamp={{ tone: holding ? 'warn' : 'off', lit: holding }} />
        </span>
      </Button>
    </Tooltip>
  );
});
