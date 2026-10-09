/**
 * One command on the first-run checklist, as a one-line kit row: its kind as
 * the module's pill and the command line (the whole line in a tooltip when it
 * is cut; a suggestion carries the open "Suggested" pill after it), its time
 * budget in seconds (empty = the kind's default, said as the placeholder), and
 * the switch that keeps it in or leaves it out. A suggested row can be taken
 * off the list again. Where the commands came from is said once, by the group.
 */
import { Lightbulb, Trash2 } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { ListRow } from '@/features/shared/components/kit';
import { inputFieldClass } from '@/lib/utils/designTokens';
import { formatNumeric } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../../context';
import { KIND_GLYPH } from '../../measure/kindGlyph';
import { draftProblem } from '../../presets/useCommandsEditor';
import { useKindLabel } from '../../presets/useKindLabel';
import { LT } from '../../system/lcType';
import { Pill } from '../../system/Pill';
import type { PillLook } from '../../system/pillLooks';
import { defaultBudgetMs } from '../../system/rules';
import { GLYPH } from '../../system/scales';
import { useSnapshotRules } from '../../system/useSnapshotRules';
import type { SetupRow } from './setupModel';
import type { SetupState } from './useSetup';

/** A suggestion is drawn open (dashed): it is not part of the practice until it is saved. */
export const SUGGESTED_LOOK: PillLook = { tone: 'quiet', stroke: 'dashed', glyph: Lightbulb };

export function SetupRowView({ row, setup, problemId }: { row: SetupRow; setup: SetupState; problemId: string }) {
  const { dl, tx } = useLifecycleViewModel();
  const rules = useSnapshotRules();
  const kind = useKindLabel();
  const fallback = defaultBudgetMs(rules, row.kind);
  const bad = setup.showProblems && row.on && draftProblem(row) === 'budget';
  return (
    <ListRow
      size="s"
      state={row.on ? undefined : 'muted'}
      name={(
        <span className="flex min-w-0 items-center gap-2">
          <Pill look={{ tone: 'quiet', stroke: 'hairline', glyph: KIND_GLYPH[row.kind] }} label={kind(row.kind)} data={{ 'data-kind': row.kind }} />
          <Tooltip content={row.command}>
            <span className={`min-w-0 truncate ${LT.code}`}>{row.command}</span>
          </Tooltip>
          {row.origin === 'template' && <Pill look={SUGGESTED_LOOK} label={dl.lcx10_setup_suggested} />}
        </span>
      )}
      cells={[
        <input
          key="budget"
          inputMode="decimal"
          value={row.budgetSec}
          onChange={(e) => setup.setBudget(row.key, e.target.value)}
          disabled={!row.on}
          placeholder={fallback != null ? tx(dl.lc2_field_budget_default, { budget: formatNumeric(fallback, 'ms') }) : undefined}
          aria-label={tx(dl.lcx6_budget_field, { command: row.command })}
          aria-invalid={bad || undefined}
          aria-describedby={bad ? problemId : undefined}
          className={inputFieldClass(bad)}
          data-testid={`lc10-setup-budget-${row.key}`}
        />,
      ]}
      figures={(
        <span className="flex items-center gap-2">
          {row.origin === 'template' && (
            <Button variant="ghost" size="icon-sm" aria-label={tx(dl.lcx10_setup_remove, { command: row.command })} onClick={() => setup.removeRow(row.key)}>
              <Trash2 className={GLYPH.sm} />
            </Button>
          )}
          <AccessibleToggle
            size="sm"
            checked={row.on}
            onChange={() => setup.toggle(row.key)}
            label={tx(dl.lcx10_setup_run, { command: row.command })}
            data-testid={`lc10-setup-toggle-${row.key}`}
          />
        </span>
      )}
      testId={`lc10-setup-row-${row.origin === 'template' ? `tpl-${row.templateId}` : row.id}`}
    />
  );
}
