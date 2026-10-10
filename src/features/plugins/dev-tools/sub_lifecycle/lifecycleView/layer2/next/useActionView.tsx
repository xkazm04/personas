// What one Next action SAYS: its glyph and tone (the glyph carries the kind
// without colour), its sentence and its detail line - a failure's first error,
// the backlog item already filed about a slow command, the docs that need work,
// the reason the step's changes most often skip it. The control beside it is
// `NextCta`; this file only words the action.
import type { ReactNode } from 'react';
import { FileWarning, Gauge, Hourglass, ListChecks, OctagonX, Plus, Timer, type LucideIcon } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { formatNumeric } from '@/lib/utils/formatters';

import { fillTemplate } from '../../frame/fillTemplate';
import { useLifecycleViewModel } from '../../context';
import { LT } from '../../system/lcType';
import type { PillTone } from '../../system/pillLooks';
import { Filed } from './ItemLink';
import type { NextAction } from './nextModel';

export interface ActionView {
  glyph: LucideIcon;
  tone: PillTone;
  title: ReactNode;
  detail: ReactNode | null;
}

/** The first `n` names, then "and N more". */
function listed(names: string[], n: number, more: (count: number) => string): string {
  return names.slice(0, n).join(', ') + (names.length > n ? more(names.length - n) : '');
}

export function useActionView(a: NextAction): ActionView {
  const { dl, tx } = useLifecycleViewModel();
  const { language } = useTranslation();
  const pct = (v: number) => formatNumeric(v, 'percent', { precision: 0, language });
  const code = (text: string) => <span className={LT.code}>{text}</span>;
  switch (a.kind) {
    case 'failing':
      return {
        glyph: OctagonX, tone: 'error',
        title: fillTemplate(dl.lcx5_next_failing, { command: code(a.command) }),
        detail: a.error ? <span className={LT.code}>{a.error}</span> : dl.lcx5_next_failing_no_error,
      };
    case 'over_budget':
      return {
        glyph: Timer, tone: 'warning',
        title: fillTemplate(dl.lcx5_next_over_budget, { command: code(a.command), over: formatNumeric(a.overMs, 'ms') }),
        detail: a.item
          ? <Filed item={a.item} />
          : tx(dl.lcx5_next_budget_is, { budget: formatNumeric(a.budgetMs, 'ms') }),
      };
    case 'add_coverage':
      return { glyph: Plus, tone: 'info', title: dl.lcx5_next_coverage_title, detail: dl.lcx5_next_coverage_detail };
    case 'measure':
      return {
        glyph: Gauge, tone: 'info',
        title: a.why === 'stale' ? dl.lcx5_next_stale : dl.lcx5_next_never,
        detail: a.why === 'stale' ? dl.lcx5_next_stale_detail : dl.lcx5_next_never_detail,
      };
    case 'fix_docs': {
      const docs = [...a.broken, ...a.stale];
      const more = (count: number) => tx(dl.lc2_and_more, { count });
      return {
        glyph: FileWarning, tone: a.broken.length > 0 ? 'error' : 'warning',
        title: tx(a.broken.length === 0 ? dl.lcx5_next_docs_stale : a.stale.length === 0 ? dl.lcx5_next_docs_broken_only : dl.lcx5_next_docs_broken, { broken: a.broken.length, stale: a.stale.length }),
        detail: a.items.length > 0
          ? <Filed item={a.items[0]!} />
          : <span className={LT.code}>{listed(docs, 2, more)}</span>,
      };
    }
    case 'adjust_practice':
      return {
        glyph: ListChecks, tone: 'warning',
        title: tx(dl.lcx5_next_below_target, { done: pct(a.donePct), target: pct(a.targetPct) }),
        detail: a.reason ? tx(a.count === 1 ? dl.lcx5_next_common_reason_one : dl.lcx5_next_common_reason, { reason: a.reason, count: a.count }) : dl.lcx5_next_no_reason,
      };
    case 'more_evidence':
      return {
        glyph: Hourglass, tone: 'neutral',
        title: tx(dl.lcx5_next_more_evidence, { have: a.have, need: a.need }),
        detail: tx(dl.lcx5_next_more_evidence_detail, { count: Math.max(0, a.need - a.have) }),
      };
  }
}
