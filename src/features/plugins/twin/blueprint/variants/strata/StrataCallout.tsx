/**
 * The flat label beside a plate in the L1 overview, on a leader line from the
 * plate's right corner: the section name, its headline fill and three counts,
 * all at full type size. The plate is the control (it carries the accessible
 * name and points here for its description); the callout is a larger pointer
 * target for the same action, hidden from assistive tech so nothing is
 * announced twice.
 */
import type { CSSProperties } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import type { SectionId } from '../../blueprintContract';
import { StrataFigure } from './StrataFigure';
import type { StrataStat } from './strataModel';

interface StrataCalloutProps {
  id: string;
  section: SectionId;
  index: number;
  coverage: number | null;
  stats: StrataStat[];
  hot: boolean;
  onActivate: (section: SectionId) => void;
  onHot: (section: SectionId | null) => void;
}

export function StrataCallout({ id, section, index, coverage, stats, hot, onActivate, onHot }: StrataCalloutProps) {
  const { t } = useTranslation();
  const tb = t.twin.blueprint;
  return (
    <div
      id={id}
      className="strata-callout"
      data-section={section}
      data-hot={hot ? 'true' : undefined}
      style={{ '--i': index } as CSSProperties}
      aria-hidden
      tabIndex={-1}
      onClick={() => onActivate(section)}
      onPointerEnter={() => onHot(section)}
      onPointerLeave={() => onHot(null)}
    >
      <span className="strata-leader" />
      <div className="strata-callout-body">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="typo-section-title truncate">{tb.sections[section]}</span>
          <StrataFigure value={coverage} unit="ratio" className="typo-data-lg text-foreground" />
          {coverage === null && <span className="typo-caption truncate">{tb.states.notDrawn}</span>}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-0.5">
          {stats.map((s) => (
            <span key={s.key} className="inline-flex items-baseline gap-1.5" data-stat={s.key}>
              <span className="typo-caption">{s.label}</span>
              <StrataFigure value={s.value} unit={s.unit} className="typo-data text-foreground" />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
