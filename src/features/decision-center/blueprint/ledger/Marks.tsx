// The ledger's small marks (PORTED from bp src/components/ledger/train/ui/Marks.tsx): a status, a verdict, a metric's
// before -> after, a lens tag and the sample tag. One component per visual thing; every surface of the ledger (and the
// compare panel) renders these. Shape first, colour second (never colour alone); the words are the sheet's language.
import { memo } from 'react';
import type { Verdict } from '@/lib/lensScan/compare';
import type { ProposalStatus } from '@/lib/lensScan/wire';
import { useSheet } from '../controller/SheetContext';
import type { BpText } from '../controller/useBlueprintText';
import { STATE_MARK, VERDICT_MARK } from '../model/ledgerRules';
import { fmtNum } from '../ui/format';
import { LensGlyphIcon } from '../ui/LensGlyphIcon';

export const stateWord = (B: BpText, s: ProposalStatus): string => B[`lg_st_${s}` as const];
export const stateHint = (B: BpText, s: ProposalStatus): string => B[`lg_sth_${s}` as const];
export const verdictWord = (B: BpText, v: Verdict): string => B[`lg_vd_${v}` as const];

/** `tag` the boxed mark and word (a row), `box` the mark alone in a square (a pack's progress), `glyph` the bare mark. */
export type StateForm = 'tag' | 'box' | 'glyph';

/** A status as its mark and word. `flagged`: accepted although it failed or did not move; `pending`: a decision on it is
 *  on its way to the store (a dashed border, no spinner: the pressed control carries the busy state). */
export const StateMark = memo(function StateMark({ status, flagged = false, pending = false, form = 'tag' }: { status: ProposalStatus; flagged?: boolean; pending?: boolean; form?: StateForm }) {
  const { B } = useSheet().text;
  if (form !== 'tag') return <i className={(form === 'box' ? 'tr-stb' : 'tr-stg') + ' s-' + status} aria-hidden="true">{STATE_MARK[status]}</i>;
  return (
    <span className={'tr-st s-' + status + (pending ? ' pending' : '')} data-status={status}>
      <b aria-hidden="true">{STATE_MARK[status]}</b>{stateWord(B, status)}
      {flagged ? <><i aria-hidden="true"> ⚑</i><span className="sr-only">{B.lg_flagged}</span></> : null}
    </span>
  );
});

/** A verdict as its mark and word. `failed`: the build failed, which outranks what its metric did. */
export const VerdictChip = memo(function VerdictChip({ verdict, failed = false }: { verdict: Verdict; failed?: boolean }) {
  const { B } = useSheet().text;
  return (
    <span className={'tr-vd v-' + (failed ? 'failed' : verdict)} data-verdict={verdict} data-testid="blueprint-verdict">
      <b aria-hidden="true">{failed ? '✕' : VERDICT_MARK[verdict]}</b>{failed ? B.lg_build_failed : verdictWord(B, verdict)}
    </span>
  );
});

/** `before → after unit`, with the metric key under it. A missing side reads "–". */
export const MetricMove = memo(function MetricMove({ before, after, unit, metric, cell = false }: { before?: number; after?: number; unit?: string; metric?: string; cell?: boolean }) {
  const { language } = useSheet().text;
  const side = (n: number | undefined) => (n === undefined ? '–' : fmtNum(language, n));
  return (
    <span className={cell ? 'c-mv tr-mv' : 'tr-mv'} role={cell ? 'cell' : undefined}>
      {side(before)} → {side(after)}{unit ? ' ' + unit : ''}
      {metric ? <small>{metric}</small> : null}
    </span>
  );
});

/** A lens as its glyph and short name (the full name with `full`); lenses differ by glyph, never by colour alone. */
export const LensTag = memo(function LensTag({ id, full = false }: { id: string; full?: boolean }) {
  const { plan } = useSheet();
  const d = plan.LENS[id], short = d?.short ?? id.replace(/^.*\./, '').slice(0, 4).toUpperCase();
  return <span className="tr-lens"><LensGlyphIcon glyph={d?.glyph ?? null} />{full ? d?.name ?? id : short}</span>;
});
