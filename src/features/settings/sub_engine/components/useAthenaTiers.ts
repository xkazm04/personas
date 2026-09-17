import { useCallback, useEffect, useState } from 'react';
import {
  companionGetEngineSettings,
  companionProbeEngines,
  companionSetEngineSettings,
} from '@/api/companion';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import type { AthenaEngineSettings } from '@/lib/bindings/AthenaEngineSettings';
import type { AthenaTierSettings } from '@/lib/bindings/AthenaTierSettings';
import type { EngineAvailability } from '@/lib/bindings/EngineAvailability';
import type { TurnTierClass } from '@/lib/bindings/TurnTierClass';

export const TIER_CLASSES: TurnTierClass[] = ['main', 'aside', 'micro'];

export interface AthenaTiersState {
  /** `null` until the first load lands (the rows render their chrome anyway). */
  settings: AthenaEngineSettings | null;
  /** `null` while the probe is in flight; `[]` when it failed. */
  availability: EngineAvailability[] | null;
  patchTier: (cls: TurnTierClass, patch: Partial<AthenaTierSettings>) => void;
  /** Persist, then reload from the backend so the rows show what was stored. */
  save: () => Promise<void>;
}

/**
 * State for Settings > Engine > Athena tiers: the persisted tier table plus
 * the engine availability probe (`companion_probe_engines`, run through the
 * same spawn door a real turn uses).
 */
export function useAthenaTiers(): AthenaTiersState {
  const { t } = useTranslation();
  const savedLabel = t.settings.athenaTiers.saved;
  const [settings, setSettings] = useState<AthenaEngineSettings | null>(null);
  const [availability, setAvailability] = useState<EngineAvailability[] | null>(null);

  useEffect(() => {
    companionGetEngineSettings().then(setSettings).catch(toastCatch('AthenaTiersSection:load'));
    companionProbeEngines()
      .then(setAvailability)
      .catch((e: unknown) => {
        toastCatch('AthenaTiersSection:probe')(e);
        setAvailability([]);
      });
  }, []);

  const patchTier = useCallback((cls: TurnTierClass, patch: Partial<AthenaTierSettings>) => {
    setSettings((s) => (s ? { ...s, [cls]: { ...s[cls], ...patch } } : s));
  }, []);

  const save = useCallback(async () => {
    if (!settings) return;
    try {
      await companionSetEngineSettings(settings);
      // Reload rather than trusting local state: the backend normalizes
      // (lower-cases effort, drops unknown values), and the rows must show
      // what it actually stored.
      setSettings(await companionGetEngineSettings());
      useToastStore.getState().addToast(savedLabel, 'success');
    } catch (e) {
      toastCatch('AthenaTiersSection:save')(e);
    }
  }, [settings, savedLabel]);

  return { settings, availability, patchTier, save };
}
