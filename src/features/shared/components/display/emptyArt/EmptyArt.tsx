import { useId, type CSSProperties } from 'react';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { EMPTY_ART_MOTIFS, type EmptyArtMotif } from './motifs';
import './emptyArt.css';

export type { EmptyArtMotif } from './motifs';
export { EMPTY_ART_MOTIF_NAMES } from './motifs';

const SIZE_PX = { xs: 40, sm: 56, md: 88, lg: 120 } as const;
export type EmptyArtSize = keyof typeof SIZE_PX;

interface EmptyArtProps {
  motif: EmptyArtMotif;
  /** xs 40px (a kit band, row height) - sm 56px (panels, tables) - md 88px (default) - lg 120px (a page's first run). */
  size?: EmptyArtSize;
  className?: string;
}

/**
 * @catalog Small animated empty-state illustration (19 motifs: agents, vault, launch, archive, stream, search, inbox ...). Tokens-only colour, CSS motion, still under reduced motion. Usually reached through ScenarioEmptyState `art`.
 *
 * The art is a rounded plate with line work that draws itself in, then one calm
 * ambient loop on an accent. Decorative: hidden from assistive tech, the empty
 * state's title and description carry the meaning.
 */
export function EmptyArt({ motif, size = 'md', className }: EmptyArtProps) {
  const still = useReducedMotion();
  const uid = useId().replace(/:/g, '');
  const px = SIZE_PX[size];
  const Motif = EMPTY_ART_MOTIFS[motif];
  return (
    <svg
      className={`empty-art ${className ?? ''}`.trim()}
      width={px}
      height={px}
      viewBox="0 0 96 96"
      aria-hidden
      focusable="false"
      data-motif={motif}
      data-still={still ? '' : undefined}
      data-testid="empty-art"
    >
      <defs>
        <linearGradient id={`ea-plate-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--ea-plate-a)' } as CSSProperties} />
          <stop offset="1" style={{ stopColor: 'var(--ea-plate-b)' } as CSSProperties} />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="88" height="88" rx="24" fill={`url(#ea-plate-${uid})`} stroke="var(--ea-plate-line)" strokeWidth="1" />
      <Motif />
    </svg>
  );
}
