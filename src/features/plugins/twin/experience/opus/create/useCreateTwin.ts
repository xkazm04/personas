/**
 * Creating a twin, with the contract of the dialog this replaces kept intact:
 *
 * 1. `createTwinProfile` — name, pronouns (the sigil), and now the languages
 *    it writes in, which the create dialog never asked for although every
 *    generator reads them (the style studio writes samples in the first one,
 *    and the guide now offers answers in it);
 * 2. `setActiveTwin` — explicitly, because the backend auto-activates only
 *    the FIRST twin, and training somebody else's twin is the worst landing;
 * 3. `setPendingStyleStart` — the starting style is RECORDED, never run here:
 *    running it needs the twin to exist, and its preview belongs at the table,
 *    which takes it exactly once.
 */

import { useCallback } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import type { TwinProfile } from '@/lib/bindings/TwinProfile';
import { pronounsFromGender, type Gender } from '../../../shared/gender';
import { setPendingStyleStart } from '../../../setup/style/pendingStyleStart';
import type { StyleStart } from '../../../setup/style/styleContract';

export interface CreateTwinDraft {
  name: string;
  gender: Gender;
  /** Language codes, primary first. Empty leaves the backend default. */
  languages: string[];
  style: StyleStart | null;
}

export function useCreateTwin(): (draft: CreateTwinDraft) => Promise<TwinProfile | null> {
  const createTwinProfile = useSystemStore((s) => s.createTwinProfile);
  const setActiveTwin = useSystemStore((s) => s.setActiveTwin);

  return useCallback(
    async ({ name, gender, languages, style }: CreateTwinDraft) => {
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
