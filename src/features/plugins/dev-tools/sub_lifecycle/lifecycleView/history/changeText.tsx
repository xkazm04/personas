// The words of a "what changed" fragment, and the locale's list joining them:
// shared by the history's line (`WhatChanged`) and the Measure panel's summary
// (`measure/MeasureSummary`), so the two say a move the same way. The signed
// figures come from the rail's own formatter (`DeltaMark.signedChange`).
import { Fragment, type ReactNode } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { formatDuration } from '@/lib/utils/formatters';

import { stepLabel } from '../../journey/journeyLabels';
import { useLifecycleViewModel } from '../context';
import { healthLabel } from '../layer1/layer1Labels';
import { signedChange } from '../layer1/rail/DeltaMark';
import type { ChangeFragment } from './historyModel';

/** Ink per fragment tone (and the tone is also said in words, so it reads without colour). */
export const CHANGE_INK = { good: 'text-status-success', bad: 'text-status-error', neutral: '' } as const;

export function useFragmentText(): (f: ChangeFragment) => string {
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
export function joinParts(language: string, nodes: ReactNode[]): ReactNode {
  const marks = nodes.map((_, i) => `${i}`);
  const parts = new Intl.ListFormat(language, { style: 'long', type: 'unit' }).formatToParts(marks);
  return parts.map((p, i) => {
    const m = /^(\d+)$/.exec(p.value);
    return <Fragment key={i}>{m ? nodes[Number(m[1])] : p.value}</Fragment>;
  });
}

/** Every fragment as an inked span, joined: the body of a "what changed" sentence. */
export function ChangeParts({ fragments }: { fragments: ChangeFragment[] }) {
  const { language } = useTranslation();
  const text = useFragmentText();
  const nodes = fragments.map((f) => (
    <span key={`${f.kind}-${f.stepId}`} className={CHANGE_INK[f.tone]} data-change={f.kind} data-tone={f.tone}>{text(f)}</span>
  ));
  return <>{joinParts(language, nodes)}</>;
}
