import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

interface GlyphOrbitProgressProps {
  size: number;
  /** Seconds for one full revolution. Defaults to 180s (3 min) — the
   *  build can legitimately take 1-3 minutes for non-trivial intents,
   *  and a 60s loop completing several times before the build lands
   *  reads as "stuck" even when the LLM is actively working. A longer
   *  cycle keeps the visual cue honest: motion = work, no motion =
   *  stalled. The orbit fast-forwards to 360° on completion regardless
   *  of how far through the cycle it was, so this doesn't penalise
   *  builds that finish quickly. */
  duration?: number;
  /** When true, run the slow loop. When false, transition through a
   *  brief "completing" state (arc rushes to 360°, comet to 0°, both
   *  fade out) before unmounting. Lets a quick build land cleanly
   *  rather than snapping the orbit away mid-cycle. */
  active?: boolean;
}

type OrbitMode = "loading" | "completing" | "off";

const COMPLETION_DURATION_S = 0.4;
const FADE_DURATION_S = 0.2;

/** Slow orbital indicator drawn around the sigil during the build phase.
 *  Faint dashed track + brighter arc that grows from 0° to 360° over
 *  `duration` seconds, then loops. When the build resolves early, the
 *  component fast-forwards the arc to 360° in 400ms, fades, and unmounts
 *  — feels like a video-game loading bar topping out, not a hard cut.
 *
 *  Implementation note: framer-motion's keyframe + repeat handling on
 *  SVG `strokeDashoffset` was unreliable in our setup (the arc rendered
 *  at full from the first frame, defeating the slow sweep). For the
 *  loading loop we use a plain CSS keyframe animation — guaranteed to
 *  start at the keyframe[0] value and replay each iteration. We only
 *  reach for framer-motion in completing mode where its imperative
 *  interpolation from-current-value is what we actually want. */
export function GlyphOrbitProgress({
  size,
  duration = 180,
  active = true,
}: GlyphOrbitProgressProps) {
  const center = size / 2;
  const radius = size * 0.44 + 14;
  const circumference = 2 * Math.PI * radius;

  const [mode, setMode] = useState<OrbitMode>(active ? "loading" : "off");
  const completionTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (active && mode !== "loading") {
      setMode("loading");
      return;
    }
    if (!active && mode === "loading") {
      setMode("completing");
      if (completionTimerRef.current !== null) {
        window.clearTimeout(completionTimerRef.current);
      }
      completionTimerRef.current = window.setTimeout(() => {
        completionTimerRef.current = null;
        setMode("off");
      }, (COMPLETION_DURATION_S + FADE_DURATION_S) * 1000);
    }
    return () => {
      if (completionTimerRef.current !== null) {
        window.clearTimeout(completionTimerRef.current);
        completionTimerRef.current = null;
      }
    };
  }, [active, mode]);

  if (mode === "off") return null;

  const wrapperOpacity = mode === "completing" ? 0 : 1;
  const wrapperTransition =
    mode === "completing"
      ? { duration: FADE_DURATION_S, delay: COMPLETION_DURATION_S, ease: "linear" as const }
      : { duration: 0.2, ease: "linear" as const };

  // Per-instance keyframe-name suffix so multiple GlyphOrbitProgress
  // instances on the same page don't collide on a global @keyframes
  // identifier (the circumference value differs per `size`).
  const kfId = `orbit-arc-${Math.round(circumference)}`;
  const cometKfId = `orbit-comet`;

  return (
    <motion.div
      className="absolute inset-0 pointer-events-none"
      aria-hidden
      initial={{ opacity: 1 }}
      animate={{ opacity: wrapperOpacity }}
      transition={wrapperTransition}
    >
      <style>{`
        @keyframes ${kfId} {
          0%   { stroke-dashoffset: ${circumference}; }
          100% { stroke-dashoffset: 0; }
        }
        @keyframes ${cometKfId} {
          0%   { transform: rotate(-90deg); }
          100% { transform: rotate(270deg); }
        }
      `}</style>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
        {/* Faint track */}
        <circle
          cx={center} cy={center} r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.08}
          strokeWidth={1}
          strokeDasharray="2 6"
        />
        {/* Progress arc — CSS-driven during loading; motion-driven during
            completing so the tween picks up smoothly from whatever offset
            CSS left it at. */}
        {/* Arc + glow follow the active theme's accent (was hardcoded
            blue on all 13 themes). Colours live in `style` so var()/
            color-mix resolve reliably. */}
        {mode === "loading" ? (
          <circle
            cx={center} cy={center} r={radius}
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={circumference}
            style={{
              stroke: "color-mix(in srgb, var(--primary) 55%, transparent)",
              strokeDashoffset: circumference,
              transformOrigin: `${center}px ${center}px`,
              transform: "rotate(-90deg)",
              animation: `${kfId} ${duration}s linear infinite`,
              filter: "drop-shadow(0 0 6px color-mix(in srgb, var(--primary) 60%, transparent))",
            }}
          />
        ) : (
          <motion.circle
            cx={center} cy={center} r={radius}
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={false}
            animate={{ strokeDashoffset: 0 }}
            transition={{ duration: COMPLETION_DURATION_S, ease: [0.16, 1, 0.3, 1] }}
            style={{
              stroke: "color-mix(in srgb, var(--primary) 55%, transparent)",
              transformOrigin: `${center}px ${center}px`,
              transform: "rotate(-90deg)",
              filter: "drop-shadow(0 0 6px color-mix(in srgb, var(--primary) 60%, transparent))",
            }}
          />
        )}
      </svg>
      {/* Comet head — bright dot riding the arc tip. CSS for loading,
          motion for the rush-to-finish in completing. */}
      {mode === "loading" ? (
        <div
          className="absolute"
          style={{
            width: size, height: size, left: 0, top: 0,
            transformOrigin: `${center}px ${center}px`,
            animation: `${cometKfId} ${duration}s linear infinite`,
          }}
        >
          <span
            className="absolute rounded-full bg-primary"
            style={{
              left: center + radius - 4, top: center - 4,
              width: 8, height: 8,
              boxShadow:
                "0 0 14px color-mix(in srgb, var(--primary) 95%, transparent), 0 0 26px color-mix(in srgb, var(--primary) 50%, transparent)",
            }}
          />
        </div>
      ) : (
        <motion.div
          className="absolute"
          style={{ width: size, height: size, left: 0, top: 0, transformOrigin: `${center}px ${center}px` }}
          initial={false}
          animate={{ rotate: 270 }}
          transition={{ duration: COMPLETION_DURATION_S, ease: [0.16, 1, 0.3, 1] }}
        >
          <span
            className="absolute rounded-full bg-primary"
            style={{
              left: center + radius - 4, top: center - 4,
              width: 8, height: 8,
              boxShadow:
                "0 0 14px color-mix(in srgb, var(--primary) 95%, transparent), 0 0 26px color-mix(in srgb, var(--primary) 50%, transparent)",
            }}
          />
        </motion.div>
      )}
    </motion.div>
  );
}
