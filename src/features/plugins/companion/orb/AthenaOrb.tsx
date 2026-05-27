import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '../companionStore';
import type { HoldToTalk } from '../useHoldToTalk';
import { subscribeAudioLevel } from '../audioLevel';
import { AthenaAvatar, type AthenaState } from '../AthenaAvatar';

/**
 * Athena's floating, dockable orb — the minimized presence that lives as an
 * overlay above app content (rendered only while `companionState === 'minimized'`).
 *
 * One pointer surface, three gestures, discriminated by movement + time:
 *   - **Tap** (down → up, no move, no hold) → opens the full chat panel.
 *   - **Hold** (≥ {@link HOLD_MS} in place) → arms dictation; on release the
 *     transcript fires a voice turn via `useHoldToTalk` (no panel needed).
 *   - **Drag** (move past {@link DRAG_THRESHOLD}) → relocates the orb; on drop
 *     the X position snaps to the nearest side edge and persists. A drag
 *     cancels any armed hold so moving never accidentally records.
 *
 * Position is stored as viewport fractions (`companionOrbPos`) and resolved
 * to pixels here, so it survives window resizes and app restarts.
 */
export const ORB_SIZE = 60;
const MARGIN = 16;
const HOLD_MS = 220;
const DRAG_THRESHOLD = 6;

interface Viewport {
  w: number;
  h: number;
}

