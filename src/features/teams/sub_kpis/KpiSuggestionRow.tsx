// One simulation suggestion as a ledger line: what, a two-line why, and the
// two decisions.
//
// Extracted from `KpiSimSuggestions` 2026-10-06, and the rationale changed from
// a full dump to a teaser. A rationale is model-authored markdown - routinely
// several hundred characters with headings and bullets - and printing it raw
// into the row buried the decisions under it and showed markdown source instead
// of markdown. The whole text lives in `KpiSuggestionDetail` now; the row is
// the door.
import { Archive, Check, ChevronRight, Cog, Target, X } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { Translations } from '@/i18n/useTranslation';
import { useTranslation } from '@/i18n/useTranslation';

import type { ActionKind, Suggestion } from './kpiSimModel';

export const KIND_ICON: Record<ActionKind, typeof Cog> = {
  adopt_measure_config: Cog,
  adjust_target: Target,
  retire: Archive,
};

/**
 * The row's headline and the machine detail beside it. Exported because the
 * detail modal titles itself with exactly this - a modal whose title differs
 * from the row you clicked is a modal you have to re-orient inside.
 */
export function suggestionHeadline(
  s: Suggestion,
  kpiName: string,
  unit: string,
  t: Translations,
  tx: (template: string, vars: Record<string, string | number>) => string,
): { label: string; detail: string } {
  if (s.kind === 'adopt_measure_config') {
    const cmd = typeof s.payload.cmd === 'string' ? s.payload.cmd : '';
    return { label: tx(t.kpis.suggest_adopt, { name: kpiName }), detail: cmd };
  }
  if (s.kind === 'adjust_target') {
    const tv = typeof s.payload.target_value === 'number' ? s.payload.target_value : null;
    return {
      label: tx(t.kpis.suggest_adjust, { name: kpiName }),
      detail: tv != null ? `→ ${tv} ${unit}` : '',
    };
  }
  return { label: tx(t.kpis.suggest_retire, { name: kpiName }), detail: '' };
}

export function SuggestionRow({ s, kpiName, unit, busy, onApply, onDismiss, onOpen }: {
  s: Suggestion;
  kpiName: string;
  unit: string;
  busy: boolean;
  onApply: () => void;
  onDismiss: () => void;
  onOpen: () => void;
}) {
  const { t, tx } = useTranslation();
  const Icon = KIND_ICON[s.kind];
  const headline = suggestionHeadline(s, kpiName, unit, t, tx);

  return (
    <li className="flex items-start gap-3 py-2.5">
      <Icon className="w-3.5 h-3.5 mt-1 text-primary shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="typo-data">{headline.label}</span>
          {headline.detail && <span className="typo-code truncate">{headline.detail}</span>}
          {s.citations.length > 0 && (
            <span className="typo-caption text-primary">
              {tx(t.kpis.suggest_sources, { count: s.citations.length })}
            </span>
          )}
        </div>
        {s.rationale && (
          // Two lines, then the modal. The accessible name is the headline, so
          // the door says which suggestion it opens rather than "read more".
          <Button
            variant="link"
            size="xs"
            onClick={onOpen}
            aria-label={headline.label}
            className="mt-0.5 block w-full text-left"
          >
            <span className="flex items-start gap-1">
              <span className="typo-caption line-clamp-2 min-w-0 flex-1">{s.rationale}</span>
              <ChevronRight className="w-3 h-3 mt-0.5 shrink-0" aria-hidden />
            </span>
          </Button>
        )}
      </div>
      <div className="flex w-[7.5rem] shrink-0 items-center justify-end gap-1">
        <Button
          variant="accent"
          tone="agent"
          size="xs"
          icon={<Check className="w-3 h-3" />}
          disabled={busy}
          onClick={onApply}
          data-testid={`kpi-suggest-apply-${s.kind}`}
        >
          {t.kpis.suggest_apply}
        </Button>
        <Tooltip content={t.kpis.suggest_dismiss}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t.kpis.suggest_dismiss}
            disabled={busy}
            onClick={onDismiss}
            icon={<X className="w-3.5 h-3.5" />}
          />
        </Tooltip>
      </div>
    </li>
  );
}
