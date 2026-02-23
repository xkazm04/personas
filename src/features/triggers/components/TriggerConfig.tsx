import { useState, useEffect } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { Plus } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import type { DbPersonaTrigger } from '@/lib/types/types';
import { TriggerAddForm } from '@/features/triggers/components/TriggerAddForm';
import { TriggerListItem } from '@/features/triggers/components/TriggerListItem';

export function TriggerConfig() {
  const selectedPersona = usePersonaStore((state) => state.selectedPersona);
  const credentialEvents = usePersonaStore((s) => s.credentialEvents);
  const fetchCredentialEvents = usePersonaStore((s) => s.fetchCredentialEvents);
  const createTrigger = usePersonaStore((state) => state.createTrigger);
  const updateTrigger = usePersonaStore((state) => state.updateTrigger);
  const deleteTrigger = usePersonaStore((state) => state.deleteTrigger);

  const [showAddForm, setShowAddForm] = useState(false);

  // Derive a simple event list from credentialEvents
  const credentialEventsList = credentialEvents.map((e) => ({ id: e.id, name: e.name }));

  useEffect(() => {
    fetchCredentialEvents();
  }, [fetchCredentialEvents]);

  const personaId = selectedPersona?.id || '';
  const triggers = selectedPersona?.triggers || [];

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground/80">
        No persona selected
      </div>
    );
  }

  const handleCreateTrigger = async (triggerType: string, config: Record<string, unknown>) => {
    await createTrigger(personaId, {
      trigger_type: triggerType,
      config,
      enabled: true,
    });
    setShowAddForm(false);
  };

  const handleToggleEnabled = async (triggerId: string, currentEnabled: boolean) => {
    await updateTrigger(personaId, triggerId, { enabled: !currentEnabled });
  };

  const handleDelete = async (triggerId: string) => {
    await deleteTrigger(personaId, triggerId);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">Triggers</h3>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary/90 text-foreground rounded-xl text-sm font-medium transition-all shadow-lg shadow-primary/20"
        >
          <Plus className="w-4 h-4" />
          Add Trigger
        </button>
      </div>

      {/* Add Trigger Form */}
      <AnimatePresence>
        {showAddForm && (
          <TriggerAddForm
            credentialEventsList={credentialEventsList}
            onCreateTrigger={handleCreateTrigger}
            onCancel={() => setShowAddForm(false)}
          />
        )}
      </AnimatePresence>

      {/* Trigger List */}
      <div className="space-y-2">
        {triggers.map((trigger: DbPersonaTrigger) => (
          <TriggerListItem
            key={trigger.id}
            trigger={trigger}
            credentialEventsList={credentialEventsList}
            onToggleEnabled={handleToggleEnabled}
            onDelete={handleDelete}
          />
        ))}

        {triggers.length === 0 && (
          <div className="text-center py-10 text-muted-foreground/80 text-sm">
            No triggers configured. Add one to automate this persona.
          </div>
        )}
      </div>
    </div>
  );
}
