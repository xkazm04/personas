import { Trash2 } from 'lucide-react';
import type { OutputAssertion } from '@/lib/bindings/OutputAssertion';
import type { AssertionType } from '@/lib/bindings/AssertionType';
import { useTranslation } from '@/i18n/useTranslation';

/** One saved quality gate in the settings list. */
export function AssertionRow({ row, onDelete }: { row: OutputAssertion; onDelete: (id: string) => void }) {
  const { t } = useTranslation();
  const a = t.agents.assertions;
  // Exhaustive over AssertionType: gates are also created outside this form
  // (design promotion), so every stored type must be named truthfully, and tsc
  // flags a seventh.
  const typeLabels: Record<AssertionType, string> = {
    contains: a.type_contains,
    not_contains: a.type_not_contains,
    regex: a.type_regex,
    json_path: a.type_json_path,
    json_schema: a.type_json_schema,
    length: a.type_length,
  };
  const actionLabel = (ac: string) =>
    ac === 'heal' ? a.action_heal : ac === 'log' ? a.action_log : a.action_review;

  return (
    <div className="flex items-center gap-2 rounded-card border border-primary/10 bg-background/30 px-2.5 py-1.5">
      <span className="typo-body text-foreground truncate flex-1">{row.name}</span>
      <span className="typo-caption text-foreground">{typeLabels[row.assertionType] ?? row.assertionType}</span>
      <span className="typo-caption text-primary">{actionLabel(row.onFailure)}</span>
      <button
        type="button"
        onClick={() => onDelete(row.id)}
        aria-label={a.delete}
        className="p-1 rounded-input text-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
