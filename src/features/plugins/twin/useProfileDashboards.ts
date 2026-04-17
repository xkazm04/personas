import { useEffect, useMemo, useRef, useState } from 'react';
import * as twinApi from '@/api/twin/twin';
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
 * Re-runs when the set of profile IDs changes; skips profiles it has
 * already loaded in the current mount.
 */
export function useProfileDashboards(profiles: TwinProfile[]): Record<string, ProfileDashboardData> {
  const [data, setData] = useState<Record<string, ProfileDashboardData>>({});
  const inFlightRef = useRef<Set<string>>(new Set());

  // Normalize profile IDs for a stable dependency key
  const profileIds = useMemo(() => profiles.map((p) => p.id).sort().join('|'), [profiles]);

  useEffect(() => {
    let cancelled = false;

    const loadOne = async (profile: TwinProfile) => {
      if (inFlightRef.current.has(profile.id)) return;
      inFlightRef.current.add(profile.id);

      // Mark as loading with an empty-derived readiness so the card can render something immediately.
      setData((prev) => ({
        ...prev,
        [profile.id]: {
          readiness: deriveReadiness(profile, [], [], null, []),
          channelTypes: [],
          loading: true,
        },
      }));

      let tones: TwinTone[] = [];
      let channels: TwinChannel[] = [];
      let voice: TwinVoiceProfile | null = null;
      let memories: TwinPendingMemory[] = [];

      const results = await Promise.allSettled([
        twinApi.listTones(profile.id),
        twinApi.listChannels(profile.id),
        twinApi.getVoiceProfile(profile.id),
        twinApi.listPendingMemories(profile.id, 'approved'),
      ]);

      if (results[0].status === 'fulfilled') tones = results[0].value;
      if (results[1].status === 'fulfilled') channels = results[1].value;
      if (results[2].status === 'fulfilled') voice = results[2].value;
      if (results[3].status === 'fulfilled') memories = results[3].value;

      if (cancelled) return;

      const readiness = deriveReadiness(profile, tones, channels, voice, memories);
      const channelTypes = Array.from(new Set(channels.filter((c) => c.is_active).map((c) => c.channel_type)));

      setData((prev) => ({
        ...prev,
        [profile.id]: { readiness, channelTypes, loading: false },
      }));
    };

    for (const p of profiles) {
      if (!data[p.id]) void loadOne(p);
    }

    return () => {
      cancelled = true;
    };
  }, [profileIds]);

  return data;
}
