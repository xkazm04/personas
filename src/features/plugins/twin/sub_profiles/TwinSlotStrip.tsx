import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import {
  TWIN_SLOTS,
  TWIN_SLOT_IDS,
  slotStatuses,
  twinStatusEntry,
  type TwinSlotId,
  type TwinSlotStatus,
} from '../shared/twinStatus';
import type { TwinReadiness } from '../useTwinReadiness';

/**
 * The thin strip along the bottom of a twin card: Bio / Tone / Brain /
 * Memories, one segment each, reporting the slot's status through the shared
 * `twinStatus` vocabulary. Colour AND shape both carry the status, so the
 * strip stays readable without colour (filled / half / hollow marker).
 *
 * A segment is a door, not a badge: pressing it activates the twin and opens
 * the tab that owns the slot (`TWIN_SLOTS[id].destination`).
 *
 * i18n: one vocabulary. The labels come from `twin.slots.*` and `twin.status.*`
 * — the keys `twinStatus.ts` has always documented — through the `labelKey` on
 * each table entry. Three parallel spellings of the same four words used to
 * live here (`twin.profiles.chip*`, `twin.progress.status*` and a local map per
 * call site); a reader could not tell which one a surface would render.
 */

interface TwinSlotStripProps {
  readiness: TwinReadiness;
  onOpenSlot: (slot: TwinSlotId) => void;
}

export function TwinSlotStrip({ readiness, onOpenSlot }: TwinSlotStripProps) {
  const { t, tx } = useTranslation();
  const twin = t.twin;
  const statuses = slotStatuses(readiness);

  return (
    <div className="flex items-stretch border-t border-primary/10 pointer-events-auto">
      {TWIN_SLOT_IDS.map((id) => {
        const status = statuses[id];
        const entry = twinStatusEntry(status);
        const label = twin.slots[TWIN_SLOTS[id].labelKey];
        const statusLabel = twin.status[entry.labelKey];
        return (
          <Tooltip
            key={id}
            placement="bottom"
            content={
              <span className="flex flex-col">
                <span>{statusLabel}</span>
                <span className="opacity-60">{tx(twin.profiles.openSection, { section: label })}</span>
              </span>
            }
          >
            <button
              type="button"
              onClick={() => onOpenSlot(id)}
              aria-label={`${label}, ${statusLabel}`}
              className="flex-1 min-w-0 flex items-center justify-center gap-1.5 px-2 py-2 transition-colors hover:bg-secondary/30 first:rounded-bl-card last:rounded-br-card"
            >
              <StatusMarker status={status} dot={entry.dot} ring={entry.ring} />
              <span className={`typo-label truncate ${status === 'empty' ? 'text-muted' : entry.text}`}>
                {label}
              </span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

/**
 * Shape is the second, redundant channel for the same status: a full disc for
 * `set`, a half-filled disc for `partial`, an empty ring for `empty`.
 */
function StatusMarker({ status, dot, ring }: { status: TwinSlotStatus; dot: string; ring: string }) {
  if (status === 'set') {
    return <span aria-hidden className={`w-2 h-2 shrink-0 rounded-full ${dot}`} />;
  }
  if (status === 'partial') {
    return (
      <span aria-hidden className={`relative w-2 h-2 shrink-0 rounded-full overflow-hidden ring-1 ${ring}`}>
        <span className={`absolute inset-y-0 left-0 w-1 ${dot}`} />
      </span>
    );
  }
  return <span aria-hidden className={`w-2 h-2 shrink-0 rounded-full ring-1 ${ring}`} />;
}
