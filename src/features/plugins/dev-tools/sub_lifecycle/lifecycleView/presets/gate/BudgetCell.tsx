/**
 * A gate row's time cell: the shown run's time (warning ink and a "+14s" when
 * it is over budget, N/A when the run has no honest time) over its budget in
 * words. The budget words are a press target: they open an in-place field
 * (seconds; Enter saves, Esc cancels, empty uses the kind's default), so a
 * budget is changed where it is read. The commands editor stays for full edits.
 */
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Check, Pencil, X } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { formatNumeric } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../../context';
import { lcShape } from '../../system/lcSurface';
import { LT } from '../../system/lcType';
import { GLYPH } from '../../system/scales';
import type { InstrumentRow } from './gateView';
import type { BudgetEditState } from './useBudgetEdit';

function BudgetField({ row, edit }: { row: InstrumentRow; edit: BudgetEditState }) {
  const { dl, tx } = useLifecycleViewModel();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void edit.save(row.commandId, row.command);
    } else if (e.key === 'Escape') {
      // Esc is the field's: it must not also return to now or leave the step.
      e.preventDefault();
      e.stopPropagation();
      edit.cancel();
    }
  };
  return (
    <span className="flex items-center gap-1" data-testid={`lc6-budget-field-${row.commandId}`}>
      <input
        ref={input}
        inputMode="decimal"
        value={edit.text}
        onChange={(e) => edit.type(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label={tx(dl.lcx6_budget_field, { command: row.command })}
        aria-invalid={edit.invalid || undefined}
        aria-describedby={`lc6-budget-hint-${row.commandId}`}
        placeholder={row.budgetMs != null && !row.budgetOverridden ? String(row.budgetMs / 1000) : undefined}
        className={`w-16 border bg-background px-2 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${lcShape('chip')} ${LT.rowNum} ${edit.invalid ? 'border-status-error' : 'border-primary/30'}`}
        data-testid={`lc6-budget-input-${row.commandId}`}
      />
      <span className={LT.meta} aria-hidden>{dl.lcx6_seconds_unit}</span>
      <Button variant="ghost" size="icon-sm" loading={edit.saving} aria-label={dl.lcx6_budget_save} onClick={() => void edit.save(row.commandId, row.command)} data-testid={`lc6-budget-save-${row.commandId}`}>
        <Check className={GLYPH.sm} />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={dl.lcx6_budget_cancel} onClick={edit.cancel} disabled={edit.saving}>
        <X className={GLYPH.sm} />
      </Button>
      <span id={`lc6-budget-hint-${row.commandId}`} className="sr-only">{edit.invalid ? dl.lcx6_budget_invalid : dl.lcx6_budget_hint}</span>
    </span>
  );
}

export function BudgetCell({ row, edit }: { row: InstrumentRow; edit: BudgetEditState }) {
  const { dl, tx } = useLifecycleViewModel();
  const run = row.shown;
  const answered = !!run && (run.outcome === 'passed' || run.outcome === 'failed');
  const overMs = answered && row.budgetMs != null ? run.durationMs - row.budgetMs : 0;
  const budget = row.budgetMs == null
    ? dl.lcx6_budget_none
    : tx(row.budgetOverridden ? dl.lcx6_budget_of : dl.lcx6_budget_of_default, { budget: formatNumeric(row.budgetMs, 'ms') });
  return (
    <span className="flex min-w-0 flex-col items-start gap-0.5" data-over={overMs > 0 || undefined}>
      <span className="flex items-baseline gap-1.5 whitespace-nowrap">
        {answered
          ? <Numeric value={run.durationMs} unit="ms" className={`${LT.rowNum} ${overMs > 0 ? 'text-status-warning' : ''}`} />
          : run?.outcome === 'timeout'
            // Not a speed: the kill time, said as one.
            ? <span className={`${LT.rowNum} text-status-warning`} data-time="timeout">{tx(dl.lcx6_time_killed, { time: formatNumeric(run.durationMs, 'ms') })}</span>
            : <span className={LT.rowNum} data-time="none">{dl.lc1_na}</span>}
        {overMs > 0 && <span className={`${LT.delta} text-status-warning`}>{tx(dl.lcx6_over_by, { time: formatNumeric(overMs, 'ms') })}</span>}
      </span>
      {edit.editing === row.commandId ? <BudgetField row={row} edit={edit} /> : edit.editable(row.commandId) ? (
        <Button
          variant="link"
          size="xs"
          onClick={() => edit.open(row.commandId, row.budgetOverridden ? row.budgetMs : null)}
          aria-label={`${budget}. ${tx(dl.lcx6_budget_edit, { command: row.command })}`}
          icon={<Pencil className={GLYPH.sm} aria-hidden />}
          data-testid={`lc6-budget-${row.commandId}`}
        >
          <span className={`${LT.meta} truncate`}>{budget}</span>
        </Button>
      ) : <span className={LT.meta}>{budget}</span>}
    </span>
  );
}
