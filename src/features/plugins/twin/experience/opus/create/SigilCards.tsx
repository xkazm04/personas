/**
 * The sigil: the glyph on the twin's card. Three small cards, one tap.
 * Stored as pronouns, exactly as the create dialog stored it.
 */

import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { GENDERS, type Gender } from '../../../shared/gender';
import { hoverLift } from '../cardMotion';

interface SigilCardsProps {
  value: Gender;
  onChange: (next: Gender) => void;
}

export function SigilCards({ value, onChange }: SigilCardsProps) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const tc = t.twin.experience_opus.create;

  return (
    <fieldset className="space-y-2" data-testid="xo-create-sigil">
      <legend className="typo-title">{tc.sigil}</legend>
      <div className="grid grid-cols-3 gap-2">
        {GENDERS.map((g) => {
          const picked = g.id === value;
          return (
            <motion.button
              key={g.id}
              type="button"
              whileHover={hoverLift(reduced)}
              onClick={() => onChange(g.id)}
              aria-pressed={picked}
              data-picked={picked}
              data-testid={`xo-create-sigil-${g.id}`}
              className="focus-ring xo-card xo-foil xo-suit-identity rounded-card px-3 py-3 flex flex-col items-center gap-1.5"
            >
              <span
                aria-hidden
                className={`w-10 h-10 rounded-full flex items-center justify-center bg-gradient-to-br ${g.tint}`}
              >
                <span className={`typo-heading-lg ${g.color}`}>{g.glyph}</span>
              </span>
              <span className="typo-label text-foreground">{t.twin.identity[g.labelKey]}</span>
            </motion.button>
          );
        })}
      </div>
    </fieldset>
  );
}

export default SigilCards;
