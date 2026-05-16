import { useMemo } from 'react';

interface EqualizerBarsProps {
  accentColor: string;
  isPlaying: boolean;
}

const BAR_COUNT = 16;

/**
 * Decorative equalizer-style bars rendered in the now-playing card for
 * stream stations (which have no track-level progress to fill the space
 * the YT progress bar occupies). Each bar gets a randomized animation
 * duration and a negative delay so they start out of phase — the effect
 * is a busy, organic-looking strip rather than a synchronized march.
 *
 * **NOT real audio analysis.** The original direction proposed driving
 * the bars from a Web Audio AnalyserNode hooked to the `<audio>`
 * element, but cross-origin streams (SomaFM lives at `ice1.somafm.com`
 * and does not send `Access-Control-Allow-Origin: *`) cannot be
 * inspected by Web Audio: the AnalyserNode would return all zeros and
 * the bars wouldn't move. Adding `crossorigin="anonymous"` to the
 * audio element to force CORS would BLOCK playback entirely on those
 * same servers. So this component is a faithful visual equivalent
 * driven by the binary `isPlaying` signal — when the audio plays,
 * the bars bounce; when it pauses, they freeze at their floor.
 */
export default function EqualizerBars({ accentColor, isPlaying }: EqualizerBarsProps) {
  const bars = useMemo(
    () =>
      Array.from({ length: BAR_COUNT }, () => ({
        duration: 0.45 + Math.random() * 0.65,
        delay: -Math.random() * 1.0,
      })),
    [],
  );

  return (
    <div
      aria-hidden
      className="flex items-end gap-0.5 h-10 px-1"
    >
      {bars.map((b, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm origin-bottom"
          style={{
            background: accentColor,
            opacity: 0.85,
            animation: isPlaying
              ? `eq-bounce ${b.duration}s ease-in-out ${b.delay}s infinite alternate`
              : 'none',
            transform: isPlaying ? undefined : 'scaleY(0.2)',
            transition: 'transform 200ms ease-out',
          }}
        />
      ))}
    </div>
  );
}
