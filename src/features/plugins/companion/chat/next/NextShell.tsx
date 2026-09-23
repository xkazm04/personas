/**
 * NextShell — the full-size modal the owner picked from Handover, with the
 * border strategy asked for on top of it: the frame is a conic gradient of the
 * live workforce (see `frameGradient`), its glow breathes while Athena works
 * and flares once when something new starts waiting on the operator.
 *
 * It owns what every variant needs around its own layout: the scrim, the
 * frame, the header, and the Brain Viewer overlay.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { BrainViewer } from '../../BrainViewer';
import { useCompanionStore } from '../../companionStore';
import { NextHeader } from './NextHeader';
import { frameGradient } from './tones';
import type { LayerApi } from './useLayer';
import type { Workforce } from './useWorkforce';

export function NextShell({
  workforce,
  layer,
  onInterrupt,
  lifted,
  children,
}: {
  workforce: Workforce;
  layer: LayerApi;
  onInterrupt: () => void;
  /** Float above the Fleet grid overlay, as the classic panel does. */
  lifted: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const streaming = useCompanionStore((s) => s.streaming);
  const brainOpen = useCompanionStore((s) => s.brainView.open);
  const flare = useFlareOnRise(workforce.counts.waiting);

  return (
    <div className={`fixed inset-0 ${lifted ? 'z-[220]' : 'z-[60]'} pointer-events-none`}>
      <div
        className="absolute inset-0 bg-background/55 backdrop-blur-[2px] pointer-events-auto"
        onClick={() => useCompanionStore.getState().setState('minimized')}
        aria-hidden
      />
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
        className="athena-frame absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[46%] h-[80vh] w-[min(1360px,calc(100vw-48px))] rounded-modal shadow-elevation-4 pointer-events-auto"
        style={{ ['--athena-frame' as string]: frameGradient(workforce) }}
        data-working={streaming ? 'true' : 'false'}
        data-flare={flare ? 'true' : 'false'}
        role="region"
        aria-label={t.plugins.companion.panel_label}
        data-testid="companion-panel"
      >
        <div className="relative h-full flex flex-col rounded-[calc(var(--radius-modal,1rem)-1.5px)] bg-background/95 backdrop-blur-md overflow-hidden">
          <NextHeader
            workforce={workforce}
            onOpenWaiting={layer.toggleWork}
            onOpenModes={layer.openModes}
            onInterrupt={onInterrupt}
            waitingActive={layer.view.kind === 'work'}
            modesActive={layer.view.kind === 'modes'}
          />
          <div className="relative flex-1 min-h-0 flex">{children}</div>
          {brainOpen && (
            <BrainViewer
              onClose={() => useCompanionStore.getState().setBrainView({ open: false, kind: null, id: null })}
            />
          )}
        </div>
      </motion.div>
    </div>
  );
}

/** True for one flare cycle whenever the waiting count goes UP. */
function useFlareOnRise(count: number): boolean {
  const prev = useRef(count);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (count > prev.current) {
      setOn(true);
      const id = window.setTimeout(() => setOn(false), 1400);
      prev.current = count;
      return () => window.clearTimeout(id);
    }
    prev.current = count;
    return undefined;
  }, [count]);
  return on;
}
