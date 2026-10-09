/**
 * "What changed", in one sentence built from data: the move between the
 * picked Measure (the newest one for now) and the one before it - verdicts
 * that changed, then coverage, pass rates and times that moved - each part in
 * the ink of whether it was good or bad (and in words, so it reads without
 * colour). The moves come from the rail's own delta helper through
 * `historyModel.whatChanged`, and the signed figures from the rail's own
 * formatter (`DeltaMark.signedChange`), so this line and the cards agree.
 *
 * The parts are joined by the locale's own list format. One line; it clips
 * rather than wraps, so the figure under it never moves.
 */
import { Fragment, type ReactNode } from 'react';
import { GitCompareArrows } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { formatDuration } from '@/lib/utils/formatters';

import { stepLabel } from '../../journey/journeyLabels';
import { useLifecycleViewModel } from '../context';
import { healthLabel } from '../layer1/layer1Labels';
import { signedChange } from '../layer1/rail/DeltaMark';
import { LT } from '../system/lcType';
import { GLYPH } from '../system/scales';
import type { ChangeFragment } from './historyModel';

const INK = { good: 'text-status-success', bad: 'text-status-error', neutral: '' } as const;

function useFragmentText(): (f: ChangeFragment) => string {
  const { dl, tx } = useLifecycleViewModel();
  const { language } = useTranslation();
  return (f) => {
    const step = stepLabel(dl, f.stepId, null);
    if (f.kind === 'verdict') return tx(dl.lcx3_changed_verdict, { step, from: healthLabel(dl, f.from), to: healthLabel(dl, f.to) });
    if (f.kind === 'time') {
      return tx(f.delta.change < 0 ? dl.lcx3_changed_faster : dl.lcx3_changed_slower, { step, time: formatDuration(Math.abs(f.delta.change)) });
    }
    const change = signedChange(f.delta, language);
    return f.kind === 'coverage' ? tx(dl.lcx3_changed_coverage, { change }) : tx(dl.lcx3_changed_pass, { step, change });
  };
}

/** The parts joined by the locale's list format, each part a node. */
function joinParts(language: string, nodes: ReactNode[]): ReactNode {
  const marks = nodes.map((_, i) => `${i}`);
  const parts = new Intl.ListFormat(language, { style: 'long', type: 'unit' }).formatToParts(marks);
  return parts.map((p, i) => {
    const m = /^(\d+)$/.exec(p.value);
    return <Fragment key={i}>{m ? nodes[Number(m[1])] : p.value}</Fragment>;
  });
}

/** `fragments` null: there is no earlier Measure to compare with. */
export function WhatChanged({ fragments, viewing }: { fragments: ChangeFragment[] | null; viewing: boolean }) {
  const { dl } = useLifecycleViewModel();
  const { language } = useTranslation();
  const text = useFragmentText();
  let body: ReactNode;
  if (fragments === null) body = dl.lcx3_changed_oldest;
  else if (fragments.length === 0) body = viewing ? dl.lcx3_changed_none_viewed : dl.lcx3_changed_none;
  else {
    const nodes = fragments.map((f) => (
      <span key={`${f.kind}-${f.stepId}`} className={INK[f.tone]} data-change={f.kind} data-tone={f.tone}>{text(f)}</span>
    ));
    body = <>{viewing ? dl.lcx3_changed_lead_viewed : dl.lcx3_changed_lead}{' '}{joinParts(language, nodes)}</>;
  }
  return (
    <p className={`flex h-7 min-w-0 items-center gap-2 ${LT.row}`} data-testid="lc-history-changed" aria-live="polite">
      <GitCompareArrows className={`${GLYPH.sm} shrink-0 text-primary`} aria-hidden />
      <span className="min-w-0 truncate">{body}</span>
    </p>
  );
}
