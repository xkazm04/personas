/**
 * Making a twin: name, how it shows up, the languages it writes in, and an
 * optional voice to start from. One column, one scroller, one decision per
 * band — the ten curated voices live a layer down in `StylePresetDialog`.
 *
 * Only the name is required, as it was in the dialog this replaces. The
 * languages are asked here because every generator behind the twin reads them
 * and the old dialog never did. The last act is not "close": the table is
 * dealt in the same overlay, so making a twin flows straight into training it.
 */

import { useState } from 'react';
import { Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { FormField } from '@/features/shared/components/forms/FormField';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { LOCALES } from '@/i18n/locales.manifest';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotionVariants } from '@/hooks/utility/interaction/useMotion';
import { GENDERS, type Gender } from '../../shared/gender';
import type { StyleStart } from '../../setup/style/styleContract';
import { FORGE_ITEM, FORGE_STAGGER } from '../cardMotion';
import { ForgeStyleFan } from './ForgeStyleFan';
import { useCreateTwin } from './useCreateTwin';

interface ForgePhaseProps {
  onClose: () => void;
  /** Called after the twin exists and is active, with whether a voice was queued. */
  onCreated: (opts: { withStyle: boolean }) => void;
}

export function ForgePhase({ onClose, onCreated }: ForgePhaseProps) {
  const { t, language } = useTranslation();
  const tx = t.twin.experience;
  const identity = t.twin.identity;
  const create = useCreateTwin();

  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender>('neutral');
  // Starts on the app's language: the likeliest first answer, one tap to undo.
  const [languages, setLanguages] = useState<string[]>(() =>
    LOCALES.some((l) => l.code === language) ? [language] : [],
  );
  const [styleStart, setStyleStart] = useState<StyleStart | null>(null);
  const stagger = useMotionVariants(FORGE_STAGGER);
  const item = useMotionVariants(FORGE_ITEM);

  const toggleLanguage = (code: string) =>
    setLanguages((live) => (live.includes(code) ? live.filter((c) => c !== code) : [...live, code]));

  const submit = async () => {
    const profile = await create({ name, gender, languages, style: styleStart });
    if (profile) onCreated({ withStyle: Boolean(styleStart) });
  };

  return (
    <motion.div
      className="flex-1 min-h-0 overflow-y-auto px-6 md:px-12 py-8"
      variants={stagger}
      initial="hidden"
      animate="show"
      data-testid="twin-experience-forge"
    >
      <div className="mx-auto w-full max-w-[52rem] space-y-8">
        <motion.header variants={item}>
          <p className="typo-label text-primary">{tx.forge.eyebrow}</p>
          <h2 className="typo-heading-lg text-foreground mt-1">{tx.forge.title}</h2>
          <p className="typo-body text-foreground mt-2">{tx.forge.subtitle}</p>
        </motion.header>

        <motion.div variants={item}>
          <FormField label={tx.forge.name}>
            {(inputProps) => (
              <input
                {...inputProps}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={tx.forge.namePlaceholder}
                className={INPUT_FIELD}
                autoFocus
                data-testid="twin-experience-name"
              />
            )}
          </FormField>
        </motion.div>

        <motion.div variants={item} className="space-y-2">
          <p className="typo-title text-foreground">{tx.forge.gender}</p>
          <div className="grid grid-cols-3 gap-3">
            {GENDERS.map((g) => {
              const selected = gender === g.id;
              return (
                <button
                  type="button"
                  key={g.id}
                  onClick={() => setGender(g.id)}
                  aria-pressed={selected}
                  data-testid={`twin-experience-gender-${g.id}`}
                  className={`focus-ring flex flex-col items-center gap-2 px-3 py-5 rounded-card border-2 transition-colors ${
                    selected
                      ? 'border-primary bg-primary/10 shadow-elevation-2'
                      : 'border-primary/15 bg-card-bg hover:border-primary/40'
                  }`}
                >
                  <span aria-hidden className={`typo-hero leading-none ${g.color}`}>
                    {g.glyph}
                  </span>
                  <span className="typo-label text-foreground">{identity[g.labelKey]}</span>
                </button>
              );
            })}
          </div>
        </motion.div>

        <motion.fieldset variants={item} className="space-y-2" data-testid="twin-experience-languages">
          <legend className="typo-title text-foreground">{tx.forge.languages}</legend>
          <p className="typo-caption">{tx.forge.languagesHint}</p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {LOCALES.map((locale) => {
              const at = languages.indexOf(locale.code);
              const on = at >= 0;
              return (
                <button
                  key={locale.code}
                  type="button"
                  onClick={() => toggleLanguage(locale.code)}
                  aria-pressed={on}
                  data-testid={`twin-experience-language-${locale.code}`}
                  className={`focus-ring inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill border typo-caption transition-colors ${
                    on ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-primary/15 hover:bg-secondary/50'
                  }`}
                >
                  {on && <Check className="w-3 h-3 text-primary" aria-hidden />}
                  <span lang={locale.code}>{locale.nativeName}</span>
                  {at === 0 && languages.length > 1 && (
                    <span className="typo-label text-primary">{tx.forge.languagesMain}</span>
                  )}
                </button>
              );
            })}
          </div>
        </motion.fieldset>

        <motion.div variants={item}>
          <ForgeStyleFan value={styleStart} onChange={setStyleStart} />
        </motion.div>

        <motion.div variants={item} className="flex items-center justify-between gap-3">
          <p className="typo-caption min-w-0">{tx.forge.hint}</p>
          <div className="flex-shrink-0 flex items-center gap-2">
            <Button onClick={onClose} variant="ghost" size="sm">
              {t.twin.profiles.cancel}
            </Button>
            <AsyncButton
              onClick={submit}
              disabled={!name.trim()}
              variant="accent"
              accentColor="violet"
              size="sm"
              loadingText={tx.forge.creating}
              data-testid="twin-experience-create"
            >
              {tx.forge.create}
            </AsyncButton>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

export default ForgePhase;
