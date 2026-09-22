/**
 * AthenaChatPanel — Athena's chat window.
 *
 * Always mounted; only the visible shell is gated on `state === 'open'`, so
 * effects that must survive a closed panel (approval reconcile, the orb's
 * `explain_in_cockpit` flow) live in `useAthenaChatShellEffects` at this level
 * rather than inside the body.
 *
 * Geometry is deliberate and lives in `athenaChatGeometry.ts`: the panel is
 * anchored bottom-left and clamped so it can never reach up under the app's
 * title bar, and its width is animated by motion so compact/expanded reads as
 * a resize rather than a snap between two layouts.
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { Collapse } from '@/features/shared/components/display/Collapse';
import { useSystemStore } from '@/stores/systemStore';
import { AthenaAvatar } from '../AthenaAvatar';
import { DailyGoalsBar } from '../DailyGoalsBar';
import { DevOpLedger } from '../DevOpLedger';
import { FleetBoldnessDial } from '../FleetBoldnessDial';
import { WakeCadence } from '../WakeCadence';
import { useCompanionStore } from '../companionStore';
import { AthenaChatBody } from './AthenaChatBody';
import { AthenaChatHeader, type ToolStrip } from './AthenaChatHeader';
import { PANEL_HEIGHT_PX, PANEL_MAX_HEIGHT } from './athenaChatGeometry';
import { useAthenaChatEngine } from './athenaChatEngine';
import { useChatMount } from './athenaChatMount';
import { usePanelMotion } from './athenaChatMorph';
import { useAthenaChatShellEffects } from './athenaChatShell';

export default function AthenaChatPanel() {
  const { t } = useTranslation();
  const state = useCompanionStore((s) => s.state);
  const streaming = useCompanionStore((s) => s.streaming);
  // TTS audio synthesized AND not yet finished. Until a `speaking` clip ships
  // the avatar falls back to the idle loop — this value is the signal carrier,
  // not the visual.
  const isSpeaking = useCompanionStore(
    (s) => !!s.pendingPlayback?.audioUrl && !s.pendingPlayback.played,
  );
  const autonomousMode = useSystemStore((s) => s.companionAutonomousMode);
  const devMode = useSystemStore((s) => s.companionDevMode);
  const devModeAvailable = useCompanionStore((s) => s.devModeAvailable);
  const compact = useSystemStore((s) => s.companionPanelCompact);
  // While the Fleet grid overlay (a z-200 portal) is open the chat must float
  // ABOVE it — otherwise tapping the orb opens the panel behind the overlay
  // ("orb disappears, no chat") and its decision/approval UI is unreachable.
  // Mirrors the orb's own z-[210] lift; the panel goes one above.
  const fleetGridOpen = useSystemStore((s) => s.fleetGridOpen);

  // Which tool strip is expanded under the header. An accordion on purpose —
  // session-scoped, so every panel open starts clean.
  const [expandedStrip, setExpandedStrip] = useState<ToolStrip | null>(null);

  useAthenaChatShellEffects(streaming);
  // The engine listens whether or not the window is up — see `athenaChatEngine`
  // for why that placement is load-bearing (an orb-initiated turn had nothing
  // consuming it while the panel was closed).
  const engine = useAthenaChatEngine();
  const isOpen = state === 'open';
  const motionProps = usePanelMotion(compact);
  const mount = useChatMount(isOpen, motionProps.settleMs);

  return (
    <AnimatePresence
      onExitComplete={() => useCompanionStore.getState().setOrbOpenOrigin(null)}
    >
      {isOpen && (
        <motion.div
          key="companion-panel"
          initial={motionProps.initial}
          animate={motionProps.animate}
          exit={motionProps.exit}
          transition={motionProps.transition}
          style={{
            ...motionProps.style,
            height: PANEL_HEIGHT_PX,
            maxHeight: PANEL_MAX_HEIGHT,
          }}
          className={`fixed bottom-12 left-4 ${
            fleetGridOpen ? 'z-[220]' : 'z-[60]'
          } flex flex-col rounded-card bg-background/95 backdrop-blur-md border border-foreground/10 shadow-elevation-4 overflow-hidden ${
            autonomousMode ? 'companion-autonomous' : ''
          }`}
          role="region"
          aria-label={t.plugins.companion.panel_label}
          data-testid="companion-panel"
          data-companion-compact={compact ? 'true' : 'false'}
          data-companion-streaming={streaming ? 'true' : 'false'}
          data-companion-body-ready={mount.ready ? 'true' : 'false'}
          data-companion-chrome-ready={mount.chromeReady ? 'true' : 'false'}
        >
          {/* Watermark layer: the avatar fills the panel at low opacity and
              behaves as living wallpaper. Its poster frame is
              athena_baseline.jpg, so the visual chain is continuous from
              "static still" → "idle loop" → "thinking loop".
              pointer-events-none via -z-10 so it never steals clicks. */}
          {mount.chromeReady && (
            <AthenaAvatar
              fill
              state={isSpeaking ? 'speaking' : streaming ? 'thinking' : 'idle'}
              className="absolute inset-0 -z-10 opacity-[0.05]"
            />
          )}
          <AthenaChatHeader
            expandedStrip={expandedStrip}
            onToggleStrip={(strip) =>
              setExpandedStrip((cur) => (cur === strip ? null : strip))
            }
          />
          {/* Strips animate open/closed rather than blinking in and out — each
              one changes the panel's whole vertical rhythm, and `Collapse`
              unmounts on close so nothing keeps polling behind a shut row. */}
          <Collapse open={autonomousMode && expandedStrip === 'cadence'} unmountWhenClosed className="shrink-0">
            <WakeCadence />
          </Collapse>
          <Collapse open={autonomousMode && expandedStrip === 'boldness'} unmountWhenClosed className="shrink-0">
            <FleetBoldnessDial />
          </Collapse>
          <Collapse open={devModeAvailable && devMode} unmountWhenClosed className="shrink-0">
            <DevOpLedger />
          </Collapse>
          <Collapse open={devModeAvailable && expandedStrip === 'goals'} unmountWhenClosed className="shrink-0">
            <DailyGoalsBar />
          </Collapse>
          <AthenaChatBody
            compact={compact}
            engine={engine}
            ready={mount.ready}
            chromeReady={mount.chromeReady}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
