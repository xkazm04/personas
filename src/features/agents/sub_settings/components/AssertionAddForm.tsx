import { useState } from 'react';
import { X } from 'lucide-react';
import { createOutputAssertion } from '@/api/agents/outputAssertions';
import type { AssertionFailureAction } from '@/lib/bindings/AssertionFailureAction';
import { Button } from '@/features/shared/components/buttons';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import { assertionConfigJson, parsePhrases, type SettingsAssertionType } from './assertionConfig';

/**
 * The add-gate form of {@link PersonaAssertionsSection}. It owns the draft
 * (name / type / phrases / on-failure) so closing the form discards it by
 * unmounting; the section decides when it is mounted.
 */
export function AssertionAddForm({
  personaId,
  onCreated,
  onClose,
}: {
  personaId: string;
  onCreated: () => void | Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const a = t.agents.assertions;
  const [name, setName] = useState('');
  const [assertionType, setAssertionType] = useState<SettingsAssertionType>('contains');
  const [phrase, setPhrase] = useState('');
  const [onFailure, setOnFailure] = useState<AssertionFailureAction>('review');
  const [saving, setSaving] = useState(false);

  // One predicate for "is there a phrase", shared by the button and the handler:
  // a comma-only field parses to nothing and must not enable a dead Create.
  const phrases = parsePhrases(phrase);
  const canCreate = name.trim() !== '' && phrases.length > 0;

  const handleCreate = async () => {
    if (!canCreate) return;
    setSaving(true);
    try {
      await createOutputAssertion({
        personaId,
        name: name.trim(),
        assertionType,
        // The engine reads `patterns` for not_contains, `phrases` for contains.
        config: assertionConfigJson(assertionType, phrases),
        severity: 'warning',
        onFailure,
      });
      onClose();
      await onCreated();
    } catch (err) {
      toastCatch('assertions:create')(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-card border border-primary/15 bg-background/30 p-2.5">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={a.name_placeholder}
        aria-label={a.name_placeholder}
        className="w-full px-2 py-1 bg-background/50 border border-primary/15 rounded-card typo-body text-foreground placeholder:text-foreground focus-ring"
      />
      <div className="flex flex-wrap items-center gap-2">
        <ThemedSelect
          value={assertionType}
          onChange={(e) => setAssertionType(e.target.value as SettingsAssertionType)}
          wrapperClassName="min-w-[9rem]"
          aria-label={a.type_label}
        >
          <option value="contains">{a.type_contains}</option>
          <option value="not_contains">{a.type_not_contains}</option>
        </ThemedSelect>
        <ThemedSelect
          value={onFailure}
          onChange={(e) => setOnFailure(e.target.value as AssertionFailureAction)}
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
        aria-label={a.phrase_placeholder}
        className="w-full px-2 py-1 bg-background/50 border border-primary/15 rounded-card typo-body text-foreground placeholder:text-foreground focus-ring"
      />
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={handleCreate} disabled={saving || !canCreate}>
          {a.create}
        </Button>
        <Button variant="ghost" size="sm" icon={<X className="w-3.5 h-3.5" />} onClick={onClose}>
          {a.cancel}
        </Button>
      </div>
    </div>
  );
}
