/**
 * DeskBuffer — what is still open, waiting at the left of the desk.
 *
 * One row per unfinished slot, each carrying its status as colour AND shape
 * (the `twinStatus` table owns both) plus its measured `have/target` fact. A
 * click moves the guided flow to that slot, so the order of the walk-through is
 * the user's whenever they want it. A slot that is finished in the Hub rather
 * than here (memories) carries the jump, so the buffer never dead-ends.
 */

import { ExternalLink } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { hubSlotForFocus, twinStatusEntry, type TwinSlotId } from '../../shared/twinStatus';
import type { SetupChecklistItem, SetupFocus } from '../setupContract';

interface DeskBufferProps {
  items: SetupChecklistItem[];
  focus: SetupFocus;
  onFocus: (focus: SetupFocus) => void;
  /** A slot the guide cannot finish here opens where it IS finished. */
  onOpenHub: (slot: TwinSlotId) => void;
}

export function DeskBuffer({ items, focus, onFocus, onOpenHub }: DeskBufferProps) {
  const { t } = useTranslation();
  const ts = t.twin.setup;

  return (
    <aside
      className="hidden lg:flex flex-col w-56 flex-shrink-0 border-r border-primary/10 bg-secondary/15 py-4"
      data-testid="setup-desk-buffer"
    >
      <p className="px-4 pb-2 typo-caption uppercase tracking-[0.18em]">{ts.desk.buffer}</p>
      {items.map((item) => {
        const entry = twinStatusEntry(item.status);
        const active = item.id === focus;
        const hubSlot = hubSlotForFocus(item.id);
        return (
          <div key={item.id}>
            <button
              type="button"
              onClick={() => onFocus(item.id)}
              data-testid={`setup-desk-buffer-${item.id}`}
              className={`flex items-center gap-2 w-full px-4 py-2 text-left transition-colors ${
                active ? 'bg-secondary/60' : 'hover:bg-secondary/40'
              }`}
            >
              <span aria-hidden className={`w-1.5 h-4 rounded-full ${active ? 'bg-primary' : entry.dot}`} />
              <span className="min-w-0 flex-1">
                <span className="block typo-caption text-foreground truncate">
                  {ts.checklist[item.labelKey]}
                </span>
                <span className={`block typo-caption tabular-nums truncate ${entry.text}`}>{item.detail}</span>
              </span>
            </button>
            {/* A slot the guide cannot finish here says where it IS finished,
                and only while it is the one being worked. */}
            {hubSlot && active && (
              <button
                type="button"
                onClick={() => onOpenHub(hubSlot)}
                data-testid={`setup-desk-open-hub-${item.id}`}
                className="flex items-center gap-1.5 w-full px-4 pb-2 pl-[1.6rem] typo-caption hover:text-foreground transition-colors"
              >
                <ExternalLink className="w-3 h-3" aria-hidden />
                {ts.desk.openHub}
              </button>
            )}
          </div>
        );
      })}
      {items.length === 0 && <p className="px-4 typo-caption text-status-success">{ts.desk.bufferClear}</p>}
    </aside>
  );
}

export default DeskBuffer;
