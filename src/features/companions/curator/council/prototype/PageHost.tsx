// PROTOTYPE ROUND (spark council-readout). The full-page council: replaces the
// stage while a council is open, in the chosen direction.
//
// The host reads the round chain, parses everything once, and wires the gate.
// The approve/reject gate is the SHIPPED `CouncilGateBay` in every direction:
// a decision binds to the digest of the round on screen, and the browser
// report (hybrid) only ever reads.
import { useMemo, type ComponentType, type ReactNode } from 'react';

import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';

import { CouncilGateBay } from '../gate/CouncilGateBay';
import { resolveRubric, type Rubric } from '../table/rubrics';
import { seatsOf, type Seat } from '../table/runModel';
import { useCouncilRun, type CouncilRunView } from '../table/useCouncilRun';
import {
  parseHardFailures,
  parseMustAddress,
  parseSpannedPaths,
  type HardFailure,
  type MustAddressItem,
} from './protoModel';
import type { PageVariant } from './protoVariant';
import { Dossier } from './page/Dossier';
import { FindingsBoard } from './page/FindingsBoard';
import { HybridCard } from './page/HybridCard';
import { Scoreboard } from './page/Scoreboard';

export interface PageVariantProps {
  subject: CouncilSubjectState;
  /** The round chain: `run.detail` is the round on screen, `run.chain` all rounds oldest first. */
  run: CouncilRunView;
  rubric: Rubric;
  /** Members of the round on screen, rubric order. Empty while loading. */
  seats: Seat[];
  mustAddress: MustAddressItem[];
  hardFailures: HardFailure[];
  spannedPaths: string[];
  /** The shipped approve/reject gate, already wired to the round on screen. Place it; never rebuild it. */
  gate: ReactNode;
  onBack: () => void;
}

const VARIANTS: Record<Exclude<PageVariant, 'current'>, ComponentType<PageVariantProps>> = {
  dossier: Dossier,
  scoreboard: Scoreboard,
  findings: FindingsBoard,
  hybrid: HybridCard,
};

export function PageHost({
  variant,
  subject,
  onBack,
}: {
  variant: Exclude<PageVariant, 'current'>;
  subject: CouncilSubjectState;
  onBack: () => void;
}) {
  const run = useCouncilRun(subject.latestRunId);
  const detail = run.detail;
  const { rubric } = resolveRubric(detail?.run.rubricVersion ?? null, subject.kind);
  const seats = useMemo(
    () => (detail ? seatsOf(detail.run, subject.kind, detail.verdicts) : []),
    [detail, subject.kind],
  );
  const parsed = useMemo(
    () => ({
      mustAddress: detail ? parseMustAddress(detail.run.mustAddressJson) : [],
      hardFailures: detail ? parseHardFailures(detail.run.hardFailuresJson) : [],
      spannedPaths: detail ? parseSpannedPaths(detail.run.spannedPathsJson) : [],
    }),
    [detail],
  );
  const Variant = VARIANTS[variant];
  return (
    <Variant
      subject={subject}
      run={run}
      rubric={rubric}
      seats={seats}
      {...parsed}
      gate={<CouncilGateBay subject={subject} detail={detail} rubric={rubric} onReload={run.reload} />}
      onBack={onBack}
    />
  );
}

export default PageHost;
