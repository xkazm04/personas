import { useTranslation } from '@/i18n/useTranslation';

import type { VoiceOrigin } from '../../../blueprintContract';

/** Where a channel's style came from, as the reader sees it; `null` = never voiced ("not drawn yet"). */
export function useOriginLabel(): (origin: VoiceOrigin | null) => string {
  const { t } = useTranslation();
  const m = t.twin.blueprint.metrics;
  return (origin) => {
    switch (origin) {
      case 'preset':
        return m.originPreset;
      case 'rolled':
        return m.originRolled;
      case 'learned':
        return m.originLearned;
      case 'manual':
        return m.originManual;
      default:
        return t.twin.blueprint.states.notDrawn;
    }
  };
}
