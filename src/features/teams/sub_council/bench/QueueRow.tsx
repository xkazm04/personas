// One row of the queue: the council's rose at 54 px, its title, its state and
// where it came from. The rose is the whole verdict in 54 pixels, which is
// why the row leads with it rather than with a coloured dot.
import { memo } from 'react';

import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import { useTranslation } from '@/i18n/useTranslation';

import { Rose } from '../table/svg/Rose';
import { resolveRubric } from '../table/rubrics';
import type { Seat } from '../table/runModel';
import { StateChip } from './chips';

/**
 * The mini rose without a run: the list projection carries the overall and
 * the floor-hit count but no per-member scores, so every wedge is drawn NOT
 * MEASURED rather than at an invented reach. That is the honest drawing of
 * "we have not read this round yet", and it fills in the moment the person
 * opens the table.
 */
function previewSeats(subject: CouncilSubjectState): Seat[] {
  const { rubric } = resolveRubric(null, subject.kind);
  return Object.entries(rubric.dimensions).map(([name, def]) => ({
    name,
    weight: def.weight,
    floor: def.floor,
    kind: def.kind,
    threshold: rubric.threshold,
    state: 'not_run' as const,
    score: null,
    confidence: null,
    floorHit: false,
    advisory: def.kind !== 'mechanical',
    findings: [],
    evidence: [],
    techniques: [],
    delta: null,
  }));
}

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
  const { rubric } = resolveRubric(null, subject.kind);
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
      <Rose
        seats={previewSeats(subject)}
        threshold={rubric.threshold}
        overall={subject.overall}
        size={54}
        mini
        label={t.council.table.rose_label}
        notMeasuredLabel={t.council.table.not_measured}
        noOverallLabel={t.council.table.rose_no_overall}
        overallLabel={t.council.table.rose_overall}
      />
      <span className="min-w-0">
        <b className="block truncate typo-title text-foreground">{subject.title}</b>
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
