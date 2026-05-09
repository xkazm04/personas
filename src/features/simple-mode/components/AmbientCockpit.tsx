/**
 * AmbientCockpit — full-screen, always-on Simple Mode surface.
 *
 * Auto-rotates between MosaicVariant (calm) and InboxVariant (attention)
 * driven by `useUnifiedInbox` severity. Designed for second monitors,
 * kitchen tablets, and Stream-Deck-style displays — a "Nest thermostat for
 * your AI fleet" surface.
 *
 * Activation: read from `simpleModeSlice.ambientMode` OR a `#ambient` URL
 * hash (so a popped-out Tauri window can land directly in this view).
 *
 * Mounted at App root so it overlays everything (including the sidebar).
 * Esc exits. Auto-rotation is suspended when the user has just interacted.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useUnifiedInbox } from '../hooks/useUnifiedInbox';

const MosaicVariant = lazy(() => import('./variants/MosaicVariant'));
const InboxVariant = lazy(() => import('./variants/InboxVariant'));

/** How often the wall-clock display ticks. */
const CLOCK_TICK_MS = 30_000;

/** Idle delay before auto-rotation resumes after manual interaction. */
const INTERACTION_RESUME_MS = 30_000;

/** Severity threshold that flips the rotation to Inbox. Critical or warning
 *  items push the inbox forward; pure-info inbox items stay on Mosaic. */
type RotationFace = 'mosaic' | 'inbox';

function deriveFace(
  criticalCount: number,
  warningCount: number,
): RotationFace {
  return criticalCount > 0 || warningCount > 0 ? 'inbox' : 'mosaic';
}

function useAmbientHashSync() {
  const { ambientMode, setAmbientMode } = useSystemStore(
    useShallow((s) => ({
      ambientMode: s.ambientMode,
      setAmbientMode: s.setAmbientMode,
    })),
  );

  // On first mount, honor `#ambient` in the URL (so a popped-out window
  // boots directly into ambient mode).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash === '#ambient' && !ambientMode) {
      setAmbientMode(true);
    }
    // We deliberately do NOT depend on ambientMode — we only want this once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ambientMode;
}

/**
 * The chrome bar shown at the top of ambient mode — minimal: clock,
 * fleet-status pill, and an exit button. Designed to fade into the
 * background so the variant body dominates.
 */
function AmbientChrome({
  face,
  criticalCount,
  warningCount,
  onExit,
  paused,
}: {
  face: RotationFace;
  criticalCount: number;
  warningCount: number;
  onExit: () => void;
  paused: boolean;
}) {
  const { t, tx } = useTranslation();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const totalAttention = criticalCount + warningCount;

  let StatusIcon = CheckCircle2;
  let statusTone: 'calm' | 'warning' | 'critical' = 'calm';
  let statusText = t.simple_mode.ambient_status_calm;

  if (criticalCount > 0) {
    StatusIcon = AlertTriangle;
    statusTone = 'critical';
    statusText = tx(t.simple_mode.ambient_status_critical, { n: criticalCount });
  } else if (warningCount > 0) {
    StatusIcon = Activity;
    statusTone = 'warning';
    statusText =
      warningCount === 1
        ? tx(t.simple_mode.ambient_status_attention_one, { n: warningCount })
        : tx(t.simple_mode.ambient_status_attention, { n: warningCount });
  }

  const toneClass =
    statusTone === 'critical'
      ? 'simple-accent-rose-soft simple-accent-rose-border simple-accent-rose-text'
      : statusTone === 'warning'
        ? 'simple-accent-amber-soft simple-accent-amber-border simple-accent-amber-text'
        : 'simple-accent-emerald-soft simple-accent-emerald-border simple-accent-emerald-text';

  const timeLabel = now.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <header className="absolute top-0 left-0 right-0 z-10 flex items-center gap-4 px-6 py-3 bg-gradient-to-b from-background/85 to-transparent backdrop-blur-sm pointer-events-none">
      <div className="flex flex-col leading-tight pointer-events-auto">
        <span className="typo-display simple-display text-foreground/95 tabular-nums">
          {timeLabel}
        </span>
        <span className="typo-caption text-foreground/55">
          {paused
            ? t.simple_mode.ambient_rotation_paused
            : t.simple_mode.ambient_rotation_auto}
          {' · '}
          {face === 'mosaic' ? t.simple_mode.tab_mosaic : t.simple_mode.tab_inbox}
        </span>
      </div>

      <div
        className={`mx-auto flex items-center gap-2 px-4 py-2 rounded-card border ${toneClass} pointer-events-auto`}
        role="status"
        aria-live="polite"
      >
        <StatusIcon className="w-4 h-4" />
        <span className="typo-caption font-medium">{statusText}</span>
        {totalAttention > 0 && criticalCount > 0 && warningCount > 0 ? (
          <span className="typo-caption text-foreground/55">
            +{warningCount}
          </span>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onExit}
        aria-label={t.simple_mode.ambient_exit}
        title={t.simple_mode.ambient_exit}
        className="w-10 h-10 rounded-xl flex items-center justify-center text-foreground/60 hover:text-foreground hover:bg-foreground/[0.06] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 pointer-events-auto"
      >
        <X className="w-5 h-5" />
      </button>
    </header>
  );
}

