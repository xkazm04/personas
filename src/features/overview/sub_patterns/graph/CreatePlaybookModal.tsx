// Create a playbook from the basket — the F1 curator flow: multi-select
// patterns across cluster modals, then name the situation they serve. Lands
// as `draft`; activation is a separate, deliberate step.
import { useMemo, useState } from 'react';

import Button from '@/features/shared/components/buttons/Button';
import { FormField } from '@/features/shared/components/forms/FormField';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { BaseModal } from '@/lib/ui/BaseModal';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { createPlaybook, setPlaybookPatterns } from '@/api/devTools/workspaces';
import { areaTheme } from '../practiceAreaTheme';
import type { KnowledgeItemView } from '../libraryModel';

type Phase = 'before' | 'during' | 'verify';

export function CreatePlaybookModal({
  workspaceId,
  basket,
  onCreated,
  onClose,
}: {
  workspaceId: string;
  basket: readonly KnowledgeItemView[];
  onCreated: () => void;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const w = t.plugins.dev_tools.workspaces;
  const [title, setTitle] = useState('');
  const [triggersRaw, setTriggersRaw] = useState('');
  const [summary, setSummary] = useState('');
  const [phases, setPhases] = useState<Record<string, Phase>>({});
  const [busy, setBusy] = useState(false);

  const slug = useMemo(
    () => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    [title],
  );
  const triggers = useMemo(
    () => triggersRaw.split(',').map((s) => s.trim()).filter(Boolean),
    [triggersRaw],
  );
  const valid = title.trim().length > 0 && triggers.length > 0 && basket.length > 0;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const pb = await createPlaybook(workspaceId, slug, title, triggers, summary);
      // Ordinals follow the basket's visual order within each phase.
      const counters: Record<Phase, number> = { before: 0, during: 0, verify: 0 };
      await setPlaybookPatterns(
        pb.id,
        basket.map((item) => {
          const phase = phases[item.id] ?? 'during';
          const ordinal = counters[phase];
          counters[phase] += 1;
          return { playbookId: pb.id, practiceId: item.id, phase, ordinal, note: null };
        }),
      );
      onCreated();
      onClose();
    } catch (err) {
      toastCatch('workspaces:createPlaybook')(err);
    } finally {
      setBusy(false);
    }
  };

  const phaseOptions = [
    { value: 'before', label: w.playbook_phase_before },
    { value: 'during', label: w.playbook_phase_during },
    { value: 'verify', label: w.playbook_phase_verify },
  ];

  return (
    <BaseModal isOpen onClose={onClose} titleId="create-playbook" size="lg" staggerChildren={false}>
      <div className="flex flex-col min-h-0 max-h-[78vh]">
        <div className="px-5 pt-4 pb-3 border-b border-border/60">
          <h2 id="create-playbook" className="typo-section-title text-foreground">
            {w.playbook_create_title}
          </h2>
          <p className="typo-caption text-foreground/70 mt-1">{w.playbook_create_hint}</p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 flex flex-col gap-3">
          <FormField label={w.playbook_field_title}>
            {(p) => (
              <input
                {...p}
                className={INPUT_FIELD}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={w.playbook_title_placeholder}
              />
            )}
          </FormField>
          {slug && <p className="typo-caption text-foreground/50 -mt-2 tabular-nums">/{slug}</p>}
          <FormField label={w.playbook_field_triggers} hint={w.playbook_triggers_hint}>
            {(p) => (
              <input
                {...p}
                className={INPUT_FIELD}
                value={triggersRaw}
                onChange={(e) => setTriggersRaw(e.target.value)}
                placeholder={w.playbook_triggers_placeholder}
              />
            )}
          </FormField>
          <FormField label={w.playbook_field_summary}>
            {(p) => (
              <textarea
                {...p}
                className={`${INPUT_FIELD} min-h-[64px] resize-y`}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            )}
          </FormField>

          <div>
            <span className="typo-label text-foreground/80">
              {tx(w.playbook_members_label, { count: basket.length })}
            </span>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {basket.map((item) => (
                <li key={item.id} className="flex items-center gap-2">
                  <span className={`typo-caption px-1.5 py-0.5 rounded-interactive flex-shrink-0 ${areaTheme(item.topic).chip}`}>
                    {item.topic.split('/')[0]}
                  </span>
                  <span className="typo-caption text-foreground/85 truncate flex-1" title={item.title}>
                    {item.title}
                  </span>
                  <div className="w-28 flex-shrink-0">
                    <ThemedSelect
                      value={phases[item.id] ?? 'during'}
                      options={phaseOptions}
                      onValueChange={(v) => setPhases((p) => ({ ...p, [item.id]: v as Phase }))}
                      filterable
                      hideSearch
                      aria-label={w.playbook_field_phase}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border/60">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            {t.common.cancel}
          </Button>
          <Button size="sm" onClick={submit} disabled={!valid || busy}>
            {w.playbook_create_submit}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}
