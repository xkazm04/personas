// RemoteDeviceColumn — "On <device>": remote sessions no local project claims.
//
// A sibling of `TeamColumn`, not a mode of it. A team column's header is the
// rail's scope control and its right-click is a project switch; a device
// column has neither (there is no roster to scope a feed to, and no local
// project to switch), so its header is a plain label rather than a control that
// would do nothing. Same width, same body (`ColumnBody`), same staged ghost, so
// on the board it reads as one more column in the row.
//
// `BoardColumnSlot` is the one place the board chooses between the two.

import type { ReactNode } from 'react';
import { Laptop } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ColumnBody } from '../ColumnBody';
import { ColumnGhost } from '../BoardGhost';
import { COLUMN_BODY_MAX_H, type ColumnRow } from '../gridGeometry';
import type { BoardColumn } from '../useBoardModel';
import { TeamColumn } from '../board/TeamColumn';

interface ColumnProps {
  column: BoardColumn;
  width: number;
  renderRow: (row: ColumnRow) => ReactNode;
  focusKey: string | null;
  staged: boolean;
}

export function RemoteDeviceColumn({ column, width, renderRow, focusKey, staged }: ColumnProps) {
  const { t, tx } = useTranslation();
  const device = column.remoteDevice?.displayName ?? column.teamName;
  return (
    <section
      className="flex min-h-0 flex-shrink-0 flex-col gap-1.5"
      style={{ width }}
      data-testid="fleet-grid-device-column"
      data-peer-id={column.remoteDevice?.peerId}
    >
      <div className="flex flex-shrink-0 flex-col gap-1 pb-2 pt-0.5">
        <div className="flex w-full items-baseline gap-1.5 px-1 py-0.5 text-foreground">
          <Laptop className="h-3 w-3 flex-shrink-0 self-center text-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate typo-label">{tx(t.monitor.remote_on_device, { device })}</span>
          <span className="flex-shrink-0 typo-caption tabular-nums opacity-50">{column.rows.length}</span>
        </div>
        <span aria-hidden className="h-0.5 w-full rounded-full bg-sky-500/40" />
      </div>
      {staged ? (
        <ColumnBody rows={column.rows} renderRow={renderRow} focusKey={focusKey} maxHeight={COLUMN_BODY_MAX_H} />
      ) : (
        <ColumnGhost rows={column.rows.length} maxHeight={COLUMN_BODY_MAX_H} width={width} />
      )}
    </section>
  );
}

/** A board column: a team's (or workspace group's) column, or a device's. */
export function BoardColumnSlot(props: ColumnProps & {
  scoped: boolean;
  onToggleScope: Parameters<typeof TeamColumn>[0]['onToggleScope'];
  reducedMotion: boolean;
}) {
  if (props.column.remoteDevice) return <RemoteDeviceColumn {...props} />;
  return <TeamColumn {...props} />;
}
