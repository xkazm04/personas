// The preview beside the queue: everything a person needs to decide whether
// this is the council to open, and nothing they would have to scroll for.
//
// It reads the selected subject's latest round, so the rose here is the real
// one rather than the row's not-measured stand-in, and the why-line is the
// council's own reading rather than a summary of a summary.
import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';

import { gateOf, whyLine } from '../table/councilCopy';
import { resolveRubric } from '../table/rubrics';
import { seatsOf } from '../table/runModel';
import { Rose } from '../table/svg/Rose';
import { useCouncilRun } from '../table/useCouncilRun';
import { usePercent } from '../table/usePercent';
import { StateChip, Tag, kindWord } from './chips';

export function QueuePreview({
  subject,
  onOpen,
}: {
  subject: CouncilSubjectState;
  onOpen: (subject: CouncilSubjectState) => void;
}) {
  const { t, tx } = useTranslation();
  const b = t.council.bench;
  const tbl = t.council.table;
  const percent = usePercent();
  const run = useCouncilRun(subject.latestRunId);
  const { rubric } = resolveRubric(run.detail?.run.rubricVersion ?? null, subject.kind);
  const seats = seatsOf(run.detail?.run ?? null, subject.kind, run.detail?.verdicts ?? []);
  const gate = gateOf(subject, rubric, percent);
  const why = whyLine(seats, subject.overall, subject.coverage, rubric, percent);

  return (
    <div
      className="flex flex-col items-start gap-3 overflow-y-auto px-6 pb-5 pt-4"
      data-testid="council-queue-preview"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StateChip state={subject.state} />
        <Tag>{subject.projectName}</Tag>
        <Tag>{kindWord(subject, b)}</Tag>
        <Tag>{tx(b.stars_chip, { count: subject.registrySubjects.length })}</Tag>
      </div>

      <h3 className="m-0 text-[26px] font-bold leading-tight tracking-tight text-foreground">{subject.title}</h3>

      <div className="self-center py-0.5">
        <Rose
          seats={seats}
          threshold={rubric.threshold}
          overall={subject.overall}
          size={190}
          label={tbl.rose_label}
          notMeasuredLabel={tbl.not_measured}
          noOverallLabel={tbl.rose_no_overall}
          overallLabel={tbl.rose_overall}
        />
      </div>

      <p className="m-0 max-w-[60ch] typo-body-lg text-foreground">
        {gate.open ? tx(tbl[why.key], why.values) : tx(t.council.gate[gate.key], gate.values)}
      </p>

      <Button variant="primary" size="md" onClick={() => onOpen(subject)} data-testid="council-open-table">
        {b.open_table}
      </Button>
    </div>
  );
}

export default QueuePreview;
