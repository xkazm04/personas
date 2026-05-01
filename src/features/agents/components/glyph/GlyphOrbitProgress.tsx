import { motion } from "framer-motion";

interface GlyphOrbitProgressProps {
  size: number;
  /** Seconds for one full revolution. Defaults to 60s — matches the user's
   *  expectation that early build feedback is gradual rather than frantic. */
  duration?: number;
}

/** Slow orbital indicator drawn around the sigil during the build phase.
 *  A faint dashed track plus a brighter arc that grows from 0° to 360° over
 *  `duration` seconds, then resets — provides constant motion when the
 *  petals themselves are quiet. */
export function GlyphOrbitProgress({ size, duration = 60 }: GlyphOrbitProgressProps) {
  const center = size / 2;
  const radius = size * 0.44 + 14;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden>
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
          animate={{ strokeDashoffset: 0 }}
          transition={{ duration, ease: "linear", repeat: Infinity }}
          style={{ transformOrigin: `${center}px ${center}px`, transform: "rotate(-90deg)" }}
          filter="drop-shadow(0 0 6px rgba(96,165,250,0.6))"
        />
      </svg>
      {/* Comet head — bright dot riding the arc tip */}
      <motion.div
        className="absolute"
        style={{ width: size, height: size, left: 0, top: 0, transformOrigin: `${center}px ${center}px` }}
        initial={{ rotate: -90 }}
        animate={{ rotate: 270 }}
        transition={{ duration, ease: "linear", repeat: Infinity }}
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
    </div>
  );
}
