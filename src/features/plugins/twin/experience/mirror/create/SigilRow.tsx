/**
 * How the twin is addressed: three marks, one tap. Stored as pronouns, exactly
 * as the create dialog this replaces stored it.
 *
 * Deliberately not cards — the lane has no cards. Three quiet marks in a row,
 * and the one that is chosen is the one the disc above is already wearing, so
 * the choice is previewed at full size before it is made.
 */

import { useTranslation } from '@/i18n/useTranslation';
import { GENDERS, type Gender } from '../../../shared/gender';

interface SigilRowProps {
  value: Gender;
  onChange: (next: Gender) => void;
}

export function SigilRow({ value, onChange }: SigilRowProps) {
  const { t } = useTranslation();

  return (
    <fieldset className="flex flex-col items-center gap-2" data-testid="mr-create-sigil">
      <legend className="typo-caption">{t.twin.experience_mirror.create.sigil}</legend>
      <div className="flex items-center gap-2">
        {GENDERS.map((g) => {
          const picked = g.id === value;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => onChange(g.id)}
              aria-pressed={picked}
              data-picked={picked}
              data-testid={`mr-create-sigil-${g.id}`}
              className={`mr-door focus-ring inline-flex items-center gap-2 px-3 py-1.5 rounded-pill typo-caption transition-colors ${
                picked ? 'text-foreground' : ''
              }`}
            >
              <span aria-hidden className={`typo-title-lg ${g.color}`}>
                {g.glyph}
              </span>
              {t.twin.identity[g.labelKey]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export default SigilRow;
