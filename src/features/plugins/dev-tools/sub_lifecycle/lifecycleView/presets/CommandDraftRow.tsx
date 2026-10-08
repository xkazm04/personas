// One editable command in the commands editor: the command line, its kind
// (only the kinds this step measures, from the snapshot's rules) and an
// optional time budget in seconds (empty = the kind's default), with a remove
// control.
import { Trash2 } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { FormField } from '@/features/shared/components/forms/FormField';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { inputFieldClass } from '@/lib/utils/designTokens';
import { formatNumeric } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../context';
import { lcSurface } from '../system/lcSurface';
import { defaultBudgetMs } from '../system/rules';
import { GLYPH } from '../system/scales';
import { useSnapshotRules } from '../system/useSnapshotRules';
import { draftProblem, type CommandsEditorState, type DraftCommand } from './useCommandsEditor';
import { useKindLabel } from './useKindLabel';

export function CommandDraftRow({ editor, row, index }: { editor: CommandsEditorState; row: DraftCommand; index: number }) {
  const { dl, tx } = useLifecycleViewModel();
  const rules = useSnapshotRules();
  const kind = useKindLabel();
  const problem = editor.showProblems ? draftProblem(row) : null;
  const fallback = defaultBudgetMs(rules, row.kind);
  return (
    <li
      className={`grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_11rem_9rem_auto] ${lcSurface('card')}`}
      data-testid={`lc2-draft-${index}`}
    >
      <FormField label={dl.lc2_field_command} error={problem === 'command' ? dl.lc2_field_command_required : undefined} forceValidation>
        {(p) => (
          <input
            {...p}
            autoFocus={!row.command && index === editor.draft.length - 1}
            value={row.command}
            onChange={(e) => editor.update(row.key, { command: e.target.value })}
            placeholder={dl.lc2_field_command_placeholder}
            className={`${inputFieldClass(problem === 'command')} font-mono`}
            data-testid={`lc2-draft-command-${index}`}
          />
        )}
      </FormField>
      <FormField label={dl.lc2_field_kind}>
        {(p) => (
          <ThemedSelect
            id={p.id}
            filterable
            hideSearch
            options={editor.kinds.map((k) => ({ value: k, label: kind(k) }))}
            value={row.kind}
            onValueChange={(v) => editor.update(row.key, { kind: v as DraftCommand['kind'] })}
            aria-label={dl.lc2_field_kind}
          />
        )}
      </FormField>
      <FormField label={dl.lc2_field_budget} error={problem === 'budget' ? dl.lc2_field_budget_invalid : undefined} forceValidation>
        {(p) => (
          <input
            {...p}
            inputMode="decimal"
            value={row.budgetSec}
            onChange={(e) => editor.update(row.key, { budgetSec: e.target.value })}
            placeholder={fallback != null ? tx(dl.lc2_field_budget_default, { budget: formatNumeric(fallback, 'ms') }) : undefined}
            className={inputFieldClass(problem === 'budget')}
            data-testid={`lc2-draft-budget-${index}`}
          />
        )}
      </FormField>
      <Button
        variant="ghost"
        size="icon-md"
        className="md:mt-7"
        aria-label={dl.lc2_remove_command}
        onClick={() => editor.remove(row.key)}
        data-testid={`lc2-draft-remove-${index}`}
      >
        <Trash2 className={GLYPH.sm} />
      </Button>
    </li>
  );
}
