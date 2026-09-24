/**
 * The twin's disc: its sigil, drawn once and shared.
 *
 * Both acts render THIS component with the same framer `layoutId`, which is
 * the whole trick behind the seam between them — the disc the person chose
 * while naming their twin is the same object that ends up in the stage rail,
 * and framer moves it there rather than cross-fading one for another.
 *
 * Under reduced motion the shared layout animation is dropped (no `layoutId`),
 * so the disc simply appears where it belongs.
 */

import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { genderDef, genderDefFromPronouns, type Gender } from '../../shared/gender';

/** The one id both acts share. Exported so nothing re-types the string. */
export const SIGIL_LAYOUT_ID = 'mirror-sigil';

interface SigilDiscProps {
  /** Pass a gender while drafting; pass pronouns once the twin is stored. */
  gender?: Gender;
  pronouns?: string | null;
  size: 'sm' | 'lg';
  /**
   * Join the shared layout group. ONLY the two discs that trade places across
   * the seam set this: two live elements sharing one `layoutId` is undefined
   * behaviour in framer, and the Setup tab's launch card renders a third disc
   * that is on screen at the same time as the layer above it.
   */
  shared?: boolean;
}

const BOX = { sm: 'w-9 h-9 rounded-card', lg: 'w-20 h-20 rounded-modal' } as const;
const GLYPH = { sm: 'typo-title-lg', lg: 'typo-hero' } as const;

export function SigilDisc({ gender, pronouns, size, shared }: SigilDiscProps) {
  const reduced = useReducedMotion();
  const def = gender ? genderDef(gender) : genderDefFromPronouns(pronouns ?? null);

  return (
    <motion.span
      layoutId={shared && !reduced ? SIGIL_LAYOUT_ID : undefined}
      aria-hidden
      data-testid="mr-sigil"
      className={`flex-shrink-0 flex items-center justify-center bg-gradient-to-br ${def.tint} ${BOX[size]}`}
    >
      <span className={`${GLYPH[size]} ${def.color}`}>{def.glyph}</span>
    </motion.span>
  );
}

export default SigilDisc;
