// The figures a ROW and a SCENARIO CELL draw. Pure SVG, labels as props.
import { useId } from 'react';

import { SCENARIO_PROOFS, type ScenarioProof } from '@/api/devTools/features';

export interface SpanStripProps {
  /** Groups this feature's slice crosses. */
  crossed: number;
  /** Groups the project has. */
  total: number;
  label: string;
  width?: number;
  height?: number;
}

/**
 * The group span as a drawn `n/m` strip rather than two numerals: filled ticks
 * for the groups the slice enters, hollow for the rest. Above 24 groups the
 * strip compacts into a single proportional rule so a 25-tick comb never turns
 * into noise at row height.
 */
export function SpanStrip({ crossed, total, label, width = 76, height = 10 }: SpanStripProps) {
  if (total <= 0) return null;
  const safe = Math.max(0, Math.min(crossed, total));
  if (total > 24) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="flex-none">
        <rect x="0" y={height / 2 - 2} width={width} height="4" rx="2" fill="color-mix(in srgb, var(--foreground) 16%, transparent)" />
        <rect x="0" y={height / 2 - 2} width={((safe / total) * width).toFixed(2)} height="4" rx="2" fill="var(--status-info)" />
      </svg>
    );
  }
  const gap = 2;
  const cell = Math.max(2, (width - gap * (total - 1)) / total);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="flex-none">
      {Array.from({ length: total }).map((_, i) => (
        <rect
          key={i}
          x={(i * (cell + gap)).toFixed(2)}
          y="1"
          width={cell.toFixed(2)}
          height={height - 2}
          rx="1.5"
          fill={i < safe ? 'var(--status-info)' : 'transparent'}
          stroke={i < safe ? 'none' : 'color-mix(in srgb, var(--foreground) 24%, transparent)'}
          strokeWidth={i < safe ? 0 : 1}
        />
      ))}
    </svg>
  );
}

export interface ScoreBarProps {
  /** Null is NOT MEASURED. It draws hatched at full width, never a zero fill. */
  score: number | null;
  /** The bar this score is held to, drawn as a tick on the track. */
  floor: number;
  /** A floor hit tints the fill, the way it tints a wedge in the rose. */
  floorHit: boolean;
  /** Dotted tick: the floor was hit while the instrument is not trusted. */
  advisory: boolean;
  label: string;
  width?: number;
  height?: number;
}

/**
 * One score against its floor. Hatched-at-full-reach is "we looked and could
 * not measure"; it is deliberately the loudest shape in the figure, because
 * conflating it with a low score is the defect this whole surface exists to
 * prevent.
 */
export function ScoreBar({ score, floor, floorHit, advisory, label, width = 140, height = 10 }: ScoreBarProps) {
  const id = useId();
  const tick = Math.max(0, Math.min(1, floor)) * width;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="flex-none">
      <defs>
        <pattern id={`${id}-h`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" stroke="color-mix(in srgb, var(--foreground) 34%, transparent)" strokeWidth="1.6" />
        </pattern>
      </defs>
      <rect x="0" y="0" width={width} height={height} rx={height / 2} fill="color-mix(in srgb, var(--foreground) 10%, transparent)" />
      {score == null ? (
        <rect x="0" y="0" width={width} height={height} rx={height / 2} fill={`url(#${id}-h)`} />
      ) : (
        <rect
          x="0"
          y="0"
          width={Math.max(2, score * width).toFixed(2)}
          height={height}
          rx={height / 2}
          fill={floorHit ? 'var(--status-error)' : 'var(--status-success)'}
        />
      )}
      <line
        x1={tick.toFixed(2)}
        x2={tick.toFixed(2)}
        y1="-1"
        y2={height + 1}
        stroke="var(--foreground)"
        strokeWidth="1.6"
        strokeDasharray={advisory ? '2 2' : undefined}
        strokeOpacity="0.8"
      />
    </svg>
  );
}

export interface ProofLadderProps {
  /** Strongest first: observed > replayed > simulated > claimed. */
  proof: ScenarioProof | null;
  label: string;
  size?: number;
}

/**
 * The proof ladder as four rungs, the reached one and everything weaker filled.
 * RECORDED and never gated: a model playing a marketing candidate is not a
 * marketing candidate, so `simulated` can flag a weakness and cannot certify -
 * but that judgement belongs to the member and the person, not to this figure.
 */
export function ProofLadder({ proof, label, size = 4 }: ProofLadderProps) {
  const index = proof == null ? -1 : SCENARIO_PROOFS.indexOf(proof);
  const rungs = SCENARIO_PROOFS.length;
  const w = rungs * (size + 2);
  const h = size * 3;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="flex-none">
      {Array.from({ length: rungs }).map((_, i) => {
        // Rung 0 is the STRONGEST, so it is the tallest; the reached rung and
        // every weaker one are filled.
        const filled = index >= 0 && i >= index;
        const rh = h - i * (size * 0.5);
        return (
          <rect
            key={i}
            x={i * (size + 2)}
            y={h - rh}
            width={size}
            height={rh}
            rx="1"
            fill={filled ? 'var(--status-info)' : 'transparent'}
            stroke={filled ? 'none' : 'color-mix(in srgb, var(--foreground) 26%, transparent)'}
            strokeWidth={filled ? 0 : 1}
          />
        );
      })}
    </svg>
  );
}
