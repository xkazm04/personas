/**
 * Configure-and-commit modal for a Chain Studio signal-source route
 * (`schedule|webhook|polling|… → persona`). Hosts the full trigger form
 * (`TriggerAddForm`) locked to the route's source type, so the per-type
 * config (cron + preview, url, secret, …) is collected with the exact same
 * validation the classic trigger form uses; the trigger is created on the
 * route's TARGET persona.
 */
import { Zap, X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useTranslation } from '@/i18n/useTranslation';
import type { Persona } from '@/lib/bindings/Persona';
import { TriggerAddForm } from '@/features/triggers/sub_triggers/TriggerAddForm';
import type { DraftLink } from './libs/studioDraftModel';
import { personaName } from './libs/studioDraftModel';

export function StudioTriggerCommitModal({ open, link, personas, onCreate, onClose }: {
  open: boolean;
  link: DraftLink | null;
  personas: Persona[];
  onCreate: (triggerType: string, config: Record<string, unknown>) => Promise<string | undefined>;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const st = t.triggers.studio;

  if (!link || link.source.kind !== 'trigger') return null;
  const triggerType = link.source.triggerType;

  return (
    <BaseModal isOpen={open} onClose={onClose} titleId="studio-trigger-commit" size="md">
      <div className="flex flex-col">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border">
          <Zap className="w-4 h-4 text-status-warning" />
          <div className="flex-1 min-w-0">
            <h2 id="studio-trigger-commit" className="typo-heading text-foreground">{st.form_commit_title}</h2>
            <p className="typo-caption text-foreground truncate">
              {tx(st.form_commit_subtitle, { persona: personaName(link.targetPersonaId, personas) })}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t.common.cancel}
            className="p-1 rounded-interactive text-foreground hover:bg-secondary/50 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 max-h-[70vh] overflow-y-auto scrollbar-thin">
          <TriggerAddForm
            credentialEventsList={[]}
            lockedTriggerType={triggerType}
            onCreateTrigger={onCreate}
            onCancel={onClose}
          />
        </div>
      </div>
    </BaseModal>
  );
}
