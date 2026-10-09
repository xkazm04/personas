// The Overseer is switched off: a small warning chip on the header's note line
// (never in the controls' row, so its arrival moves no control), what that
// means in one quiet line, and the way to his setup. Shown whatever the watch:
// with him off, a watch auto-measures nothing and a send's items wait.
import { ArrowUpRight, TriangleAlert } from 'lucide-react';

import { navigateToCompanions } from '@/features/companions/navigation';
import { Button } from '@/features/shared/components/buttons';

import { useLifecycleViewModel } from '../context';
import { LT } from '../system/lcType';
import { Pill } from '../system/Pill';
import { GLYPH } from '../system/scales';

const OFF_LOOK = { tone: 'warning', stroke: 'hairline', glyph: TriangleAlert } as const;

export function OverseerOffChip({ className = '' }: { className?: string }) {
  const { dl } = useLifecycleViewModel();
  return (
    <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${className}`} data-testid="lc-overseer-off-hint">
      <Pill look={OFF_LOOK} label={dl.lcx9_off_chip} testId="lc9-overseer-off-chip" />
      <span className={LT.meta}>{dl.lcx9_off_detail}</span>
      <Button
        variant="link"
        size="xs"
        iconRight={<ArrowUpRight className={GLYPH.sm} />}
        onClick={() => navigateToCompanions('overseer:setup')}
        data-testid="lc9-overseer-setup"
      >
        {dl.lcx9_off_setup}
      </Button>
    </p>
  );
}
