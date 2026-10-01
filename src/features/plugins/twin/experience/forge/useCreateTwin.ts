/**
 * Creating a twin, with the contract of the dialog this replaces kept intact:
 *
 * 1. `createTwinProfile` — name, pronouns (the sigil), and the languages it
 *    writes in, which the old create dialog never asked for although every
 *    generator behind the twin reads them;
 * 2. `setActiveTwin` — explicitly, because the backend auto-activates only the
 *    FIRST twin, and training somebody else's twin is the worst landing;
 * 3. `setPendingStyleStart` — a starting voice is RECORDED, never run here:
 *    running it needs the twin to exist, and its drafts belong in the stage's
 *    voice layer, which takes the record exactly once;
 * 4. `learnFromSample` — when the forge was opened from Browser > Learn > "New
 *    twin" with a writing sample, the new twin learns from it right away. The
 *    sample is recorded with source kind `forge` (where it was first captured
 *    rides in `sourceHost`), fire-and-forget: the analysis runs in the
 *    background and its proposals wait in the Hub, so a failure here is
 *    telemetry, never a reason to fail the create.
 */

import { useCallback } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { learnFromSample } from '@/api/twin/twinSample';
import { silentCatch } from '@/lib/silentCatch';
import type { TwinProfile } from '@/lib/bindings/TwinProfile';
import { pronounsFromGender, type Gender } from '../../shared/gender';
import { setPendingStyleStart } from '../../setup/style/pendingStyleStart';
import type { StyleStart } from '../../setup/style/styleContract';
import type { ExperienceSeedSample } from '../launcher';

export interface MirrorDraft {
  name: string;
  gender: Gender;
  /** Language codes, primary first. Empty leaves the backend default. */
  languages: string[];
  style: StyleStart | null;
  /** A writing sample to learn from once the twin exists (Browser > Learn > New twin). */
  seedSample?: ExperienceSeedSample | null;
}

export function useCreateTwin(): (draft: MirrorDraft) => Promise<TwinProfile | null> {
  const createTwinProfile = useSystemStore((s) => s.createTwinProfile);
  const setActiveTwin = useSystemStore((s) => s.setActiveTwin);

  return useCallback(
    async ({ name, gender, languages, style, seedSample }: MirrorDraft) => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const profile = await createTwinProfile(
        trimmed,
        undefined,
        undefined,
        // The column holds a JSON array of codes (`["en","cs"]`).
        languages.length > 0 ? JSON.stringify(languages) : undefined,
        pronounsFromGender(gender),
      );
      await setActiveTwin(profile.id);
      if (style) setPendingStyleStart(profile.id, style);
      if (seedSample?.text.trim()) {
        learnFromSample(profile.id, seedSample.text, 'forge', seedSample.sourceHost).catch(
          silentCatch('twin forge learn from seed sample'),
        );
      }
      return profile;
    },
    [createTwinProfile, setActiveTwin],
  );
}
