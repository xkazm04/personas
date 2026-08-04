import { useCallback, useEffect, useRef, useState } from 'react';
import {
  companionDailyGoalsCreate,
  companionDailyGoalsDiscard,
  companionDailyGoalsState,
  companionDailyGoalsToggle,
  type DailyGoalsState,
} from '@/api/companion';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { getActiveTranslations } from '@/i18n/useTranslation';

/** How long the celebratory row state lingers before the cleared state. */
const CELEBRATE_MS = 2500;

/**
 * State + mutations for the dev-only daily-goals ritual. Streak and
 * completion are computed server-side per fetch; the hook refreshes on
 * mount and after every mutation (day rollover is at worst one action
 * stale, acceptable for a dev-only surface). No Zustand slice on
 * purpose — component-to-API is the repo convention for small verticals.
 */
export function useDailyGoals() {
  const [state, setState] = useState<DailyGoalsState | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const refresh = useCallback(async () => {
    try {
      setState(await companionDailyGoalsState());
    } catch (e) {
      silentCatch('useDailyGoals:refresh')(e);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createSet = useCallback(async (titles: string[]) => {
    try {
      setState(await companionDailyGoalsCreate(titles));
      return true;
    } catch (e) {
      toastCatch(
        'useDailyGoals:create',
        getActiveTranslations().plugins.companion.daily_goals_label,
      )(e);
      return false;
    }
  }, []);

  const toggle = useCallback(async (id: string, done: boolean) => {
    try {
      const next = await companionDailyGoalsToggle(id, done);
      setState(next);
      if (next.justCompleted) {
        setCelebrating(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCelebrating(false), CELEBRATE_MS);
      }
    } catch (e) {
      silentCatch('useDailyGoals:toggle')(e);
    }
  }, []);

  const discard = useCallback(async () => {
    try {
      setState(await companionDailyGoalsDiscard());
    } catch (e) {
      silentCatch('useDailyGoals:discard')(e);
    }
  }, []);

  return { state, celebrating, refresh, createSet, toggle, discard };
}
