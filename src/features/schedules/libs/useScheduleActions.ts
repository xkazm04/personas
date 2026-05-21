import { useCallback, useState } from 'react';
import { executePersona } from "@/api/agents/executions";
import { cronFireTimesInRange, listTriggers, previewCronSchedule, updateTrigger } from "@/api/pipeline/triggers";
import { backfillSchedule, type BackfillResult } from "@/api/pipeline/scheduler";

import type { CronPreview } from '@/api/pipeline/triggers';
import type { CronAgent } from '@/lib/bindings/CronAgent';
import { useOverviewStore } from "@/stores/overviewStore";
import { useAgentStore } from "@/stores/agentStore";
import { useToastStore } from '@/stores/toastStore';
import { formatRelative } from './scheduleHelpers';
import { silentCatch } from '@/lib/silentCatch';


export interface ScheduleActionState {
  executing: string | null;   // trigger_id currently being executed
  editing: string | null;     // trigger_id being frequency-edited
  backfilling: string | null; // trigger_id currently being backfilled
  cronPreview: CronPreview | null;
  /** Most recent backfill result per trigger_id. Surfaced in the modal and
   *  the ScheduleTimeline status row so users can see the catch-up count
   *  without re-opening the modal. */
  lastBackfill: Record<string, BackfillResult>;
}

export function useScheduleActions() {
  const fetchCronAgents = useOverviewStore((s) => s.fetchCronAgents);
  const isBudgetBlocked = useAgentStore((s) => s.isBudgetBlocked);
  const addToast = useToastStore((s) => s.addToast);
  const [state, setState] = useState<ScheduleActionState>({
    executing: null,
    editing: null,
    backfilling: null,
    cronPreview: null,
    lastBackfill: {},
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
  }, [isBudgetBlocked, addToast, fetchCronAgents]);

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
        } catch (err) { silentCatch("features/schedules/libs/useScheduleActions:catch1")(err); }
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

  // -- Skip next fire ------------------------------------------------------
  //
  // Bumps `next_trigger_at` forward by one fire. For cron triggers we ask the
  // engine for the two upcoming fire times and write the second; for interval
  // triggers we add `interval_seconds`. Both modes go through the existing
  // `updateTrigger` IPC — no new backend surface needed because the scheduler
  // tick reads `next_trigger_at` as authoritative on every loop.

  const skipNextFire = useCallback(async (agent: CronAgent) => {
    if (!agent.next_trigger_at) {
      addToast('Schedule has no upcoming fire to skip', 'error');
      return;
    }
    try {
      let newNext: string | null = null;

      if (agent.cron_expression) {
        // Ask the engine for the fire after the currently-scheduled one. Look
        // 7 days forward; that is enough headroom for any non-pathological cron.
        const after = new Date(new Date(agent.next_trigger_at).getTime() + 1000);
        const lookahead = new Date(after.getTime() + 7 * 24 * 3_600_000);
        const times = await cronFireTimesInRange(
          agent.cron_expression,
          agent.timezone ?? undefined,
          after,
          lookahead,
          1,
          agent.trigger_id,
        );
        if (times.length === 0) {
          addToast(
            `Could not compute a fire after the next one (cron may only fire once in the next 7 days)`,
            'error',
          );
          return;
        }
        newNext = times[0]!;
      } else if (agent.interval_seconds) {
        const skipped = new Date(agent.next_trigger_at).getTime();
        newNext = new Date(skipped + Number(agent.interval_seconds) * 1000).toISOString();
      } else {
        addToast('Schedule has no cron or interval to skip', 'error');
        return;
      }

      await updateTrigger(agent.trigger_id, agent.persona_id, {
        trigger_type: null,
        config: null,
        enabled: null,
        next_trigger_at: newNext,
      });
      addToast(
        `Skipped next fire of "${agent.persona_name}" — next now ${formatRelative(newNext)}`,
        'success',
      );
      await fetchCronAgents();
    } catch (err) {
      addToast(
        `Failed to skip next fire: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'error',
      );
    }
  }, [fetchCronAgents, addToast]);

  // -- Delayed run ---------------------------------------------------------
  //
  // Replaces the next scheduled fire with one at `now + delayMs`. The
  // scheduler's tick honors the new `next_trigger_at` and fires once, then
  // recomputes the following fire from the cron / interval. Net effect: the
  // user gets a "run in 5 / 15 / 30 min" affordance that survives reload
  // because the delay lives in the trigger row, not a JS timer.

  const runIn = useCallback(async (agent: CronAgent, delayMs: number) => {
    if (delayMs <= 0) {
      addToast('Delay must be positive', 'error');
      return;
    }
    try {
      const fireAt = new Date(Date.now() + delayMs).toISOString();
      await updateTrigger(agent.trigger_id, agent.persona_id, {
        trigger_type: null,
        config: null,
        enabled: null,
        next_trigger_at: fireAt,
      });
      addToast(
        `Will run "${agent.persona_name}" ${formatRelative(fireAt)}`,
        'success',
      );
      await fetchCronAgents();
    } catch (err) {
      addToast(
        `Failed to schedule delayed run: ${err instanceof Error ? err.message : 'Unknown error'}`,
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

  // -- User-initiated backfill --------------------------------------------
  // Distinct from the scheduler's automatic max_backfill catch-up: lets the
  // user pick an explicit [start, end] window and replays every cron/interval
  // fire time that would have fallen inside it, regardless of last_triggered_at.

  const backfill = useCallback(async (
    agent: CronAgent,
    startIso: string,
    endIso: string,
  ): Promise<BackfillResult | null> => {
    setState((s) => ({ ...s, backfilling: agent.trigger_id }));
    try {
      const result = await backfillSchedule(agent.trigger_id, startIso, endIso);
      setState((s) => ({
        ...s,
        lastBackfill: { ...s.lastBackfill, [agent.trigger_id]: result },
      }));
      if (result.slotsEnqueued > 0) {
        addToast(
          `Enqueued ${result.slotsEnqueued} catch-up run${result.slotsEnqueued === 1 ? '' : 's'} for "${agent.persona_name}"${result.capped ? ' (capped)' : ''}`,
          'success',
        );
      } else {
        addToast(
          `No missed slots in that window for "${agent.persona_name}"`,
          'success',
        );
      }
      await fetchCronAgents();
      return result;
    } catch (err) {
      addToast(
        `Backfill failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'error',
      );
      return null;
    } finally {
      setState((s) => ({ ...s, backfilling: null }));
    }
  }, [fetchCronAgents, addToast]);

  return {
    state,
    manualExecute,
    updateFrequency,
    toggleEnabled,
    previewCron,
    backfill,
    skipNextFire,
    runIn,
  } as const;
}
