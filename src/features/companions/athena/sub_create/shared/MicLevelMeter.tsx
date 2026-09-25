/**
 * Live microphone level while the STT take records — the user's only
 * debug tool when the mic is denied or silent. Self-contained: opens its
 * own `getUserMedia` + `AnalyserNode` while `active`, releases both when
 * inactive or unmounted. Width is written imperatively on a rAF loop; no
 * React state at 60fps. Reads zero when inactive.
 */
import { useEffect, useRef } from 'react';
import { silentCatch } from '@/lib/silentCatch';

export interface MicLevelMeterProps {
  active: boolean;
  className?: string;
}

function audioCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return (
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null
  );
}

/** Opens the mic while `active` and writes a 0..1 level into `fill`'s width. */
function useMicLevel(active: boolean, fill: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = fill.current;
    if (!el) return;
    el.style.transform = 'scaleX(0)';
    if (!active) return;
    const Ctor = audioCtor();
    if (!Ctor || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let level = 0;

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        ctx = new Ctor();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.6;
        ctx.createMediaStreamSource(s).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (cancelled) return;
          analyser.getByteFrequencyData(data);
          let sum = 0;
          const n = Math.min(data.length, 48);
          for (let i = 0; i < n; i++) sum += data[i] ?? 0;
          const target = Math.min(1, Math.pow(sum / n / 255, 0.7) * 1.4);
          level += (target - level) * (target > level ? 0.5 : 0.15);
          el.style.transform = `scaleX(${level.toFixed(3)})`;
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      })
      .catch(silentCatch('createAthena.micLevel'));

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(silentCatch('createAthena.micLevel.close'));
      el.style.transform = 'scaleX(0)';
    };
  }, [active, fill]);
}

export function MicLevelMeter({ active, className }: MicLevelMeterProps) {
  const fillRef = useRef<HTMLDivElement | null>(null);
  useMicLevel(active, fillRef);
  return (
    <div className={className} aria-hidden="true" data-testid="create-athena-mic-level">
      <div className="h-1.5 w-full rounded-pill bg-secondary/60 overflow-hidden">
        <div
          ref={fillRef}
          className="h-full w-full origin-left rounded-pill bg-primary transition-transform duration-[80ms] ease-linear"
          style={{ transform: 'scaleX(0)' }}
        />
      </div>
    </div>
  );
}