/**
 * Top-level ambient surface. Reads `ambientMode` from the system store and
 * renders nothing when off. When on, renders a fixed-position fullscreen
 * overlay with auto-rotating Mosaic/Inbox variants.
 */
export function AmbientCockpit() {
  const { t } = useTranslation();
  const ambientMode = useAmbientHashSync();
  const setAmbientMode = useSystemStore((s) => s.setAmbientMode);

  // useUnifiedInbox is called only when ambient mode is active — the
  // component returns null before reaching this hook in the inactive case.
  // To keep hook order stable we always call it; it's cheap (memoized).
  const items = useUnifiedInbox();

  const { criticalCount, warningCount } = useMemo(() => {
    let c = 0;
    let w = 0;
    for (const item of items) {
      if (item.severity === 'critical') c += 1;
      else if (item.severity === 'warning') w += 1;
    }
    return { criticalCount: c, warningCount: w };
  }, [items]);

  // Track the last user interaction. Auto-rotation is suspended for
  // INTERACTION_RESUME_MS after any pointer/keypress so the user can read
  // an inbox item without the screen flipping out from under them.
  const [lastInteraction, setLastInteraction] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!ambientMode) return;
    const onInteract = () => {
      setLastInteraction(Date.now());
      setPaused(true);
    };
    window.addEventListener('pointerdown', onInteract, { passive: true });
    window.addEventListener('keydown', onInteract);
    return () => {
      window.removeEventListener('pointerdown', onInteract);
      window.removeEventListener('keydown', onInteract);
    };
  }, [ambientMode]);

  useEffect(() => {
    if (!paused) return;
    const id = setTimeout(() => setPaused(false), INTERACTION_RESUME_MS);
    return () => clearTimeout(id);
  }, [paused, lastInteraction]);

  // Derived face: the severity-driven rotation target. While paused we keep
  // whatever face was visible at pause time — stored in a ref so we don't
  // re-trigger rotation when severity drops to zero mid-read.
  const desiredFace = deriveFace(criticalCount, warningCount);
  const lastFaceRef = useRef<RotationFace>(desiredFace);
  if (!paused) lastFaceRef.current = desiredFace;
  const face = lastFaceRef.current;

  // Esc exits ambient mode; clear the URL hash so a refresh doesn't re-enter.
  useEffect(() => {
    if (!ambientMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAmbientMode(false);
        if (window.location.hash === '#ambient') {
          history.replaceState(null, '', window.location.pathname + window.location.search);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ambientMode, setAmbientMode]);

  if (!ambientMode) return null;

  const onExit = () => {
    setAmbientMode(false);
    if (typeof window !== 'undefined' && window.location.hash === '#ambient') {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  };

  const variant = face === 'inbox' ? <InboxVariant /> : <MosaicVariant />;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-background text-foreground simple-surface flex flex-col"
      role="region"
      aria-label={t.simple_mode.ambient_pop_out}
    >
      <AmbientChrome
        face={face}
        criticalCount={criticalCount}
        warningCount={warningCount}
        onExit={onExit}
        paused={paused}
      />
      <main className="flex-1 min-h-0 overflow-hidden pt-16">
        <Suspense
          fallback={
            <div className="h-full flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          }
        >
          {variant}
        </Suspense>
      </main>
    </div>
  );
}
