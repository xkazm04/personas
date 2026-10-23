import type { Release } from '@/lib/lensScan/wire';
import { useSheet } from '../../controller/SheetContext';
import { FAILED_STEP, STEPS, stepOf } from '../../model/ledgerRelease';
import { releaseWord } from '../words';

/**
 * The Release tab's stepper (bp Stepper): draft -> building -> pr-open -> merged -> tagged from the release row, the
 * current step marked, a failed release at its build step. Before any release: the draft step, empty. Personas reads
 * no release job, so bp's job line and its running ring are not drawn (bp shows them live).
 */
export function Stepper({ rel }: { rel: Release | undefined }) {
  const { B } = useSheet().text;
  const st = rel ? stepOf(rel.status) : 0, failed = st < 0, at = failed ? FAILED_STEP : st;
  const cls = (i: number) => {
    if (!rel) return i === 0 ? 'now' : '';
    if (i < at || (i === at && rel.status === 'tagged')) return 'done';
    if (i > at) return '';
    return failed ? 'bad' : 'now';
  };
  return (
    <ol className="tr-rel-steps" aria-label={B.lg_rel_steps} data-testid="blueprint-ledger-steps">
      {STEPS.map((s, i) => (
        <li key={s} className={cls(i)} aria-current={i === at ? 'step' : undefined}>
          {i + 1} · {releaseWord(B, s)}<b>{failed && i === at ? B.lg_rel_failed : B[`lg_step_${s === 'pr-open' ? 'pr_open' : s}` as const]}</b>
        </li>
      ))}
    </ol>
  );
}
