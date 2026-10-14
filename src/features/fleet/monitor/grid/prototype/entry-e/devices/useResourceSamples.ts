// useResourceSamples - what each live run on this device consumes, for the
// board's resource glyphs.
//
// `fleet-resource-sample` carries the FULL live set every 5 s while any run is
// live, so the store replaces its map on every push; this hook attaches the
// listener first (a buffering singleton) and then makes the one reconcile read
// for a board that mounted between pushes - a read the slice drops when a push
// landed while it was in flight. The selectors below
// return store-owned references or primitives, so a line re-renders only when
// ITS reading changes.

import { useEffect } from 'react';
import type { LiveResourceSample } from '@/lib/bindings/LiveResourceSample';
import type { ResourceAxis } from '@/lib/bindings/ResourceAxis';
import { EventName } from '@/lib/eventRegistry';
import { createSingletonListener } from '@/hooks/realtime/createSingletonListener';
import { useSystemStore } from '@/stores/systemStore';

const useSampleStream = createSingletonListener<LiveResourceSample[]>(EventName.FLEET_RESOURCE_SAMPLE);

/** Mount once per surface: the sample listener, then the reconcile read. */
export function useResourceSamples(): void {
  const refresh = useSystemStore((s) => s.refreshLiveSamples);
  const apply = useSystemStore((s) => s.applyResourceSamples);
  const attached = useSampleStream((list) => {
    if (Array.isArray(list)) apply(list);
  });
  useEffect(() => { if (attached) void refresh(); }, [attached, refresh]);
}

/** The live sample of one fleet session, or `null`. */
export function useSessionResource(sessionId: string): LiveResourceSample | null {
  return useSystemStore((s) => {
    const sample = s.liveSamples[sessionId];
    return sample && sample.runKind === 'fleet' ? sample : null;
  });
}

/** The heaviest live execution of one local persona, or `null`. */
export function usePersonaSample(personaId: string): LiveResourceSample | null {
  return useSystemStore((s) => {
    let best: LiveResourceSample | null = null;
    for (const sample of Object.values(s.liveSamples)) {
      if (sample.runKind !== 'execution' || sample.personaId !== personaId) continue;
      if (!best || shareOf(sample) > shareOf(best)) best = sample;
    }
    return best;
  });
}

/** What THIS device's snapshot says a local persona mostly consumes, or `null`. */
export function usePersonaDominant(personaId: string): ResourceAxis | null {
  return useSystemStore((s) => {
    const self = s.meshDevices.find((d) => d.isSelf);
    return self?.snapshot?.agents.find((a) => a.personaId === personaId)?.dominant ?? null;
  });
}

/** The share on a sample's own dominant axis. */
export function shareOf(sample: Pick<LiveResourceSample, 'dominant' | 'cpuShare' | 'ramShare' | 'gpuShare'>): number {
  if (sample.dominant === 'gpu') return sample.gpuShare ?? 0;
  return sample.dominant === 'ram' ? sample.ramShare : sample.cpuShare;
}
