/**
 * "Commands": what Measure runs for this step. At rest it lists the pinned
 * commands (or says they are auto-detected from the repo's manifests); Edit
 * opens a draft with add / edit / remove and a time budget per command, and
 * Save appends a new practice version. The outcome is said in a line under
 * the editor, never a toast.
 */
import { Pencil, Plus, RotateCcw } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Section } from '@/features/shared/components/kit';
import type { LifecycleGateCommand } from '@/lib/bindings/LifecycleGateCommand';
import { formatNumeric } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../context';
import { CommandDraftRow } from './CommandDraftRow';
import { DEFAULT_BUDGET_MS } from './healthRules';
import type { CommandsEditorState } from './useCommandsEditor';
import { useKindLabel } from './useKindLabel';

function PinnedList({ commands }: { commands: LifecycleGateCommand[] }) {
  const { dl, tx } = useLifecycleViewModel();
  const kind = useKindLabel();
  return (
    <ul className="space-y-1.5" data-testid="lc2-commands-pinned">
      {commands.map((c) => (
        <li key={c.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-card border border-primary/10 bg-background/60 px-4 py-2">
          <span className="typo-code text-foreground">{c.command}</span>
          <span className="typo-body text-foreground">{kind(c.kind)}</span>
          <span className="typo-caption">
            {c.budgetMs != null
              ? tx(dl.lc2_budget_own, { budget: formatNumeric(c.budgetMs, 'ms') })
              : tx(dl.lc2_budget_default, { budget: formatNumeric(DEFAULT_BUDGET_MS[c.kind], 'ms') })}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CommandsEditor({ editor, commands }: { editor: CommandsEditorState; commands: LifecycleGateCommand[] | null }) {
  const { dl } = useLifecycleViewModel();
  const actions = editor.editing ? undefined : (
    <Button variant="secondary" size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => editor.open()} data-testid="lc2-commands-edit">
      {dl.lc2_commands_edit}
    </Button>
  );
  return (
    <div ref={editor.rootRef} className="scroll-mt-6" data-testid="lc2-commands">
      <Section title={dl.lc2_commands_title} level={2} actions={actions} desc={commands ? undefined : dl.lc2_commands_auto}>
        {!editor.editing && commands && commands.length > 0 && <PinnedList commands={commands} />}
        {!editor.editing && commands && commands.length === 0 && <p className="typo-body text-foreground">{dl.lc2_commands_none}</p>}
        {editor.editing && (
          <div className="space-y-3">
            <ul className="space-y-2">
              {editor.draft.map((row, i) => <CommandDraftRow key={row.key} editor={editor} row={row} index={i} />)}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={editor.add} data-testid="lc2-commands-add">
                {dl.lc2_commands_add}
              </Button>
              <span className="flex-1" />
              {commands && (
                <Button variant="ghost" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => void editor.resetToAuto()} disabled={editor.saving}>
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
        <p role="status" className={`typo-body empty:hidden ${editor.result?.tone === 'error' ? 'text-status-error' : 'text-status-success'} ${editor.result ? 'mt-3' : ''}`} data-testid="lc2-commands-result">
          {editor.result?.text ?? ''}
        </p>
      </Section>
    </div>
  );
}
