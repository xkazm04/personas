/**
 * Live waveform of Athena's voice — `bars` vertical bars driven by the
 * shared TTS analyser (`audioLevel.ts` → `subscribeAudioSpectrum`). Heights
 * are written imperatively through refs on the analyser's own rAF tick; no
 * React state moves at 60fps. Flat (min height) when `active` is false or
 * nothing is playing. Motion is a single CSS height transition, so the
 * reduced-motion config never has to snap anything.
 */
import { useEffect, useRef } from 'react';
import { subscribeAudioSpectrum } from '@/features/plugins/companion/audioLevel';

const MIN_PX = 3;
/** Speech energy lives in the low-mid bins; the top of the FFT is noise. */
const USEFUL_BINS = 48;

export interface AthenaWaveformProps {
  active: boolean;
  bars?: number;
  className?: string;
}

export function AthenaWaveform({ active, bars = 28, className }: AthenaWaveformProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const spans = Array.from(root.querySelectorAll<HTMLSpanElement>('[data-bar]'));
    const flatten = () => {
      for (const s of spans) s.style.height = `${MIN_PX}px`;
    };
    if (!active) {
      flatten();
      return;
    }
    const unsubscribe = subscribeAudioSpectrum((bins) => {
      if (bins.length === 0) {
        flatten();
        return;
      }
      const max = root.clientHeight || MIN_PX;
      const usable = Math.min(bins.length, USEFUL_BINS);
      const n = spans.length;
      for (let i = 0; i < n; i++) {
        // Mirror around the centre so the loudest (lowest) bins sit mid-row
        // and the shape reads as a voice, not a left-heavy spectrum.
        const dist = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2 || 1);
        const bin = Math.min(usable - 1, Math.floor(dist * usable));
        const v = (bins[bin] ?? 0) / 255;
        const h = MIN_PX + Math.pow(v, 0.8) * (max - MIN_PX);
        spans[i]!.style.height = `${Math.round(h)}px`;
      }
    });
    return () => {
      unsubscribe();
      flatten();
    };
  }, [active, bars]);

  return (
    <div
      ref={rootRef}
      className={`flex items-center justify-center gap-[2px] h-6 ${className ?? ''}`}
      aria-hidden="true"
      data-testid="create-athena-waveform"
      data-active={active ? 'true' : 'false'}
    >
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          data-bar=""
          className="w-[3px] rounded-pill bg-primary/70 transition-[height] duration-[80ms] ease-linear"
          style={{ height: MIN_PX }}
        />
      ))}
    </div>
  );
}
