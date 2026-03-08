import { useCallback, useState } from 'react';
import * as api from '@/api/tauriApi';
import type { CronPreview } from '@/api/triggers';
import type { CronAgent } from '@/lib/bindings/CronAgent';
import { usePersonaStore } from '@/stores/personaStore';
import { useToastStore } from '@/stores/toastStore';

export interface ScheduleActionState {
  executing: string | null;   // trigger_id currently being executed
  editing: string | null;     // trigger_id being frequency-edited
  recovering: string | null;  // trigger_id being batch-recovered
  cronPreview: CronPreview | null;
}

export function useScheduleActions() {
  const fetchCronAgents = usePersonaStore((s) => s.fetchCronAgents);
  const addToast = useToastStore((s) => s.addToast);
  const [state, setState] = useState<ScheduleActionState>({
    executing: null,
    editing: null,
    recovering: null,
    cronPreview: null,
  });

  // ── Manual Execute ──────────────────────────────────────────────────────

  const manualExecute = useCallback(async (agent: CronAgent) => {
    setState((s) => ({ ...s, executing: agent.trigger_id }));
    try {
      await api.executePersona(agent.persona_id, agent.trigger_id);
      addToast(`Triggered "${agent.persona_name}" manually`, 'success');
      await fetchCronAgents();
    } catch (err) {
      addToast(
        `Failed to execute "${agent.persona_name}": ${err instanceof Error ? err.message : 'Unknown error'}`,
        'error',
      );
    } finally {
      setState((s) => ({ ...s, executing: null }));
    }
  }, [fetchCronAgents, addToast]);

  // ── Change Cron Frequency ───────────────────────────────────────────────

  const updateFrequency = useCallback(async (
    agent: CronAgent,
    newCron: string | null,
    newIntervalSeconds: number | null,
  ) => {
    setState((s) => ({ ...s, editing: agent.trigger_id }));
    try {
      const configObj: Record<string, unknown> = { type: 'schedule' };
      if (newCron) configObj.cron = newCron;
      if (newIntervalSeconds) configObj.interval_seconds = newIntervalSeconds;

      await api.updateTrigger(agent.trigger_id, agent.persona_id, {
        trigger_type: null,
        config: JSON.stringify(configObj),
        enabled: null,
        next_trigger_at: null,
      });
      addToast(`Updated schedule for "${agent.persona_name}"`, 'success');
      await fetchCronAgents();
    } catch (err) {
      addToast(
        `Failed to update schedule: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'error',
      );
    } finally {
      setState((s) => ({ ...s, editing: null }));
    }
  }, [fetchCronAgents, addToast]);

  // ── Toggle Trigger Enabled ──────────────────────────────────────────────

  const toggleEnabled = useCallback(async (agent: CronAgent) => {
    try {
      await api.updateTrigger(agent.trigger_id, agent.persona_id, {
        trigger_type: null,
        config: null,
        enabled: !agent.trigger_enabled,
        next_trigger_at: null,
      });
      addToast(
        `${agent.trigger_enabled ? 'Paused' : 'Resumed'} "${agent.persona_name}"`,
        'success',
      );
      await fetchCronAgents();
    } catch (err) {
      addToast(
        `Failed to toggle: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'error',
      );
    }
  }, [fetchCronAgents, addToast]);

  // ── Preview Cron ────────────────────────────────────────────────────────

  const previewCron = useCallback(async (expression: string) => {
    try {
      const preview = await api.previewCronSchedule(expression, 5);
      setState((s) => ({ ...s, cronPreview: preview }));
      return preview;
    } catch {
      setState((s) => ({ ...s, cronPreview: null }));
      return null;
    }
  }, []);

  // ── Batch Recovery ──────────────────────────────────────────────────────

  const batchRecover = useCallback(async (agents: CronAgent[]) => {
    let succeeded = 0;
    let failed = 0;

    for (const agent of agents) {
      setState((s) => ({ ...s, recovering: agent.trigger_id }));
      try {
        await api.executePersona(agent.persona_id, agent.trigger_id);
        succeeded++;
      } catch {
        failed++;
      }
    }

    setState((s) => ({ ...s, recovering: null }));
    await fetchCronAgents();

    if (failed === 0) {
      addToast(`Recovered ${succeeded} skipped execution${succeeded !== 1 ? 's' : ''}`, 'success');
    } else {
      addToast(`Recovered ${succeeded}, failed ${failed}`, 'error');
    }
  }, [fetchCronAgents, addToast]);

  return {
    state,
    manualExecute,
    updateFrequency,
    toggleEnabled,
    previewCron,
    batchRecover,
  } as const;
}
