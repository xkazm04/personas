/**
 * The played pile: what this sitting has been so far, newest on top. The last
 * two exchanges show in full, older ones fold behind one row — a thread, not
 * a transcript (the fold is `deriveDeskTrail`, shared with the Setup desk).
 * A skipped question lies here face down; a kept offer shows its stamp.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { DeskExchange, DeskTrail } from '../../../setup/desk/trailModel';

function Played({ exchange }: { exchange: DeskExchange }) {
  const { t } = useTranslation();
  const xo = t.twin.experience_opus.pile;
  const skipped = exchange.answer === null;
  return (
    <li
      className={`rounded-card px-3 py-2 space-y-1 ${skipped ? 'xo-back' : 'xo-card border border-primary/10'}`}
      data-testid="xo-pile-exchange"
    >
      {exchange.question && <p className="typo-caption line-clamp-2">{exchange.question}</p>}
      <p className="typo-caption text-foreground line-clamp-3">
        <span className="typo-label mr-1.5">{skipped ? xo.skipped : xo.you}</span>
        {exchange.answer}
      </p>
      {exchange.verdicts.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {exchange.verdicts.map((v) => (
            <span
              key={v.id}
              className={`px-1.5 py-0.5 rounded-pill border typo-label ${
                v.resolution === 'accepted'
                  ? 'border-status-success/40 text-status-success'
                  : 'border-foreground/15 text-foreground'
              }`}
            >
              {t.twin.experience_opus.loot.stamp[v.resolution]}
            </span>
          ))}
        </span>
      )}
    </li>
  );
}

export function PlayedPile({ trail }: { trail: DeskTrail }) {
  const { t, tx } = useTranslation();
  const xo = t.twin.experience_opus.pile;
  const [open, setOpen] = useState(false);
  const kept = trail.exchanges.reduce(
    (n, e) => n + e.verdicts.filter((v) => v.resolution === 'accepted').length,
    0,
  );
  const played = trail.exchanges.filter((e) => e.answer !== null).length;

  return (
    <section aria-label={xo.label} className="space-y-2" data-testid="xo-pile">
      <p className="flex items-baseline justify-between px-1">
        <span className="typo-label uppercase">{xo.label}</span>
        <span className="typo-caption tabular-nums">{tx(xo.tally, { played, kept })}</span>
      </p>
      {trail.exchanges.length === 0 ? (
        <p className="px-1 typo-caption">{xo.empty}</p>
      ) : (
        <ul className="space-y-2">
          {[...trail.recent].reverse().map((e) => (
            <Played key={e.id} exchange={e} />
          ))}
          {trail.earlier.length > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="focus-ring flex items-center gap-1.5 px-1 typo-caption hover:text-foreground transition-colors"
              >
                {open ? <ChevronDown className="w-3 h-3" aria-hidden /> : <ChevronRight className="w-3 h-3" aria-hidden />}
                {open ? xo.hideEarlier : tx(xo.earlier, { count: trail.earlier.length })}
              </button>
            </li>
          )}
          {open && [...trail.earlier].reverse().map((e) => <Played key={e.id} exchange={e} />)}
        </ul>
      )}
    </section>
  );
}

export default PlayedPile;
