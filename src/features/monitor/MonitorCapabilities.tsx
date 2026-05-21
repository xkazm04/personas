// MonitorCapabilities — quick-execute grid for a persona's capabilities.
//
// Renders the persona's use cases as mini capability sigils. Clicking a
// runnable capability fires `execute_persona` for that use case; the sigil
// immediately transitions to a disabled, animated in-progress state and is
// locked for RUN_LOCK_MS so it can't be fired twice.

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Play, Loader2 } from 'lucide-react';
import { CapabilitySigil } from '@/features/shared/glyph/CapabilitySigil';
import type { DisplayUseCase } from '@/features/agents/sub_use_cases/components/recipes-prototype/shared/displayUseCase';
import { executePersona } from '@/api/agents/executions';
import { useTranslation } from '@/i18n/useTranslation';
import { createLogger } from '@/lib/log';

const logger = createLogger('monitor-capabilities');

/** Local lock — a capability can't be re-fired for this long after a run. */
const RUN_LOCK_MS = 60_000;

interface MonitorCapabilitiesProps {
  personaId: string;
  useCases: DisplayUseCase[];
}

export function MonitorCapabilities({ personaId, useCases }: MonitorCapabilitiesProps) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState<Set<string>>(new Set());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const map = timers.current;
    return () => { for (const tmr of map.values()) clearTimeout(tmr); };
  }, []);

  const run = useCallback(async (uc: DisplayUseCase) => {
    setExecuting((prev) => {
      if (prev.has(uc.id)) return prev;
      return new Set(prev).add(uc.id);
    });
    const release = () => setExecuting((prev) => {
      const next = new Set(prev);
      next.delete(uc.id);
      return next;
    });
    const tmr = setTimeout(() => { release(); timers.current.delete(uc.id); }, RUN_LOCK_MS);
    timers.current.set(uc.id, tmr);
    try {
      const sample = uc.raw.sample_input;
      await executePersona(
        personaId,
        undefined,
        sample != null ? JSON.stringify(sample) : undefined,
        uc.id,
      );
    } catch (err) {
      logger.error('Quick-execute failed', { error: err, useCaseId: uc.id });
      clearTimeout(tmr);
      timers.current.delete(uc.id);
      release();
    }
  }, [personaId]);

  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}
    >
      {useCases.map((uc) => {
        const isExecuting = executing.has(uc.id);
        const runnable = uc.mode !== 'non_executable' && uc.health !== 'disabled';
        const disabled = isExecuting || !runnable;
        return (
          <button
            key={uc.id}
            type="button"
            disabled={disabled}
            onClick={() => void run(uc)}
            title={uc.title}
            className={`group relative flex flex-col items-center gap-2 rounded-card border px-3 py-3 transition-colors ${
              isExecuting
                ? 'border-primary/40 bg-primary/[0.07]'
                : runnable
                  ? 'border-primary/12 bg-secondary/20 hover:bg-secondary/40 cursor-pointer'
                  : 'border-primary/8 bg-secondary/10 cursor-default'
            }`}
          >
            <div className="relative w-[68px] h-[68px] flex items-center justify-center">
              <div className={isExecuting ? 'opacity-40 transition-opacity' : 'transition-opacity'}>
                <CapabilitySigil uc={uc} size={68} petalStyle="wedge" />
              </div>
              {isExecuting ? (
                <>
                  <motion.span
                    aria-hidden
                    className="absolute inset-0 rounded-full border-2 border-primary/55"
                    animate={{ opacity: [0.25, 0.8, 0.25], scale: [0.9, 1.05, 0.9] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  <Loader2 className="absolute w-5 h-5 text-primary animate-spin" />
                </>
              ) : runnable ? (
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/0 opacity-0 group-hover:opacity-100 group-hover:bg-background/55 transition-all">
                  <Play className="w-5 h-5 text-primary fill-primary/30" />
                </span>
              ) : null}
            </div>
            <span className="typo-caption font-medium text-foreground/90 text-center leading-tight line-clamp-2">
              {uc.title}
            </span>
            <span className={`typo-caption ${isExecuting ? 'text-primary' : runnable ? 'text-foreground/55' : 'text-foreground/35'}`}>
              {isExecuting ? t.monitor.executing : runnable ? t.monitor.run : uc.connector}
            </span>
          </button>
        );
      })}
    </div>
  );
}
