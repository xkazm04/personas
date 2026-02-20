import { useState, useEffect, useRef, useCallback } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { Plus } from 'lucide-react';
import * as api from '@/api/tauriApi';
import { AnimatePresence } from 'framer-motion';
import type { DbPersonaTrigger } from '@/lib/types/types';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
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
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [copiedTriggerId, setCopiedTriggerId] = useState<string | null>(null);
  const [testingTriggerId, setTestingTriggerId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ triggerId: string; success: boolean; message: string } | null>(null);
  const [copiedCurlId, setCopiedCurlId] = useState<string | null>(null);
  const [activityTriggerId, setActivityTriggerId] = useState<string | null>(null);
  const [activityLog, setActivityLog] = useState<PersonaExecution[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleActivityLog = useCallback(async (triggerId: string, pId: string) => {
    if (activityTriggerId === triggerId) {
      setActivityTriggerId(null);
      return;
    }
    setActivityTriggerId(triggerId);
    setActivityLoading(true);
    try {
      const execs = await api.listExecutions(pId, 50);
      const filtered = execs
        .filter((e) => e.trigger_id === triggerId)
        .slice(0, 10);
      setActivityLog(filtered);
    } catch {
      setActivityLog([]);
    } finally {
      setActivityLoading(false);
    }
  }, [activityTriggerId]);

  const startDeleteConfirm = useCallback((triggerId: string) => {
    setConfirmingDeleteId(triggerId);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => setConfirmingDeleteId(null), 3000);
  }, []);

  const getWebhookUrl = useCallback((triggerId: string) => {
    return `http://localhost:9420/webhook/${triggerId}`;
  }, []);

  const copyWebhookUrl = useCallback(async (triggerId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(getWebhookUrl(triggerId));
      setCopiedTriggerId(triggerId);
      setTimeout(() => setCopiedTriggerId(null), 2000);
    } catch {
      // Fallback for clipboard API failures
    }
  }, [getWebhookUrl]);

  const handleTestFire = useCallback(async (triggerId: string, triggerPersonaId: string) => {
    setTestingTriggerId(triggerId);
    setTestResult(null);
    try {
      const execution = await api.executePersona(triggerPersonaId, triggerId);
      setTestResult({ triggerId, success: true, message: `Execution ${execution.id.slice(0, 8)} started` });
    } catch (err) {
      setTestResult({ triggerId, success: false, message: err instanceof Error ? err.message : 'Failed to fire trigger' });
    } finally {
      setTestingTriggerId(null);
      setTimeout(() => setTestResult(null), 5000);
    }
  }, []);

  const getCurlCommand = useCallback((triggerId: string) => {
    const url = getWebhookUrl(triggerId);
    return `curl -X POST ${url} \\\n  -H "Content-Type: application/json" \\\n  -d '{"test": true}'`;
  }, [getWebhookUrl]);

  const copyCurlCommand = useCallback(async (triggerId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(getCurlCommand(triggerId));
      setCopiedCurlId(triggerId);
      setTimeout(() => setCopiedCurlId(null), 2000);
    } catch {
      // Fallback for clipboard API failures
    }
  }, [getCurlCommand]);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  // Derive a simple event list from credentialEvents
  const credentialEventsList = credentialEvents.map((e) => ({ id: e.id, name: e.name }));

  useEffect(() => {
    fetchCredentialEvents();
  }, [fetchCredentialEvents]);

  const personaId = selectedPersona?.id || '';
  const triggers = selectedPersona?.triggers || [];

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground/40">
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
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmingDeleteId(null);
    await deleteTrigger(personaId, triggerId);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-mono text-muted-foreground/50 uppercase tracking-wider">Triggers</h3>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary/90 text-foreground rounded-xl text-xs font-medium transition-all shadow-lg shadow-primary/20"
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
            confirmingDeleteId={confirmingDeleteId}
            copiedTriggerId={copiedTriggerId}
            testingTriggerId={testingTriggerId}
            testResult={testResult}
            copiedCurlId={copiedCurlId}
            activityTriggerId={activityTriggerId}
            activityLog={activityLog}
            activityLoading={activityLoading}
            onToggleEnabled={handleToggleEnabled}
            onStartDeleteConfirm={startDeleteConfirm}
            onConfirmDelete={handleDelete}
            onCancelDelete={() => setConfirmingDeleteId(null)}
            onTestFire={handleTestFire}
            onCopyWebhookUrl={copyWebhookUrl}
            onCopyCurlCommand={copyCurlCommand}
            onToggleActivityLog={toggleActivityLog}
            getWebhookUrl={getWebhookUrl}
          />
        ))}

        {triggers.length === 0 && (
          <div className="text-center py-10 text-muted-foreground/40 text-sm">
            No triggers configured. Add one to automate this persona.
          </div>
        )}
      </div>
    </div>
  );
}
