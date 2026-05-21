import { useEffect, useMemo, useRef, useState } from 'react';
import * as twinApi from '@/api/twin/twin';
import { silentCatch } from '@/lib/silentCatch';
import type { TwinProfile } from '@/lib/bindings/TwinProfile';
import type { TwinTone } from '@/lib/bindings/TwinTone';
import type { TwinChannel } from '@/lib/bindings/TwinChannel';
import type { TwinVoiceProfile } from '@/lib/bindings/TwinVoiceProfile';
import type { TwinPendingMemory } from '@/lib/bindings/TwinPendingMemory';
import { deriveReadiness, type TwinReadiness } from './useTwinReadiness';

export interface ProfileDashboardData {
  readiness: TwinReadiness;
  channelTypes: string[];
  loading: boolean;
}

/**
 * Fan-out loader: for each profile in the list, fetch tones/channels/voice/
 * memories in parallel and derive readiness + channel-type list. Results
 * live in component state so the Profiles grid can render per-card chips
 * without mutating the global store (which is scoped to the active twin).
 *
 * Lifecycle note: once a profile is loaded it isn't re-fetched until the
 * set of profile IDs changes (add/remove) or the component remounts. The
 * active twin's data is kept fresh via `useHydrateActiveTwin` in TwinPage;
 * non-active grid cards may show stale chips after sub-tab edits until the
 * Profiles tab is re-entered.
 */
export function useProfileDashboards(profiles: TwinProfile[]): Record<string, ProfileDashboardData> {
  const [data, setData] = useState<Record<string, ProfileDashboardData>>({});
  // Synchronous gate so multiple loop iterations in the same effect tick
  // don't all start fetches for the same profile before setData lands.
  // Reading from `data` here would race because setState is async.
  const loadedRef = useRef<Set<string>>(new Set());

  // Normalize profile IDs for a stable dependency key
  const profileIds = useMemo(() => profiles.map((p) => p.id).sort().join('|'), [profiles]);

  useEffect(() => {
    let cancelled = false;

    const loadOne = async (profile: TwinProfile) => {
      if (loadedRef.current.has(profile.id)) return;
      loadedRef.current.add(profile.id);

      // Mark as loading with an empty-derived readiness so the card can render something immediately.
      setData((prev) => ({
        ...prev,
        [profile.id]: {
          readiness: deriveReadiness(profile, [], [], null, []),
          channelTypes: [],
          loading: true,
        },
      }));

      const results = await Promise.allSettled([
        twinApi.listTones(profile.id),
        twinApi.listChannels(profile.id),
        twinApi.getVoiceProfile(profile.id),
        twinApi.listPendingMemories(profile.id, 'approved'),
      ]);

      if (cancelled) return;

      // Surface failed legs as Sentry breadcrumbs — without this, dashboards
      // silently degrade to "empty=0%" with no signal in production.
      const tones: TwinTone[] = results[0].status === 'fulfilled'
        ? results[0].value
        : (silentCatch('useProfileDashboards:listTones')(results[0].reason), []);
      const channels: TwinChannel[] = results[1].status === 'fulfilled'
        ? results[1].value
        : (silentCatch('useProfileDashboards:listChannels')(results[1].reason), []);
      const voice: TwinVoiceProfile | null = results[2].status === 'fulfilled'
        ? results[2].value
        : (silentCatch('useProfileDashboards:getVoiceProfile')(results[2].reason), null);
      const memories: TwinPendingMemory[] = results[3].status === 'fulfilled'
        ? results[3].value
        : (silentCatch('useProfileDashboards:listPendingMemories')(results[3].reason), []);

      const readiness = deriveReadiness(profile, tones, channels, voice, memories);
      const channelTypes = Array.from(new Set(channels.filter((c) => c.is_active).map((c) => c.channel_type)));

      setData((prev) => ({
        ...prev,
        [profile.id]: { readiness, channelTypes, loading: false },
      }));
    };

    for (const p of profiles) {
      void loadOne(p);
    }

    const loaded = loadedRef.current;
    return () => {
      cancelled = true;
      // Drop IDs no longer in the active list so a re-add triggers a fresh
      // fetch. IDs still present remain marked-loaded — see lifecycle note above.
      const stillPresent = new Set(profiles.map((p) => p.id));
      for (const id of loaded) {
        if (!stillPresent.has(id)) loaded.delete(id);
      }
    };
  }, [profileIds, profiles]);

  return data;
}
