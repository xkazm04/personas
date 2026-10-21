// MonitorCapabilities — quick-execute grid for a persona's capabilities.
//
// Renders the persona's capabilities (charters since e19, legacy design-context
// use cases before it) as mini capability sigils. Clicking a runnable
// capability opens `MonitorRunSheet` prefilled with the charter's declared
// sample; confirming fires `execute_persona` with whatever the operator left in
// the field. The sigil then transitions to a disabled, animated in-progress
// state for as long as THE RUN is live (its `execution:<id>` entry in
// `activeProcesses`), so it can't be fired twice and never outlives the run.
//
// The prompt is the whole point: the sigil used to dispatch the sample and
// nothing else, so the Monitor could only fire fixtures. Cancelling leaves the
// sigil unlocked, and "Run sample" keeps the old one-click behaviour reachable
// under a name that says what it sends.

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Play, Loader2 } from 'lucide-react';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { CapabilitySigil } from '@/features/shared/glyph/CapabilitySigil';
import {
  getHealthMeta,
  specParameterValues,
  type PersonaCapability,
} from '@/lib/personas/capabilities';
import { useThemeStore } from '@/stores/themeStore';
import { useOverviewStore } from '@/stores/overviewStore';
import type { ActiveProcess } from '@/stores/slices/processActivitySlice';
import { executePersona } from '@/api/agents/executions';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { createLogger } from '@/lib/log';
import { MonitorRunSheet } from './MonitorRunSheet';

const logger = createLogger('monitor-capabilities');

/** A run still counts as busy while its process is in one of these states. */
const LIVE_STATUSES: ReadonlySet<ActiveProcess['status']> = new Set(['running', 'queued', 'input_required']);

interface MonitorCapabilitiesProps {
  personaId: string;
  useCases: PersonaCapability[];
}

export function MonitorCapabilities({ personaId, useCases }: MonitorCapabilitiesProps) {
  const { t } = useTranslation();
  const prefersReducedMotion = useReducedMotion();
  // The sigil is a pure primitive — this connected grid owns the store read
  // and the health-label lookup.
  const cvdSafe = useThemeStore((s) => s.cvdSafe);
  const healthMeta = getHealthMeta(t);
  // `executePersona` resolves with a QUEUED row, so its resolution says nothing
  // about whether the run is over. Busy is therefore two things: the dispatch
  // call itself, and the run it returned, read off the live process map.
  const [dispatching, setDispatching] = useState<Set<string>>(new Set());
  const [runIds, setRunIds] = useState<Record<string, string>>({});
  const activeProcesses = useOverviewStore((s) => s.activeProcesses);
  // The capability whose payload the operator is editing. Nothing is dispatched
  // and nothing is locked while this is set.
  const [prompting, setPrompting] = useState<PersonaCapability | null>(null);

  const isRunLive = (ucId: string): boolean => {
    const runId = runIds[ucId];
    const proc = runId ? activeProcesses[`execution:${runId}`] : undefined;
    return proc !== undefined && LIVE_STATUSES.has(proc.status);
  };

  /** The capability's declared run input, serialized. Charters keep it in
   *  `spec.sampleInput`, legacy design-context use cases in `sample_input`. */
  const sampleFor = useCallback((uc: PersonaCapability): string | undefined => {
    const sample = uc.charter ? specParameterValues(uc.charter.spec) : uc.raw?.sample_input;
    return sample != null ? JSON.stringify(sample) : undefined;
  }, []);

  const run = useCallback(async (uc: PersonaCapability, input: string | undefined) => {
    const setBusy = (on: boolean) => setDispatching((prev) => {
      const next = new Set(prev);
      if (on) next.add(uc.id); else next.delete(uc.id);
      return next;
    });
    setBusy(true);
    try {
      const row = await executePersona(personaId, undefined, input, uc.id);
      setRunIds((prev) => ({ ...prev, [uc.id]: row.id }));
    } catch (err) {
      logger.error('Quick-execute failed', { error: err, useCaseId: uc.id });
      // The run did NOT start, so the sigil must be pressable again (the
      // dispatch flag clears below). Releasing it in silence made a failed
      // dispatch look identical to a run that started and finished, so the
      // toast is what tells the operator it was not.
      toastCatch('MonitorCapabilities:quickExecute')(err);
    } finally {
      setBusy(false);
    }
  }, [personaId]);

  return (
    <>
    {prompting && (
      <MonitorRunSheet
        title={prompting.title}
        sample={sampleFor(prompting)}
        onCancel={() => setPrompting(null)}
        onRun={async (input) => {
          const uc = prompting;
          setPrompting(null);
          await run(uc, input);
        }}
      />
    )}
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}
    >
      {useCases.map((uc) => {
        const isExecuting = dispatching.has(uc.id) || isRunLive(uc.id);
        const runnable = uc.mode !== 'non_executable' && uc.health !== 'disabled';
        const disabled = isExecuting || !runnable;
        return (
          <button
            key={uc.id}
            type="button"
            disabled={disabled}
            onClick={() => setPrompting(uc)}
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
                <CapabilitySigil
                  uc={uc}
                  healthLabel={healthMeta[uc.health].label}
                  cvdSafe={cvdSafe}
                  size={68}
                />
              </div>
              {isExecuting ? (
                <>
                  {prefersReducedMotion ? (
                    // Static "in-progress" affordance — a steady ring at the pulse's mid opacity.
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-full border-2 border-primary/55 opacity-80"
                    />
                  ) : (
                    <motion.span
                      aria-hidden
                      className="absolute inset-0 rounded-full border-2 border-primary/55"
                      animate={{ opacity: [0.25, 0.8, 0.25], scale: [0.9, 1.05, 0.9] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  )}
                  <Loader2 className="absolute w-5 h-5 text-primary animate-spin motion-reduce:animate-none" />
                </>
              ) : runnable ? (
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/0 opacity-0 group-hover:opacity-100 group-hover:bg-background/55 transition-all">
                  <Play className="w-5 h-5 text-primary fill-primary/30" />
                </span>
              ) : null}
            </div>
            <span className="typo-caption text-foreground/90 text-center line-clamp-2">
              {uc.title}
            </span>
            <span className={`typo-caption ${isExecuting ? 'text-primary' : runnable ? 'text-foreground/55' : 'text-foreground/35'}`}>
              {isExecuting ? t.monitor.executing : runnable ? t.monitor.run : uc.connector}
            </span>
          </button>
        );
      })}
    </div>
    </>
  );
}
