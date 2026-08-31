import { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import type { PersonaWithDetails } from '@/lib/types/types';
import type { PersonaCore } from '@/lib/bindings/PersonaCore';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { toastCatch } from '@/lib/silentCatch';
import { parseCoreProfile, serializeCoreProfile, emptyCore } from './coreProfile';
import { CoreDials } from './CoreDials';
import { CoreProseFields } from './CoreProseFields';
import { StringListEditor } from './StringListEditor';

interface CoreSectionProps {
  persona: PersonaWithDetails;
}

/**
 * The persona's Character — operator-owned write lane. Edits stay local until
 * the explicit Save, which lands as ONE `update_persona` with the serialized
 * `core_profile`; change history is captured server-side (visible in the
 * Settings tab's change log).
 */
export function CoreSection({ persona }: CoreSectionProps) {
  const { t } = useTranslation();
  const life = t.agents.life;
  const updatePersona = useAgentStore((s) => s.updatePersona);

  const saved = useMemo(() => parseCoreProfile(persona.core_profile), [persona.core_profile]);
  const [draft, setDraft] = useState<PersonaCore | null>(saved);

  // Re-seed the draft when the persona changes (or its Core is refreshed by a
  // save elsewhere) UNLESS the operator has local edits in flight.
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate: only re-seed on persona/core identity change
  }, [persona.id, saved]);

  const patch = (p: Partial<PersonaCore>) => {
    setDraft((d) => ({ ...(d ?? emptyCore()), ...p }));
    setDirty(true);
  };

  if (!draft) {
    return (
      <div data-testid="life-core-empty">
        <EmptyState
          icon={Sparkles}
          title={life.core_empty_title}
          subtitle={life.core_empty_body}
          action={{
            label: life.core_empty_action,
            onClick: () => {
              setDraft(emptyCore());
              setDirty(true);
            },
          }}
          className="py-14"
        />
      </div>
    );
  }

  const save = async () => {
    try {
      await updatePersona(persona.id, { core_profile: serializeCoreProfile(draft) });
      setDirty(false);
    } catch (err) {
      toastCatch('life:saveCore', life.save_failed)(err);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl" data-testid="life-core">
      <SectionCard title={life.sub_core} titleClassName="text-primary">
        <div className="space-y-5">
          <CoreDials core={draft} onChange={patch} />
          <CoreProseFields core={draft} onChange={patch} />
          <div className="grid gap-4 sm:grid-cols-2">
            <StringListEditor
              label={life.core_principles}
              items={draft.principles}
              onChange={(items) => patch({ principles: items })}
              testId="principles"
            />
            <StringListEditor
              label={life.core_constraints}
              items={draft.constraints}
              onChange={(items) => patch({ constraints: items })}
              testId="constraints"
            />
            <StringListEditor
              label={life.core_decision_principles}
              items={draft.decisionPrinciples}
              onChange={(items) => patch({ decisionPrinciples: items })}
              testId="decision-principles"
            />
          </div>
        </div>
      </SectionCard>
      <div className="flex items-center gap-3">
        <AsyncButton variant="primary" onClick={save} disabled={!dirty} data-testid="life-core-save">
          {life.core_save}
        </AsyncButton>
        {dirty && (
          <span className="flex items-center gap-1.5 typo-caption text-status-warning" data-testid="life-core-dirty">
            <span className="w-1.5 h-1.5 rounded-full bg-status-warning animate-pulse" />
            {life.core_unsaved}
          </span>
        )}
      </div>
    </div>
  );
}
