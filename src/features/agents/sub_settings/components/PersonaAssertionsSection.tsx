import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Plus, Trash2, X } from 'lucide-react';
import {
  listOutputAssertions,
  createOutputAssertion,
  deleteOutputAssertion,
} from '@/api/agents/outputAssertions';
import type { OutputAssertion } from '@/lib/bindings/OutputAssertion';
import { Button } from '@/features/shared/components/buttons';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Quality gates — declarative output assertions attached to a persona and
 * evaluated on every run. The backend (`create_output_assertion` +
 * `engine::output_assertions`) supported this end to end, but no UI ever called
 * `outputAssertions.ts` (UAT 2026-07-20, FA-RRE-03: the only configurable
 * quality gate was unreachable). This surfaces the two highest-value types
 * ("must contain" / "must not contain") with an on-failure action; richer types
 * (regex / jsonpath / length) can extend the type Listbox later.
 */
export function PersonaAssertionsSection({ personaId }: { personaId: string }) {
  const { t } = useTranslation();
  const a = t.agents.assertions;
  const [assertions, setAssertions] = useState<OutputAssertion[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [assertionType, setAssertionType] = useState<'contains' | 'not_contains'>('contains');
  const [phrase, setPhrase] = useState('');
  const [onFailure, setOnFailure] = useState<'log' | 'review' | 'heal'>('review');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setAssertions(await listOutputAssertions(personaId));
    } catch (err) {
      toastCatch('assertions:list')(err);
    }
  }, [personaId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reset = () => {
    setAdding(false);
    setName('');
    setPhrase('');
    setAssertionType('contains');
    setOnFailure('review');
  };

  const handleCreate = async () => {
    const phrases = phrase.split(',').map((p) => p.trim()).filter(Boolean);
    if (!name.trim() || phrases.length === 0) return;
    setSaving(true);
    try {
      await createOutputAssertion({
        personaId,
        name: name.trim(),
        assertionType,
        config: JSON.stringify({ phrases, case_sensitive: false }),
        severity: 'warning',
        onFailure,
      });
      reset();
      await refresh();
    } catch (err) {
      toastCatch('assertions:create')(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteOutputAssertion(id);
      await refresh();
    } catch (err) {
      toastCatch('assertions:delete')(err);
    }
  };

  const typeLabel = (ty: string) => (ty === 'not_contains' ? a.type_not_contains : a.type_contains);
  const actionLabel = (ac: string) =>
    ac === 'heal' ? a.action_heal : ac === 'log' ? a.action_log : a.action_review;

  return (
    <div className="space-y-3 relative z-10">
      <h4 className="flex items-center gap-2.5 typo-submodule-header tracking-wide">
        <ShieldCheck className="w-4 h-4 text-primary/70" />
        {a.title}
      </h4>
      <div className="bg-secondary/40 border border-primary/20 rounded-modal p-3 space-y-2.5">
        <p className="typo-caption text-foreground">{a.subtitle}</p>

        {assertions.length === 0 && !adding && (
          <p className="typo-body text-foreground py-1">{a.empty}</p>
        )}

        {assertions.map((row) => (
          <div key={row.id} className="flex items-center gap-2 rounded-card border border-primary/10 bg-background/30 px-2.5 py-1.5">
            <span className="typo-body font-medium text-foreground truncate flex-1">{row.name}</span>
            <span className="typo-caption text-foreground">{typeLabel(row.assertionType)}</span>
            <span className="typo-caption text-primary">{actionLabel(row.onFailure)}</span>
            <button
              type="button"
              onClick={() => handleDelete(row.id)}
              aria-label={a.delete}
              className="p-1 rounded-input text-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}

        {adding ? (
          <div className="space-y-2 rounded-card border border-primary/15 bg-background/30 p-2.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={a.name_placeholder}
              className="w-full px-2 py-1 bg-background/50 border border-primary/15 rounded-card typo-body text-foreground placeholder:text-foreground focus-ring"
            />
            <div className="flex flex-wrap items-center gap-2">
              <ThemedSelect
                value={assertionType}
                onChange={(e) => setAssertionType(e.target.value as 'contains' | 'not_contains')}
                wrapperClassName="min-w-[9rem]"
                aria-label={a.type_label}
              >
                <option value="contains">{a.type_contains}</option>
                <option value="not_contains">{a.type_not_contains}</option>
              </ThemedSelect>
              <ThemedSelect
                value={onFailure}
                onChange={(e) => setOnFailure(e.target.value as 'log' | 'review' | 'heal')}
                wrapperClassName="min-w-[9rem]"
                aria-label={a.on_failure_label}
              >
                <option value="review">{a.action_review}</option>
                <option value="log">{a.action_log}</option>
                <option value="heal">{a.action_heal}</option>
              </ThemedSelect>
            </div>
            <input
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder={a.phrase_placeholder}
              className="w-full px-2 py-1 bg-background/50 border border-primary/15 rounded-card typo-body text-foreground placeholder:text-foreground focus-ring"
            />
            <div className="flex items-center gap-2">
              <Button variant="primary" size="sm" onClick={handleCreate} disabled={saving || !name.trim() || !phrase.trim()}>
                {a.create}
              </Button>
              <Button variant="ghost" size="sm" icon={<X className="w-3.5 h-3.5" />} onClick={reset}>
                {a.cancel}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setAdding(true)}>
            {a.add}
          </Button>
        )}
      </div>
    </div>
  );
}
