/**
 * The two things that used to be panels of their own down the right of the
 * table — the style studio and the played pile — folded into the foot of the
 * twin's card as two rows.
 *
 * There is one permanent panel beside the table now, and it is the twin
 * filling in. Everything else is a row you can open: the style row says where
 * the studio stands in one line and goes straight to the deck; the pile row
 * carries its own tally and unfolds the thread when it is asked for.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, Layers, Palette } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { DeskTrail } from '../../../setup/desk/trailModel';
import type { StyleStudioPhase } from '../../../setup/style/styleContract';
import { PlayedPile, pileTally } from './PlayedPile';

interface SideRowsProps {
  phase: StyleStudioPhase;
  styleName: string | null;
  trail: DeskTrail;
  onOpenStyle: () => void;
}

const ROW = 'focus-ring w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-primary/5 transition-colors';

export function SideRows({ phase, styleName, trail, onOpenStyle }: SideRowsProps) {
  const { t, tx } = useTranslation();
  const xo = t.twin.experience_opus;
  const [pileOpen, setPileOpen] = useState(false);
  const { played, kept } = pileTally(trail);
  // Drafts (or three rolled candidates) waiting on a decision: the one state
  // of the studio that asks the person for something.
  const waiting = phase === 'preview' || phase === 'candidates';

  const status =
    phase === 'materializing'
      ? tx(xo.style.drafting, { name: styleName ?? '' })
      : phase === 'rolling'
        ? xo.style.rolling
        : phase === 'candidates'
          ? xo.style.candidatesReady
          : phase === 'preview'
            ? tx(xo.style.draftsReady, { name: styleName ?? '' })
            : phase === 'applying'
              ? xo.style.saving
              : xo.style.idle;

  return (
    <div className="border-t border-primary/10" data-testid="xo-side-rows">
      <button
        type="button"
        onClick={onOpenStyle}
        aria-label={waiting ? xo.style.review : xo.style.open}
        className={ROW}
        data-testid="xo-style-dock-open"
      >
        <Palette className={`w-4 h-4 flex-shrink-0 ${waiting ? 'text-primary' : ''}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block typo-title text-foreground">{xo.style.title}</span>
          <span className={`block typo-caption truncate ${waiting ? 'text-primary' : ''}`} role="status">
            {status}
          </span>
        </span>
        <ChevronRight className="w-4 h-4 flex-shrink-0" aria-hidden />
      </button>

      <div className="border-t border-primary/10">
        <button
          type="button"
          onClick={() => setPileOpen((open) => !open)}
          aria-expanded={pileOpen}
          className={ROW}
          data-testid="xo-pile-toggle"
        >
          <Layers className="w-4 h-4 flex-shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block typo-title text-foreground">{xo.pile.label}</span>
            <span className="block typo-caption tabular-nums">{tx(xo.pile.tally, { played, kept })}</span>
          </span>
          {pileOpen ? (
            <ChevronDown className="w-4 h-4 flex-shrink-0" aria-hidden />
          ) : (
            <ChevronRight className="w-4 h-4 flex-shrink-0" aria-hidden />
          )}
        </button>
        {pileOpen && (
          <div className="px-3 pb-3">
            <PlayedPile trail={trail} />
          </div>
        )}
      </div>
    </div>
  );
}

export default SideRows;
