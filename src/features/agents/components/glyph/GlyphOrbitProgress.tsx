import { useAnimation } from "framer-motion";
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
 *  — feels like a video-game loading bar topping out, not a hard cut. */
export function GlyphOrbitProgress({
  size,
  duration = 60,
  active = true,
}: GlyphOrbitProgressProps) {
  const center = size / 2;
  const radius = size * 0.44 + 14;
  const circumference = 2 * Math.PI * radius;

  const [mode, setMode] = useState<OrbitMode>(active ? "loading" : "off");
  const arcControls = useAnimation();
  const cometControls = useAnimation();
  const completionTimerRef = useRef<number | null>(null);

  // ── Mode transitions driven by `active` ───────────────────────────────
  // On active flipping false from `loading`, schedule a completion + fade
  // sequence then unmount. Reverting active true mid-completion cancels
  // the timer and resumes loading.
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

  // ── Drive the arc + comet imperatively per mode ───────────────────────
  // Loading uses keyframe arrays — single-target with `repeat: Infinity`
  // can no-op after the first cycle (framer-motion treats loop 2's
  // "current" as the previous loop's destination → tweens 0→0). The
  // explicit [from, to] keyframes guarantee each cycle redraws the arc
  // from invisible to full.
  //
  // Completing uses a single target so the tween picks up from the
  // current mid-cycle value and races to 360° in 400ms.
  useEffect(() => {
    if (mode === "loading") {
      void arcControls.start({
        strokeDashoffset: [circumference, 0],
        transition: { duration, ease: "linear", repeat: Infinity },
      });
      void cometControls.start({
        rotate: [-90, 270],
        transition: { duration, ease: "linear", repeat: Infinity },
      });
    } else if (mode === "completing") {
      void arcControls.start({
        strokeDashoffset: 0,
        transition: { duration: COMPLETION_DURATION_S, ease: [0.16, 1, 0.3, 1] },
      });
      void cometControls.start({
        rotate: 270,
        transition: { duration: COMPLETION_DURATION_S, ease: [0.16, 1, 0.3, 1] },
      });
    }
  }, [mode, duration, arcControls, cometControls, circumference]);

  if (mode === "off") return null;

  const wrapperOpacity = mode === "completing" ? 0 : 1;
  // Fade kicks in only after the arc completes — without the delay the
  // arc finish animation is invisible behind a parallel opacity tween.
  const wrapperTransition =
    mode === "completing"
      ? { duration: FADE_DURATION_S, delay: COMPLETION_DURATION_S, ease: "linear" as const }
      : { duration: 0.2, ease: "linear" as const };

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
        {/* Progress arc */}
        <motion.circle
          cx={center} cy={center} r={radius}
          fill="none"
          stroke="rgba(96,165,250,0.55)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={arcControls}
          style={{ transformOrigin: `${center}px ${center}px`, transform: "rotate(-90deg)" }}
          filter="drop-shadow(0 0 6px rgba(96,165,250,0.6))"
        />
      </svg>
      {/* Comet head — bright dot riding the arc tip */}
      <motion.div
        className="absolute"
        style={{ width: size, height: size, left: 0, top: 0, transformOrigin: `${center}px ${center}px` }}
        initial={{ rotate: -90 }}
        animate={cometControls}
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
