/**
 * A long body section folded to ONE counted line ("Evidence · 42 lines ·
 * {"run": ...") that opens in place, so the default card shows the ask, the
 * outcome pair and the dock without scrolling. A click opens or closes this
 * fold; the printed key (`I`) opens or closes every fold on the card at once
 * (`FoldSignal`, owned by the session and reset per card).
 *
 * A section short enough to read at a glance is never folded: `DeckSection`
 * renders it open, under the same eyebrow, with no control.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { Keycap } from './parts';

/** Every fold on the card follows `open` whenever `gen` moves. */
export interface FoldSignal { open: boolean; gen: number }

export const FOLDS_CLOSED: FoldSignal = { open: false, gen: 0 };

export const FoldContext = createContext<FoldSignal>(FOLDS_CLOSED);

/** The fold key: free in the deck's grammar (`useDeckKeys`), printed on every fold. */
export const FOLD_KEY = 'I';

export function DeckSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex max-w-[68ch] flex-col gap-1.5">
      <span className="typo-eyebrow text-foreground">{title}</span>
      {children}
    </section>
  );
}

export function DeckFold({ id, title, summary, children }: {
  /** Unique on the card; ties the control to its region. */
  id: string;
  title: string;
  /** The counted one-line summary shown while folded. */
  summary: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  const signal = useContext(FoldContext);
  const [open, setOpen] = useState(signal.open);
  // The card-wide key moves every fold; a click after it moves only this one.
  useEffect(() => { setOpen(signal.open); }, [signal.gen, signal.open]);
  const region = `deck-fold-${id}`;
  return (
    <section className="au-fold flex max-w-[68ch] flex-col rounded-card" data-open={open ? '' : undefined} data-testid={region}>
      <Button
        variant="ghost"
        size="md"
        block
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={region + '-body'}
        icon={<ChevronRight className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />}
        className="min-w-0 justify-start! rounded-card px-3! py-2! hover:bg-transparent [&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1 [&>span:last-child]:items-center [&>span:last-child]:gap-3"
      >
        <span className="flex min-w-0 flex-1 items-baseline gap-2 text-left">
          <span className="flex-shrink-0 whitespace-nowrap typo-eyebrow text-foreground">{title}</span>
          {!open && <span className="min-w-0 truncate typo-body text-foreground">{summary}</span>}
        </span>
        <span className="flex flex-shrink-0 items-center gap-1.5 typo-caption">
          <Keycap>{FOLD_KEY}</Keycap>
          {open ? m.dc_deck_fold_collapse : m.dc_deck_fold_expand}
        </span>
      </Button>
      {open && (
        <div id={region + '-body'} className="px-3 pb-3">
          {children}
        </div>
      )}
    </section>
  );
}
