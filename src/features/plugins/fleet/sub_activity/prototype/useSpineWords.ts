/**
 * Gate K prototype: every word the Spine & Lens port of Fleet Activity shows, from keys that
 * already exist (no new strings in Phase A). Where the variant had a word no catalog carries
 * (its unit legend prose, "Cache share", "Lines"), the port draws the glyph or drops the item.
 */
import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { SpineState } from './activitySpineModel';

export function useSpineWords() {
  const { t, tx } = useTranslation();
  return useMemo(() => {
    const f = t.plugins.fleet;
    const state: Record<SpineState, string> = {
      awaiting_input: f.state_awaiting_input,
      running: f.state_working,
      spawning: f.state_spawning,
      queued: f.state_queued,
      idle: f.state_idle,
      stale: f.state_stale,
      finished: f.state_finished,
      hibernated: f.state_hibernated,
      exited: f.state_exited,
      gone: t.common.inactive,
    };
    return {
      t, tx, f, state,
      eyebrow: `${f.footer_title} · ${t.monitor.activity}`,
      sessions: t.agents.ops.sessions,
      toolCalls: t.agents.lab.tool_calls,
      files: f.harvest_files,
      tokenLabels: {
        input: f.insights_input,
        output: f.insights_output,
        cacheCreation: f.insights_cache_write,
        cacheRead: f.insights_cache_read,
      },
    };
  }, [t, tx]);
}

export type SpineWords = ReturnType<typeof useSpineWords>;
