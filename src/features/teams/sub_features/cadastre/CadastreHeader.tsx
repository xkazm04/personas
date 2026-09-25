// The band: the claimed share at its start, then the three filter tags, and
// nothing in between (owner, 2026-09-23: "throw whole middle section, keeping
// only its start with claimed percentage ... continue with filter tags").
//
// The project switch is the product's own picker in the page header above, and
// the theme is the app's; the band carries only the DEV rehearsal switch at its
// right, the 19 / 100 the winner used to prove the register holds at scale.
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { formatPercent } from '@/lib/utils/formatters';

import type { TFeatures } from '../featuresModel';
import type { CadFilter } from './cadastreModel';

export interface CadastreHeaderProps {
  share: { claimed: number; total: number; ratio: number | null };
  waiting: number;
  trouble: number;
  unclaimed: number;
  filter: CadFilter | null;
  onFilter: (f: CadFilter) => void;
  /** Tone parcels while a tag is hovered or focused. */
  onHover: (f: CadFilter | null) => void;
  /** DEV only: the rehearsal switch. Absent in a production build. */
  rehearsal: { big: boolean; real: number; onToggle: () => void } | null;
  t: TFeatures;
  tx: (template: string, vars: Record<string, string | number>) => string;
  language: string;
}

interface TagSpec {
  move: CadFilter;
  cls: string;
  count: number;
  words: string;
  key: string;
}

export function CadastreHeader({ share, waiting, trouble, unclaimed, filter, onFilter, onHover, rehearsal, t, tx, language }: CadastreHeaderProps) {
  const tags: TagSpec[] = [
    { move: 'waiting', cls: 'gate', count: waiting, words: waiting === 1 ? t.cadastre_tag_waiting_one : t.cadastre_tag_waiting_other, key: 'w' },
    { move: 'trouble', cls: 'trouble', count: trouble, words: t.cadastre_tag_trouble, key: 'i' },
    { move: 'unclaimed', cls: 'open', count: unclaimed, words: t.cadastre_tag_unclaimed, key: 'u' },
  ];

  return (
    <header className="band" data-role="cad-band" data-testid="cad-band">
      <Tooltip content={tx(t.cadastre_share_hint, { claimed: share.claimed, total: share.total })}>
        <div className="b-claim" data-role="cad-share">
          <b>{share.ratio == null ? t.not_measured : formatPercent(share.ratio, { fromRatio: true, precision: 0, language })}</b>
          <span>
            {t.cadastre_share_line1}
            <br />
            {t.cadastre_share_line2}
          </span>
        </div>
      </Tooltip>

      <div className="b-tags" role="group" aria-label={t.cadastre_tags_label} onMouseLeave={() => onHover(null)} onBlur={() => onHover(null)}>
        {tags.map((tag) => (
          <button
            key={tag.move}
            type="button"
            className={`ftag ${tag.cls}`}
            data-role="cad-tag"
            data-move={tag.move}
            data-testid={`cad-tag-${tag.move}`}
            aria-pressed={filter === tag.move}
            disabled={tag.count === 0}
            onClick={() => onFilter(tag.move)}
            onMouseEnter={() => onHover(tag.move)}
            onFocus={() => onHover(tag.move)}
          >
            <b>{tag.count}</b>
            <span>{tag.words}</span>
            <kbd className="kbd">{tag.key}</kbd>
          </button>
        ))}
      </div>

      <div className="b-grow" />

      {rehearsal ? (
        <div className="seg" role="group" aria-label={t.cadastre_rehearsal_label}>
          <button type="button" className={rehearsal.big ? '' : 'is-on'} aria-pressed={!rehearsal.big} onClick={rehearsal.big ? rehearsal.onToggle : undefined} data-testid="cad-rehearsal-real">
            {rehearsal.real}
          </button>
          <button type="button" className={rehearsal.big ? 'is-on' : ''} aria-pressed={rehearsal.big} onClick={rehearsal.big ? undefined : rehearsal.onToggle} data-testid="cad-rehearsal-100">
            100
          </button>
          <span className="seg-k">
            <kbd className="kbd">d</kbd>
          </span>
        </div>
      ) : null}
    </header>
  );
}
