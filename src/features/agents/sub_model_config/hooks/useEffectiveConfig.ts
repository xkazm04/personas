import { useState, useEffect } from 'react';
import type { EffectiveModelConfig } from '@/lib/bindings/EffectiveModelConfig';
import { resolveEffectiveConfig } from '@/api/agents/personas';

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
      return;
    }

    let cancelled = false;
    setLoading(true);

    resolveEffectiveConfig(personaId)
      .then((result) => {
        if (!cancelled) setConfig(result);
      })
      .catch(() => {
        if (!cancelled) setConfig(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [personaId, refreshKey]);

  return { config, loading };
}
