import { useCallback, useState } from 'react';
import { executePersona } from "@/api/agents/executions";
import { listTriggers, previewCronSchedule, updateTrigger } from "@/api/pipeline/triggers";

import type { CronPreview } from '@/api/pipeline/triggers';
import type { CronAgent } from '@/lib/bindings/CronAgent';
import { useOverviewStore } from "@/stores/overviewStore";
import { useAgentStore } from "@/stores/agentStore";
import { useToastStore } from '@/stores/toastStore';

export interface ScheduleActionState {
  executing: string | null;   // trigger_id currently being executed
  editing: string | null;     // trigger_id being frequency-edited
  cronPreview: CronPreview | null;
}

export function useScheduleActions() {
  const fetchCronAgents = useOverviewStore((s) => s.fetchCronAgents);
  const isBudgetBlocked = useAgentStore((s) => s.isBudgetBlocked);
  const addToast = useToastStore((s) => s.addToast);
  const [state, setState] = useState<ScheduleActionState>({
    executing: null,
    editing: null,
    cronPreview: null,
  });

  // -- Manual Execute ------------------------------------------------------

  const manualExecute = useCallback(async (agent: CronAgent) => {
    if (isBudgetBlocked(agent.persona_id)) {
      addToast(`Budget enforcement for "${agent.persona_name}" -- execution blocked (budget exceeded or data unavailable)`, 'error');
      return;
    }
    setState((s) => ({ ...s, executing: agent.trigger_id }));
    try {
      await executePersona(agent.persona_id, agent.trigger_id);
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

  // -- Change Cron Frequency -----------------------------------------------

  const updateFrequency = useCallback(async (
    agent: CronAgent,
    newCron: string | null,
    newIntervalSeconds: number | null,
    /** When the schedule is cron-mode, the IANA zone for evaluation.
     *  - undefined: keep the existing config.timezone (or absence) untouched.
     *  - string: overwrite config.timezone.
     *  - null sentinel via empty string is NOT supported here — use the value
     *    "" only to mean "remove the field" if needed in a future revision. */
    newTimezone?: string,
  ) => {
    setState((s) => ({ ...s, editing: agent.trigger_id }));
    try {
      // Read-modify-write: fetch the current trigger config and merge the new
      // schedule fields on top. Building config from scratch silently wipes
      // active_window, rate_limit, and any other settings — turning a
      // business-hours trigger into a 24/7 one with no UI signal.
      const triggers = await listTriggers(agent.persona_id);
      const current = triggers.find((tr) => tr.id === agent.trigger_id);
      let baseConfig: Record<string, unknown> = {};
      if (current?.config) {
        try {
          const parsed = JSON.parse(current.config);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            baseConfig = parsed as Record<string, unknown>;
          }
        } catch {
          // Existing config is malformed JSON. Fall back to empty merge — the
          // schedule fields below still take effect; we don't want to block the
          // user's edit because the prior write was corrupt.
        }
      }

      const configObj: Record<string, unknown> = { ...baseConfig, type: 'schedule' };
      if (newCron) {
        configObj.cron = newCron;
        delete configObj.interval_seconds;
        // Caller-supplied tz wins over existing; otherwise leave whatever is in
        // baseConfig.timezone alone so a tz-edit does not require re-supplying it.
        if (newTimezone !== undefined) {
          if (newTimezone) configObj.timezone = newTimezone;
          else delete configObj.timezone;
        }
      } else if (newIntervalSeconds) {
        configObj.interval_seconds = newIntervalSeconds;
        delete configObj.cron;
        // Interval-mode schedules don't use timezone (firing N seconds apart
        // is zone-agnostic). Clear it so a Schedule that flipped from cron→interval
        // doesn't leave a stale tz field that confuses readers.
        delete configObj.timezone;
      }

      await updateTrigger(agent.trigger_id, agent.persona_id, {
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

  // -- Toggle Trigger Enabled ----------------------------------------------

  const toggleEnabled = useCallback(async (agent: CronAgent) => {
    try {
      await updateTrigger(agent.trigger_id, agent.persona_id, {
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

  // -- Preview Cron --------------------------------------------------------

  const previewCron = useCallback(async (expression: string, timezone?: string) => {
    try {
      const preview = await previewCronSchedule(expression, 5, timezone);
      setState((s) => ({ ...s, cronPreview: preview }));
      return preview;
    } catch {
      setState((s) => ({ ...s, cronPreview: null }));
      return null;
    }
  }, []);

  // batchRecover was removed when the scheduler gained automatic backfill
  // (max_backfill field on the schedule trigger config). Catch-up now
  // happens server-side; users no longer need a "recover N missed runs"
  // button. See Architect ADR 2026-05-01-schedules-overdue-backfill.

  return {
    state,
    manualExecute,
    updateFrequency,
    toggleEnabled,
    previewCron,
  } as const;
}
