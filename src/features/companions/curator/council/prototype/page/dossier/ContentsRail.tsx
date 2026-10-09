// PROTOTYPE ROUND (spark council-readout). The Dossier's contents: a NAMED
// nav landmark whose entries are the page's real headings, with the current
// one STATED (`aria-current`) as well as painted. A member's entry carries
// its score as a small track, so the rail is also the page's first chart.
import type { MouseEvent } from 'react';
import { ArrowLeft } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';

import type { Seat } from '../../../table/runModel';
import { PROTO } from '../../protoStrings';
import { memberName, sectionId, useScore } from './format';
import { S } from './strings';
import { Track } from './Track';

export interface RailEntry {
  key: string;
  label: string;
  count?: number;
  seat?: Seat;
}

export function ContentsRail({
  entries,
  current,
  onBack,
  onJump,
}: {
  entries: RailEntry[];
  current: string | null;
  onBack: () => void;
  onJump: (key: string) => void;
}) {
  const score = useScore();
  const click = (key: string) => (e: MouseEvent) => {
    e.preventDefault();
    onJump(key);
  };
  return (
    <div className="dz-rail">
      <Button variant="ghost" size="md" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack} className="self-start">
        <span className="whitespace-nowrap typo-body">{PROTO.back}</span>
        <kbd className="ml-1 rounded-interactive border border-border px-1.5 typo-code text-muted">{S.esc}</kbd>
      </Button>
      <nav aria-label={S.contents}>
        <p className="m-0 mb-2 pl-4 typo-eyebrow text-muted">{S.contents}</p>
        <ol>
          {entries.map((entry) => {
            const on = current === entry.key;
            const seat = entry.seat;
            return (
              <li key={entry.key} className={seat ? 'dz-rail__sub' : undefined}>
                <a
                  href={`#${sectionId(entry.key)}`}
                  onClick={click(entry.key)}
                  aria-current={on ? 'location' : undefined}
                  className="dz-rail__link focus-ring"
                >
                  <span className={seat ? 'typo-body' : 'typo-heading'}>{seat ? memberName(seat.name) : entry.label}</span>
                  {seat ? (
                    <span className={`typo-data ${seat.score == null ? 'text-muted' : ''}`}>
                      {seat.score == null ? '–' : score(seat.score)}
                    </span>
                  ) : entry.count != null ? (
                    <span className="typo-data text-muted">{entry.count}</span>
                  ) : (
                    <span />
                  )}
                  {seat ? (
                    <Track
                      size="xs"
                      value={seat.score}
                      threshold={seat.threshold}
                      floorHit={seat.floorHit}
                      label={`${memberName(seat.name)} ${seat.score == null ? S.notMeasured : score(seat.score)}`}
                    />
                  ) : null}
                </a>
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
