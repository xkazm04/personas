import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

interface GlyphOrbitProgressProps {
  size: number;
  /** Seconds for one full revolution. Defaults to 60s — matches the user's
   *  expectation that early build feedback is gradual rather than frantic. */
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
 *  Implementation note: we drive the arc + comet via declarative motion
 *  props (not `useAnimation` controls) and force a remount of the
 *  `motion.circle` / `motion.div` whenever mode changes by including
 *  `mode` in the React `key`. This guarantees a fresh animation cycle
 *  starts from the keyframe[0] value every time loading kicks off — the
 *  imperative controls path was leaving the arc snapped to its
 *  destination value (0) on mode transitions, producing the
 *  "full from the start" bug. */
export function GlyphOrbitProgress({
  size,
  duration = 60,
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

  // Declarative animation per mode. The keyframe array `[circumference, 0]`
  // forces each loop iteration to start from invisible (circumference) and
  // finish at full (0). For completing mode, a single target (0) lets
  // framer-motion interpolate smoothly from whatever value the loading
  // mode left behind.
  const arcAnimate =
    mode === "loading"
      ? { strokeDashoffset: [circumference, 0] }
      : { strokeDashoffset: 0 };
  const arcTransition =
    mode === "loading"
      ? { duration, ease: "linear" as const, repeat: Infinity, repeatType: "loop" as const }
      : { duration: COMPLETION_DURATION_S, ease: [0.16, 1, 0.3, 1] as const };

  const cometAnimate =
    mode === "loading" ? { rotate: [-90, 270] } : { rotate: 270 };
  const cometTransition = arcTransition;

  return (
    <motion.div
      className="absolute inset-0 pointer-events-none"
      aria-hidden
      initial={{ opacity: 1 }}
      animate={{ opacity: wrapperOpacity }}
      transition={wrapperTransition}
    >
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
        {/* Progress arc — keyed by mode so each loading start is a fresh
            mount with the keyframe[0] (=circumference, invisible) as
            initial. Without the key remount, switching back from
            completing → off → loading would skip the initial state. */}
        <motion.circle
          key={`arc-${mode}`}
          cx={center} cy={center} r={radius}
          fill="none"
          stroke="rgba(96,165,250,0.55)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={arcAnimate}
          transition={arcTransition}
          style={{ transformOrigin: `${center}px ${center}px`, transform: "rotate(-90deg)" }}
          filter="drop-shadow(0 0 6px rgba(96,165,250,0.6))"
        />
      </svg>
      {/* Comet head — bright dot riding the arc tip. Same key-remount trick. */}
      <motion.div
        key={`comet-${mode}`}
        className="absolute"
        style={{ width: size, height: size, left: 0, top: 0, transformOrigin: `${center}px ${center}px` }}
        initial={{ rotate: -90 }}
        animate={cometAnimate}
        transition={cometTransition}
      >
        <span
          className="absolute rounded-full bg-primary"
          style={{
            left: center + radius - 4, top: center - 4,
            width: 8, height: 8,
            boxShadow: "0 0 14px rgba(96,165,250,0.95), 0 0 26px rgba(96,165,250,0.5)",
          }}
        />
      </motion.div>
    </motion.div>
  );
}
