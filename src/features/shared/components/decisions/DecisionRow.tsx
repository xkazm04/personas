/**
 * @catalog One list row for any decision stream — title, supporting line, facts, verdict.
 *
 * The three decision surfaces had three row layouts. The backlog rendered its
 * title and its metadata both at `typo-caption`, so the two lines were
 * indistinguishable; Manual Review's `ReviewListItem` had the right hierarchy
 * (heading-weight title over a muted supporting row) but only reviews could use
 * it. This is that hierarchy, generalized:
 *
 *   title      — typo-heading, the thing you scan
 *   summary    — typo-caption muted, the thing you read if the title interests you
 *   meta line  — chip · source · facts · relative time, all subordinate
 *
 * The left accent rail is the category signal, mirroring Manual Review's
 * category border. Verdict actions live on the right and stop row-click
 * propagation, so "open" and "decide" never fight.
 */
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

import { RelativeTime } from '../display/RelativeTime';
import { DecisionActions } from './DecisionActions';
import type { DecisionAction, DecisionRecord } from './decisionTypes';

export function DecisionRow({
  record,
  actions = [],
  active = false,
  onOpen,
  leading,
  meta,
  trailing,
  testId,
}: {
  record: DecisionRecord;
  actions?: DecisionAction[];
  active?: boolean;
  /** Omit to make the row inert (decide-in-place, nothing to open). */
  onOpen?: () => void;
  /** Appended to the meta line — severity glyphs, source badges. Lets a richer
   *  stream keep its own signals without forking the row. */
  meta?: ReactNode;
  /** Avatar-ish slot before the text — Manual Review's persona icon, a severity
   *  glyph. Keeps richer streams on this row instead of forking it. */
  leading?: ReactNode;
  /** Extra content between the meta line and the actions (badges, progress). */
  trailing?: ReactNode;
  /** Preserved for UI-automation selectors that predate this component. */
  testId?: string;
}) {
  const clickable = Boolean(onOpen);

  return (
    <li
      data-testid={testId}
      className={`flex items-start gap-3 px-4 py-3 border-l-2 transition-colors ${
        active
          ? 'border-l-primary bg-primary/[0.08]'
          : `${record.accentClass ?? 'border-l-transparent'} ${clickable ? 'hover:bg-secondary/30' : ''}`
      }`}
    >
      {leading && <div className="shrink-0 mt-0.5">{leading}</div>}

      <div className="min-w-0 flex-1">
        {clickable ? (
          <button type="button" onClick={onOpen} className="w-full text-left group">
            <RowBody record={record} meta={meta} chevron />
          </button>
        ) : (
          <RowBody record={record} meta={meta} />
        )}
      </div>

      {trailing}

      {actions.length > 0 && (
        // The row opens; the buttons decide. Without this the verdict click
        // would also fire the row's open handler.
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <DecisionActions actions={actions} />
        </div>
      )}
    </li>
  );
}

function RowBody({ record, meta, chevron }: { record: DecisionRecord; meta?: ReactNode; chevron?: boolean }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <p className="typo-heading text-foreground/90 truncate min-w-0">{record.title}</p>
        {chevron && (
          <ChevronRight className="w-3.5 h-3.5 shrink-0 text-foreground/30 group-hover:text-foreground/60 transition-colors" />
        )}
      </div>

      {record.summary && (
        <p className="typo-caption text-muted-foreground truncate mt-0.5">{record.summary}</p>
      )}

      <div className="flex items-center gap-2.5 mt-1 flex-wrap">
        {record.category && (
          <span
            className={`typo-label px-1.5 py-0.5 rounded ${record.categoryClass ?? 'bg-primary/10 text-primary/80'}`}
          >
            {record.category}
          </span>
        )}
        {record.source && (
          <span className="typo-caption text-muted-foreground">{record.source}</span>
        )}
        {record.facts?.map((f) => (
          <span key={f.label} className="inline-flex items-baseline gap-1" title={f.title}>
            <span className="typo-label text-muted-foreground">{f.label}</span>
            <span className="typo-caption text-foreground tabular-nums">{f.value}</span>
          </span>
        ))}
        {record.timestamp && (
          <RelativeTime timestamp={record.timestamp} className="typo-caption text-muted-foreground" />
        )}
        {meta}
      </div>
    </>
  );
}
