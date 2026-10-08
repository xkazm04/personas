/**
 * "Commands": what Measure runs for this step. At rest it lists the pinned
 * commands (or says they are auto-detected from the repo's manifests); Edit
 * opens a draft with add / edit / remove and a time budget per command, and
 * Save appends a new practice version. The outcome is said in a line under
 * the editor, never a toast. A default budget shown here is the snapshot's
 * rule for the command's kind.
 */
import { Pencil, Plus, RotateCcw } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Section } from '@/features/shared/components/kit';
import type { LifecycleGateCommand } from '@/lib/bindings/LifecycleGateCommand';
import { formatNumeric } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../context';
import { RHYTHM, lcSurface } from '../system/lcSurface';
import { LT } from '../system/lcType';
import { defaultBudgetMs } from '../system/rules';
import { GLYPH } from '../system/scales';
import { useSnapshotRules } from '../system/useSnapshotRules';
import { CommandDraftRow } from './CommandDraftRow';
import type { CommandsEditorState } from './useCommandsEditor';
import { useKindLabel } from './useKindLabel';

function PinnedList({ commands }: { commands: LifecycleGateCommand[] }) {
  const { dl, tx } = useLifecycleViewModel();
  const rules = useSnapshotRules();
  const kind = useKindLabel();
  const budgetLine = (c: LifecycleGateCommand): string | null => {
    if (c.budgetMs != null) return tx(dl.lc2_budget_own, { budget: formatNumeric(c.budgetMs, 'ms') });
    const fallback = defaultBudgetMs(rules, c.kind);
    return fallback != null ? tx(dl.lc2_budget_default, { budget: formatNumeric(fallback, 'ms') }) : null;
  };
  return (
    <ul className={RHYTHM.tight} data-testid="lc2-commands-pinned">
      {commands.map((c) => (
        <li key={c.id} className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 ${lcSurface('card')}`}>
          <span className={LT.code}>{c.command}</span>
          <span className={LT.row}>{kind(c.kind)}</span>
          <span className={LT.meta}>{budgetLine(c)}</span>
        </li>
      ))}
    </ul>
  );
}

export function CommandsEditor({ editor, commands }: { editor: CommandsEditorState; commands: LifecycleGateCommand[] | null }) {
  const { dl } = useLifecycleViewModel();
  const actions = editor.editing ? undefined : (
    <Button variant="secondary" size="sm" icon={<Pencil className={GLYPH.sm} />} onClick={() => editor.open()} data-testid="lc2-commands-edit">
      {dl.lc2_commands_edit}
    </Button>
  );
  return (
    <div ref={editor.rootRef} className="scroll-mt-6" data-testid="lc2-commands">
      <Section title={dl.lc2_commands_title} level={2} actions={actions} desc={commands ? undefined : dl.lc2_commands_auto}>
        {!editor.editing && commands && commands.length > 0 && <PinnedList commands={commands} />}
        {!editor.editing && commands && commands.length === 0 && <p className={LT.row}>{dl.lc2_commands_none}</p>}
        {editor.editing && (
          <div className={RHYTHM.block}>
            <ul className={RHYTHM.tight}>
              {editor.draft.map((row, i) => <CommandDraftRow key={row.key} editor={editor} row={row} index={i} />)}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" icon={<Plus className={GLYPH.sm} />} onClick={editor.add} data-testid="lc2-commands-add">
                {dl.lc2_commands_add}
              </Button>
              <span className="flex-1" />
              {commands && (
                <Button variant="ghost" size="sm" icon={<RotateCcw className={GLYPH.sm} />} onClick={() => void editor.resetToAuto()} disabled={editor.saving}>
                  {dl.lc2_commands_use_auto}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={editor.cancel} disabled={editor.saving}>{dl.lc2_commands_cancel}</Button>
              <Button variant="primary" size="sm" loading={editor.saving} onClick={() => void editor.save()} data-testid="lc2-commands-save">
                {dl.lc2_commands_save}
              </Button>
            </div>
          </div>
        )}
        {/* Always mounted, so a save's result is announced when its text arrives. */}
        <p
          role="status"
          className={`${LT.row} empty:hidden ${editor.result?.tone === 'error' ? 'text-status-error' : 'text-status-success'} ${editor.result ? 'mt-3' : ''}`}
          data-testid="lc2-commands-result"
        >
          {editor.result?.text ?? ''}
        </p>
      </Section>
    </div>
  );
}
