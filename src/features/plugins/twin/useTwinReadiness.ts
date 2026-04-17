import { useEffect, useRef } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import type { TwinProfile } from '@/lib/bindings/TwinProfile';
import type { TwinTone } from '@/lib/bindings/TwinTone';
import type { TwinChannel } from '@/lib/bindings/TwinChannel';
import type { TwinVoiceProfile } from '@/lib/bindings/TwinVoiceProfile';
import type { TwinPendingMemory } from '@/lib/bindings/TwinPendingMemory';

/**
 * Readiness model shared by Directions 1, 3, and 5:
 *
 * - Direction 1 (dashboard chips): each milestone renders as a colored chip on the profile card.
 * - Direction 3 (progress strip): each milestone renders as a dot in the TwinSelector banner.
 * - Direction 5 (readiness %): the score aggregates the six milestones into a single number.
 *
 * A milestone is `'complete'` | `'partial'` | `'empty'`. The score counts
 * `complete` as 1, `partial` as 0.5, `empty` as 0, divided by 6 and rounded.
 */

export type MilestoneStatus = 'complete' | 'partial' | 'empty';

export interface TwinReadiness {
  identity: MilestoneStatus;
  tone: MilestoneStatus;
  brain: MilestoneStatus;
  voice: MilestoneStatus;
  channels: MilestoneStatus;
  memories: MilestoneStatus;
  /** Integer 0–100. */
  score: number;
  /** Counts feeding the UI — safe to render in tooltips / chips. */
  counts: {
    toneRows: number;
    toneHasSpecific: boolean;
    channelsTotal: number;
    channelsActive: number;
    memoriesApproved: number;
    memoriesPending: number;
  };
}

const BIO_MIN_CHARS = 50;
const MEMORY_STRONG_THRESHOLD = 5;

function scoreOf(status: MilestoneStatus): number {
  if (status === 'complete') return 1;
  if (status === 'partial') return 0.5;
  return 0;
}

/**
 * Derive readiness from data already in the store. Pure function — returns
 * a stable object shape even when layers haven't loaded yet (treated as empty).
 */
export function deriveReadiness(
  profile: TwinProfile | null | undefined,
  tones: TwinTone[],
  channels: TwinChannel[],
  voiceProfile: TwinVoiceProfile | null | undefined,
  memories: TwinPendingMemory[],
): TwinReadiness {
  // Identity: bio present + non-trivial length
  let identity: MilestoneStatus = 'empty';
  if (profile?.bio && profile.bio.trim().length > 0) {
    identity = profile.bio.trim().length >= BIO_MIN_CHARS ? 'complete' : 'partial';
  }

  // Tone: generic-only is partial; any non-generic row is complete
  const toneRows = tones.length;
  const toneHasSpecific = tones.some((t) => t.channel !== 'generic');
  let tone: MilestoneStatus = 'empty';
  if (toneRows > 0) tone = toneHasSpecific ? 'complete' : 'partial';

  // Brain: KB bound is complete; obsidian-subpath only is partial
  let brain: MilestoneStatus = 'empty';
  if (profile?.knowledge_base_id) brain = 'complete';
  else if (profile?.obsidian_subpath && profile.obsidian_subpath.trim()) brain = 'partial';

  // Voice: a voice_id is the minimum for "configured"
  const voiceReady = !!voiceProfile?.voice_id && voiceProfile.voice_id.trim().length > 0;
  const voice: MilestoneStatus = voiceReady ? 'complete' : 'empty';

  // Channels: at least one active is complete; all-paused is partial
  const channelsTotal = channels.length;
  const channelsActive = channels.filter((c) => c.is_active).length;
  let channelsStatus: MilestoneStatus = 'empty';
  if (channelsTotal > 0) channelsStatus = channelsActive >= 1 ? 'complete' : 'partial';

  // Memories: approved count thresholds
  const memoriesApproved = memories.filter((m) => m.status === 'approved').length;
  const memoriesPending = memories.filter((m) => m.status === 'pending').length;
  let memoriesStatus: MilestoneStatus = 'empty';
  if (memoriesApproved >= MEMORY_STRONG_THRESHOLD) memoriesStatus = 'complete';
  else if (memoriesApproved >= 1) memoriesStatus = 'partial';

  const raw =
    scoreOf(identity) +
    scoreOf(tone) +
    scoreOf(brain) +
    scoreOf(voice) +
    scoreOf(channelsStatus) +
    scoreOf(memoriesStatus);
  const score = Math.round((raw / 6) * 100);

  return {
    identity,
    tone,
    brain,
    voice,
    channels: channelsStatus,
    memories: memoriesStatus,
    score,
    counts: {
      toneRows,
      toneHasSpecific,
      channelsTotal,
      channelsActive,
      memoriesApproved,
      memoriesPending,
    },
  };
}

/**
 * Hook that returns readiness for the currently active twin. Reads state
 * directly — no fetches are triggered here (that's the orchestrator's job).
 */
export function useTwinReadiness(): TwinReadiness {
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const twinProfiles = useSystemStore((s) => s.twinProfiles);
  const twinTones = useSystemStore((s) => s.twinTones);
  const twinChannels = useSystemStore((s) => s.twinChannels);
  const twinVoiceProfile = useSystemStore((s) => s.twinVoiceProfile);
  const twinPendingMemories = useSystemStore((s) => s.twinPendingMemories);

  const profile = activeTwinId ? twinProfiles.find((p) => p.id === activeTwinId) : null;
  // Only count tones/channels/memories that belong to the active twin. The
  // slices may still hold rows from a previously-active twin while a fetch
  // is in flight.
  const scopedTones = profile ? twinTones.filter((t) => t.twin_id === profile.id) : [];
  const scopedChannels = profile ? twinChannels.filter((c) => c.twin_id === profile.id) : [];
  const scopedMemories = profile ? twinPendingMemories.filter((m) => m.twin_id === profile.id) : [];
  const scopedVoice = twinVoiceProfile && profile && twinVoiceProfile.twin_id === profile.id ? twinVoiceProfile : null;

  return deriveReadiness(profile, scopedTones, scopedChannels, scopedVoice, scopedMemories);
}

/**
 * Fire all per-twin fetches once when `activeTwinId` changes. Keeps the
 * TwinSelector strip and readiness badge accurate regardless of which
 * sub-tab the user is viewing (subtabs still re-fetch what they need on
 * mount, but we don't want the strip to wait for that).
 */
export function useHydrateActiveTwin() {
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const fetchTones = useSystemStore((s) => s.fetchTwinTones);
  const fetchChannels = useSystemStore((s) => s.fetchTwinChannels);
  const fetchVoice = useSystemStore((s) => s.fetchTwinVoiceProfile);
  const fetchPending = useSystemStore((s) => s.fetchTwinPendingMemories);

  const lastHydratedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeTwinId) return;
    if (lastHydratedRef.current === activeTwinId) return;
    lastHydratedRef.current = activeTwinId;
    // Best-effort — failures are non-blocking; subtabs report their own errors.
    void fetchTones(activeTwinId);
    void fetchChannels(activeTwinId);
    void fetchVoice(activeTwinId);
    void fetchPending(activeTwinId, 'approved');
  }, [activeTwinId, fetchTones, fetchChannels, fetchVoice, fetchPending]);
}
