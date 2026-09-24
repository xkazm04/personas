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
 *    voice layer, which takes the record exactly once.
 */

import { useCallback } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import type { TwinProfile } from '@/lib/bindings/TwinProfile';
import { pronounsFromGender, type Gender } from '../../../shared/gender';
import { setPendingStyleStart } from '../../../setup/style/pendingStyleStart';
import type { StyleStart } from '../../../setup/style/styleContract';

export interface MirrorDraft {
  name: string;
  gender: Gender;
  /** Language codes, primary first. Empty leaves the backend default. */
  languages: string[];
  style: StyleStart | null;
}

export function useCreateTwin(): (draft: MirrorDraft) => Promise<TwinProfile | null> {
  const createTwinProfile = useSystemStore((s) => s.createTwinProfile);
  const setActiveTwin = useSystemStore((s) => s.setActiveTwin);

  return useCallback(
    async ({ name, gender, languages, style }: MirrorDraft) => {
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
      return profile;
    },
    [createTwinProfile, setActiveTwin],
  );
}
