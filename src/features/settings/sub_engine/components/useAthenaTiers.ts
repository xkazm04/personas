import { useCallback, useEffect, useState } from 'react';
import {
  companionGetEngineSettings,
  companionProbeEngines,
  companionSetEngineSettings,
} from '@/api/companion';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
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
  /** The probe itself failed (as opposed to answering "not installed"). */
  probeFailed: boolean;
  /** The initial load failed: the section renders that inline (a failure the
   *  user did not trigger is never a toast, see error-surfacing-policy). */
  loadError: boolean;
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
  const [loadError, setLoadError] = useState(false);
  const [probeFailed, setProbeFailed] = useState(false);

  useEffect(() => {
    companionGetEngineSettings()
      .then((s) => {
        setSettings(s);
        setLoadError(false);
      })
      .catch((e: unknown) => {
        silentCatch('AthenaTiersSection:load')(e);
        setLoadError(true);
      });
    companionProbeEngines()
      .then(setAvailability)
      .catch((e: unknown) => {
        silentCatch('AthenaTiersSection:probe')(e);
        // A failed probe is not "no engines": it carries its own identity so
        // the section can say so instead of reading as an empty answer.
        setProbeFailed(true);
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

  return { settings, availability, loadError, probeFailed, patchTier, save };
}
