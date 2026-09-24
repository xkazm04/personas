// One row of the queue: what the council got to, against what bar, on how
// much evidence, and where it came from.
//
// The glyph is `RowGlyph`, NOT the rose. A row is drawn from the list
// projection, which has no per-member scores, and a rose there would draw
// five hatched wedges - which says "we measured nothing" when the truth is
// "we have not read the round". The rose is the round table's and the
// preview's, where the members are actually on hand.
import { memo } from 'react';

import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import { useTranslation } from '@/i18n/useTranslation';

import { resolveRubric } from '../table/rubrics';
import { RowGlyph } from '../table/svg/RowGlyph';
import { usePercent } from '../table/usePercent';
import { StateChip } from './chips';

export const QueueRow = memo(function QueueRow({
  subject,
  selected,
  index,
  onSelect,
  onOpen,
}: {
  subject: CouncilSubjectState;
  selected: boolean;
  index: number;
  onSelect: (index: number) => void;
  onOpen: (subject: CouncilSubjectState) => void;
}) {
  const { t, tx } = useTranslation();
  const b = t.council.bench;
  const tbl = t.council.table;
  const percent = usePercent();
  const { rubric } = resolveRubric(null, subject.kind);
  const glyphLabel = tx(tbl.row_glyph_label, {
    overall: subject.overall == null ? tbl.rose_no_overall : subject.overall.toFixed(2),
    threshold: rubric.threshold.toFixed(2),
    coverage: subject.coverage == null ? tbl.not_measured : percent(subject.coverage),
  });

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-testid="council-queue-row"
      onClick={() => onSelect(index)}
      onDoubleClick={() => onOpen(subject)}
      className={`grid w-full grid-cols-[54px_1fr] items-center gap-3.5 rounded-card border px-3 py-2.5 text-left transition-colors ${
        selected
          ? 'border-primary/55 bg-card-bg shadow-elevation-2'
          : 'border-transparent hover:bg-secondary/[0.06]'
      }`}
    >
      <RowGlyph
        overall={subject.overall}
        coverage={subject.coverage}
        threshold={rubric.threshold}
        floorHit={subject.floorHits > 0 || subject.hardFailures > 0}
        label={glyphLabel}
      />
      <span className="min-w-0">
        <b className="block truncate typo-heading text-foreground">{subject.title}</b>
        <span className="mt-1.5 flex flex-wrap items-center gap-2">
          <StateChip state={subject.state} />
          <span className="typo-body text-muted">
            {subject.roundNo == null
              ? tx(b.row_meta_no_round, { project: subject.projectName })
              : tx(b.row_meta, { project: subject.projectName, round: subject.roundNo })}
          </span>
        </span>
      </span>
    </button>
  );
});

export default QueueRow;
