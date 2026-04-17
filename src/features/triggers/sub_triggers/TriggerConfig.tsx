import { useState, useEffect } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { useVaultStore } from "@/stores/vaultStore";
import { usePipelineStore } from "@/stores/pipelineStore";
import { Plus, X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import type { PersonaTrigger } from '@/lib/types/types';
import { TriggerAddForm } from './TriggerAddForm';
import { TriggerListItem } from './TriggerListItem';
import { useTriggerOperations } from '@/features/triggers/hooks/useTriggerOperations';
import { useTranslation } from '@/i18n/useTranslation';

export function TriggerConfig() {
  const { t } = useTranslation();
  const selectedPersona = useAgentStore((state) => state.selectedPersona);
  const credentialEvents = useVaultStore((s) => s.credentialEvents);
  const fetchCredentialEvents = useVaultStore((s) => s.fetchCredentialEvents);
  const triggerError = usePipelineStore((s) => s.triggerError);
  const clearTriggerError = usePipelineStore((s) => s.clearTriggerError);

  const personaId = selectedPersona?.id || '';
  const triggers = selectedPersona?.triggers || [];
  const ops = useTriggerOperations(personaId);

  const [showAddForm, setShowAddForm] = useState(false);

  // Derive a simple event list from credentialEvents
  const credentialEventsList = credentialEvents.map((e) => ({ id: e.id, name: e.name }));

  useEffect(() => {
    fetchCredentialEvents();
  }, [fetchCredentialEvents]);

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-foreground">
        No persona selected
      </div>
    );
  }

  const handleCreateTrigger = async (triggerType: string, config: Record<string, unknown>): Promise<string | undefined> => {
    const result = await ops.create(triggerType, config);
    if (result.ok) {
      setShowAddForm(false);
      return undefined;
    }
    return result.error;
  };

  const handleToggleEnabled = async (triggerId: string, currentEnabled: boolean) => {
    await ops.toggle(triggerId, currentEnabled);
  };

  const handleDelete = async (triggerId: string) => {
    await ops.remove(triggerId);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="typo-code font-mono text-foreground uppercase tracking-wider">{t.triggers.config.title}</h3>
        <Button
          variant="primary"
          size="sm"
          icon={<Plus className="w-4 h-4" />}
          onClick={() => setShowAddForm(!showAddForm)}
        >
          Add Trigger
        </Button>
      </div>

      {/* Add Trigger Form */}
      {showAddForm && (
          <TriggerAddForm
            credentialEventsList={credentialEventsList}
            onCreateTrigger={handleCreateTrigger}
            onCancel={() => setShowAddForm(false)}
          />
        )}

      {/* Trigger Error */}
      {triggerError?.kind === 'crud' && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-card typo-body text-red-400">
          <span className="flex-1">{triggerError.message}</span>
          <Button variant="ghost" size="icon-sm" onClick={clearTriggerError} className="shrink-0 hover:text-red-300">
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Trigger List */}
      <div className="space-y-2">
        {triggers.map((trigger: PersonaTrigger) => (
          <TriggerListItem
            key={trigger.id}
            trigger={trigger}
            credentialEventsList={credentialEventsList}
            onToggleEnabled={handleToggleEnabled}
            onDelete={handleDelete}
          />
        ))}

        {triggers.length === 0 && (
          <div className="text-center py-10 text-foreground typo-body">
            {t.triggers.config.empty}
          </div>
        )}
      </div>
    </div>
  );
}
