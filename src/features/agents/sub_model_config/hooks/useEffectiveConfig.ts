import { useState, useEffect } from 'react';
import type { EffectiveModelConfig } from '@/lib/bindings/EffectiveModelConfig';
import { resolveEffectiveConfig } from '@/api/agents/personas';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Fetches the effective (cascaded) model config for a persona.
 * Re-fetches when personaId changes or when refreshKey increments.
 */
export function useEffectiveConfig(personaId: string | null | undefined, refreshKey?: number) {
  const [config, setConfig] = useState<EffectiveModelConfig | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!personaId) {
      setConfig(null);
      // Also clear the in-flight flag: the previous run's cleanup has already
      // set cancelled, so its .finally() will not run and the panel would keep
      // rendering its loading ghost forever after the persona is deselected.
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    resolveEffectiveConfig(personaId)
      .then((result) => {
        if (!cancelled) setConfig(result);
      })
      .catch((err) => {
        silentCatch('useEffectiveConfig:resolveEffectiveConfig')(err);
        if (!cancelled) setConfig(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [personaId, refreshKey]);

  return { config, loading };
}
