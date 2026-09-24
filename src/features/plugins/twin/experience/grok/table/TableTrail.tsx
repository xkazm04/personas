/**
 * Compact thread of the last exchanges — the table's memory of what was played.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { deriveDeskTrail } from '../../../setup/desk/trailModel';
import type { SetupHistoryEntry } from '../../../setup/setupContract';

interface TableTrailProps {
  history: SetupHistoryEntry[];
  question: string | null;
}

export function TableTrail({ history, question }: TableTrailProps) {
  const { t, tx } = useTranslation();
  const xg = t.twin.experience_grok;
  const trail = deriveDeskTrail(history, question);
  const [open, setOpen] = useState(false);

  if (trail.recent.length === 0 && trail.earlier.length === 0) return null;

  return (
    <div className="w-full max-w-[52rem] mx-auto mb-4" data-testid="setup-desk-trail">
      {trail.earlier.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          data-testid="setup-desk-trail-earlier"
          className="focus-ring flex items-center gap-1 typo-caption text-primary mb-1"
        >
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          {open ? xg.table.earlierHide : tx(xg.table.earlier, { count: trail.earlier.length })}
        </button>
      )}
      <ul className="space-y-2">
        {(open ? trail.earlier : []).concat(trail.recent).map((ex) => (
          <li
            key={ex.id}
            className="pl-3 border-l-2 border-primary/20 space-y-0.5"
            data-testid="setup-desk-trail-exchange"
          >
            <p className="typo-caption">{ex.question}</p>
            <p className="typo-body text-foreground">
              {ex.answer === null ? xg.table.skipped : ex.answer}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default TableTrail;