function readViewport(): Viewport {
  return { w: window.innerWidth, h: window.innerHeight };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Resolve stored fractions → clamped top-left pixels for the current viewport. */
function fractionToPx(x: number, y: number, vp: Viewport): { left: number; top: number } {
  const freeW = Math.max(vp.w - ORB_SIZE, 0);
  const freeH = Math.max(vp.h - ORB_SIZE, 0);
  return {
    left: clamp(x * freeW, MARGIN, freeW - MARGIN),
    top: clamp(y * freeH, MARGIN, freeH - MARGIN),
  };
}

export function AthenaOrb({ talk }: { talk: HoldToTalk }) {
  const { t, tx } = useTranslation();
  const setState = useCompanionStore((s) => s.setState);
  const streaming = useCompanionStore((s) => s.streaming);
  const pendingPlayback = useCompanionStore((s) => s.pendingPlayback);
  // Async-UX phase 3: how many background tasks are in flight. Returns a
  // primitive so the orb only re-renders when the count actually changes.
  const runningTaskCount = useCompanionStore((s) => {
    let n = 0;
    for (const j of Object.values(s.jobsById)) {
      if (j.status === 'running' || j.status === 'queued') n += 1;
    }
    for (const j of Object.values(s.inTurnToolJobs)) {
      if (j.status === 'running' || j.status === 'queued') n += 1;
    }
    return n;
  });
  const orbPos = useSystemStore((s) => s.companionOrbPos);
  const setOrbPos = useSystemStore((s) => s.setCompanionOrbPos);

  const { talking, interimText, start: startTalk, stop: stopTalk, abort: abortTalk } = talk;
  const reduceMotion = useReducedMotion();
  const setOrbOpenOrigin = useCompanionStore((s) => s.setOrbOpenOrigin);
  // Guided-walkthrough drive: while a walkthrough is active the orb is steered
  // by the runner (`orbGuideTarget`), not the user.
  const orbGuideTarget = useCompanionStore((s) => s.orbGuideTarget);
  const guideActive = useCompanionStore((s) => s.activeWalkthrough != null);

  const [vp, setVp] = useState<Viewport>(() => readViewport());
  useEffect(() => {
    const onResize = () => setVp(readViewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Transient drag position (px). Null when not dragging — we render from the
  // persisted fractions instead.
  const [dragPx, setDragPx] = useState<{ left: number; top: number } | null>(null);

  const resolved = fractionToPx(orbPos.x, orbPos.y, vp);
  const left = dragPx?.left ?? resolved.left;
  const top = dragPx?.top ?? resolved.top;

  // While a guided walkthrough is driving the orb, a step's target position
  // wins and the orb glides to it (spring); otherwise it follows the drag /
  // docked position instantly. Under reduced motion the glide becomes a jump.
  const renderLeft = orbGuideTarget
    ? clamp(orbGuideTarget.left, MARGIN, Math.max(vp.w - ORB_SIZE, 0) - MARGIN)
    : left;
  const renderTop = orbGuideTarget
    ? clamp(orbGuideTarget.top, MARGIN, Math.max(vp.h - ORB_SIZE, 0) - MARGIN)
    : top;
  const glideTransition =
    orbGuideTarget && !reduceMotion
      ? ({ type: 'spring', stiffness: 220, damping: 28 } as const)
      : ({ duration: 0 } as const);
  // Docked on the left half? Caption + badges flip to the orb's right.
  const dockedLeft = renderLeft + ORB_SIZE / 2 < vp.w / 2;

  const startRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const talkArmedRef = useRef(false);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Ignore non-primary buttons (right-click etc.).
      if (e.button !== 0) return;
      // The orb is driven by Athena during a guided walkthrough — ignore user
      // grab/hold/tap so the glide isn't fought (Stop/Skip live on the caption).
      if (guideActive) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      startRef.current = { x: e.clientX, y: e.clientY, left, top };
      draggingRef.current = false;
      talkArmedRef.current = false;
      clearHoldTimer();
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = null;
        if (draggingRef.current) return;
        talkArmedRef.current = true;
        startTalk();
      }, HOLD_MS);
    },
    [left, top, clearHoldTimer, startTalk, guideActive],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const start = startRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!draggingRef.current && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        draggingRef.current = true;
        clearHoldTimer();
        // Moving cancels an armed talk session so a drag never records.
        if (talkArmedRef.current) {
          abortTalk();
          talkArmedRef.current = false;
        }
      }
      if (draggingRef.current) {
        const freeW = Math.max(vp.w - ORB_SIZE, 0);
        const freeH = Math.max(vp.h - ORB_SIZE, 0);
        setDragPx({
          left: clamp(start.left + dx, 0, freeW),
          top: clamp(start.top + dy, 0, freeH),
        });
      }
    },
    [vp.w, vp.h, clearHoldTimer, abortTalk],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (err) {
        // Capture may already be released (e.g. pointercancel raced us).
        silentCatch('companion_orb_release_capture')(err);
      }
      clearHoldTimer();
      startRef.current = null;

      if (draggingRef.current) {
        // Snap X to the nearer side edge; keep Y where it was dropped.
        const cur = dragPx ?? { left, top };
        const freeW = Math.max(vp.w - ORB_SIZE, 0);
        const freeH = Math.max(vp.h - ORB_SIZE, 0);
        const snappedLeft =
          cur.left + ORB_SIZE / 2 < vp.w / 2 ? MARGIN : freeW - MARGIN;
        setOrbPos({
          x: freeW > 0 ? snappedLeft / freeW : 1,
          y: freeH > 0 ? clamp(cur.top, MARGIN, freeH - MARGIN) / freeH : 0.82,
        });
        setDragPx(null);
        draggingRef.current = false;
        return;
      }

      if (talkArmedRef.current) {
        stopTalk();
        talkArmedRef.current = false;
        return;
      }

      // Plain tap — open the full chat panel, recording the orb's center so
      // the panel can morph out from here.
      setOrbOpenOrigin({ x: left + ORB_SIZE / 2, y: top + ORB_SIZE / 2 });
      setState('open');
    },
    [dragPx, left, top, vp.w, vp.h, clearHoldTimer, setOrbPos, stopTalk, setState, setOrbOpenOrigin],
  );

  const onPointerCancel = useCallback(() => {
    clearHoldTimer();
    startRef.current = null;
    if (talkArmedRef.current) {
      abortTalk();
      talkArmedRef.current = false;
    }
    setDragPx(null);
    draggingRef.current = false;
  }, [clearHoldTimer, abortTalk]);

  useEffect(() => () => clearHoldTimer(), [clearHoldTimer]);

  const hasUnreadPlayback = pendingPlayback != null && !pendingPlayback.played;
  // Background tasks running (even when no turn is streaming) put the orb
  // in the "working" posture — it borrows the `thinking` avatar and grows
  // perimeter dots, one per in-flight task, so the user sees parallel work
  // happening while the panel is minimized.
  const working = runningTaskCount > 0;
  const avatarState: AthenaState =
    talking || streaming || working ? 'thinking' : hasUnreadPlayback ? 'speaking' : 'idle';
  const speaking = avatarState === 'speaking';

  // Perimeter task dots: up to 5 pulsing dots arced across the orb's top,
  // one per running/queued task. Positioned on a circle just outside the
  // orb so they read as a halo of activity. Decorative (aria-hidden) —
  // the count is also announced via the orb's aria-label.
  const shownDots = Math.min(runningTaskCount, 5);
  const taskDots = Array.from({ length: shownDots }, (_, i) => {
    const angleDeg = shownDots === 1 ? -90 : -132 + (84 * i) / (shownDots - 1);
    const a = (angleDeg * Math.PI) / 180;
    const R = ORB_SIZE / 2 + 9;
    return {
      left: ORB_SIZE / 2 + R * Math.cos(a),
      top: ORB_SIZE / 2 + R * Math.sin(a),
      delay: i * 0.16,
    };
  });

  const caption = talking && interimText ? interimText : null;

  // Audio-reactive glow: while a spoken reply plays, drive the bloom's
  // opacity + scale from the live TTS level (tapped via the shared
  // analyser in audioLevel.ts). Imperative — we mutate the glow node in the
  // subscription callback rather than re-rendering at frame rate. Skipped
  // under reduced motion (the glow stays a static bloom there).
  const glowRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (reduceMotion || !speaking) return;
    return subscribeAudioLevel((lvl) => {
      const el = glowRef.current;
      if (!el) return;
      el.style.opacity = String(0.22 + lvl * 0.65);
      el.style.transform = `scale(${1 + lvl * 0.55})`;
    });
  }, [reduceMotion, speaking]);

  // Message reaction: when a reply finishes (streaming true → false), bump a
  // nonce so AthenaAvatar plays the one-shot `message` clip, and glow the orb
  // border in the theme color for that single loop. The avatar flips
  // `messageActive` on at clip start and off after one loop (and never fires
  // under reduced motion, so the glow stays calm there too).
  const [messageNonce, setMessageNonce] = useState(0);
  const [messageActive, setMessageActive] = useState(false);
  const prevStreamingRef = useRef(streaming);
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    if (wasStreaming && !streaming) setMessageNonce((n) => n + 1);
  }, [streaming]);

  return (
    <motion.div
      className="group pointer-events-auto absolute select-none touch-none"
      style={{ width: ORB_SIZE, height: ORB_SIZE }}
      initial={false}
      animate={{ left: renderLeft, top: renderTop }}
      transition={glideTransition}
    >
      {/* Interim-dictation caption, flips to whichever side has room. */}
      {caption && (
        <div
          className={`absolute top-1/2 -translate-y-1/2 max-w-[220px] px-3 py-1.5 rounded-card bg-background/95 border border-primary/30 shadow-elevation-3 typo-caption text-foreground/90 truncate ${
            dockedLeft ? 'left-full ml-2' : 'right-full mr-2'
          }`}
        >
          {caption}
        </div>
      )}

      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        data-testid="companion-orb"
        aria-pressed={talking}
        className={`relative w-full h-full rounded-full overflow-visible cursor-grab active:cursor-grabbing focus-ring transition-transform ${
          talking
            ? `ring-2 ring-primary/60 ${reduceMotion ? '' : 'animate-pulse'}`
            : reduceMotion
              ? ''
              : 'hover:scale-105'
        }`}
        title={t.plugins.companion.orb_talk_hint}
        aria-label={
          talking
            ? t.plugins.companion.footer_listening
            : working
              ? tx(
                  runningTaskCount === 1
                    ? t.plugins.companion.tasks_running_one
                    : t.plugins.companion.tasks_running_other,
                  { count: runningTaskCount },
                )
              : t.plugins.companion.orb_talk_hint
        }
      >
        {/* Speaking glow — a bloom while a spoken reply plays. When motion
            is allowed it's audio-reactive: the ref'd node's opacity + scale
            are driven from the live TTS level (see the effect above). Under
            reduced motion it's a static bloom. */}
        {speaking &&
          (reduceMotion ? (
            <span aria-hidden className="absolute -inset-1.5 rounded-full bg-primary/30 blur-md" />
          ) : (
            <span
              ref={glowRef}
              aria-hidden
              className="absolute -inset-1.5 rounded-full bg-primary/40 blur-md"
              style={{ opacity: 0.3, transform: 'scale(1)', willChange: 'opacity, transform' }}
            />
          ))}
        {/* Message-reaction glow — theme-color border pulse while the
            one-shot `message` clip plays (one loop). */}
        {messageActive && (
          <span aria-hidden className="absolute -inset-1.5 rounded-full bg-primary/55 blur-md animate-pulse" />
        )}
        <span
          className={`absolute inset-0 rounded-full overflow-hidden shadow-elevation-3 bg-primary/10 transition-[box-shadow] ${
            messageActive ? 'ring-2 ring-primary' : 'ring-1 ring-primary/25'
          }`}
        >
          <AthenaAvatar
            state={avatarState}
            fill
            className="absolute inset-0"
            messageNonce={messageNonce}
            onMessageActiveChange={setMessageActive}
          />
        </span>
        {talking && (
          <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center ring-2 ring-background">
            <span className="w-1.5 h-1.5 rounded-full bg-background animate-pulse" />
          </span>
        )}
        {/* Async-UX phase 3: perimeter task dots — one per in-flight task. */}
        {shownDots > 0 && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            data-testid="companion-orb-task-dots"
            data-task-count={runningTaskCount}
          >
            {taskDots.map((d, i) => (
              <span
                key={i}
                className={`absolute w-2 h-2 rounded-full bg-blue-400 ring-2 ring-background shadow-elevation-1 ${
                  reduceMotion ? '' : 'animate-pulse'
                }`}
                style={{
                  left: d.left,
                  top: d.top,
                  transform: 'translate(-50%, -50%)',
                  animationDelay: `${d.delay}s`,
                }}
              />
            ))}
          </span>
        )}
      </button>

      {/* Dismiss → hide the orb (collapsed). Hover-revealed. */}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setState('collapsed');
        }}
        data-testid="companion-orb-dismiss"
        className="pointer-events-auto absolute -top-1 -right-1 w-5 h-5 rounded-full bg-background border border-primary/20 text-foreground hover:bg-secondary flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shadow-elevation-2"
        title={t.plugins.companion.orb_dismiss}
        aria-label={t.plugins.companion.orb_dismiss}
      >
        <X className="w-3 h-3" />
      </button>
    </motion.div>
  );
}
