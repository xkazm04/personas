/**
 * Making a twin: one screen, not a wizard. The left card is the twin being
 * drafted (its sigil, its name, the languages it writes in) and fills in as
 * the person types; the right is the optional starting-style deck.
 *
 * Only the name is required, as it was in the dialog this replaces. The
 * languages are new here because every generator reads them and nothing
 * asked. The last act is not "close": the table is dealt in the same layer,
 * so creating a twin flows straight into training it.
 */

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { LOCALES } from '@/i18n/locales.manifest';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { genderDef, type Gender } from '../../../shared/gender';
import type { StyleStart } from '../../../setup/style/styleContract';
import { EXPERIENCE_TITLE_ID } from '../experienceIds';
import { ExperienceClose } from '../ExperienceClose';
import { useCreateTwin } from './useCreateTwin';
import { SigilCards } from './SigilCards';
import { LanguageChips } from './LanguageChips';
import { StyleDeck } from './StyleDeck';

interface CreateStageProps {
  onClose: () => void;
  onCreated: () => void;
}

export function CreateStage({ onClose, onCreated }: CreateStageProps) {
  const { t, language } = useTranslation();
  const tc = t.twin.experience_opus.create;
  const create = useCreateTwin();

  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender>('neutral');
  // Starts on the app's language: the likeliest first answer, one tap to undo.
  const [languages, setLanguages] = useState<string[]>(() =>
    LOCALES.some((l) => l.code === language) ? [language] : [],
  );
  const [style, setStyle] = useState<StyleStart | null>(null);
  const sigil = genderDef(gender);
  const ready = name.trim().length > 0;

  const submit = async () => {
    const profile = await create({ name, gender, languages, style });
    if (profile) onCreated();
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="xo-create">
      <header className="flex-shrink-0 flex items-center gap-3 px-6 pt-5 pb-3">
        <Sparkles className="w-5 h-5 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id={EXPERIENCE_TITLE_ID} className="typo-heading-lg text-foreground">
            {tc.title}
          </h2>
          <p className="typo-body text-foreground">{tc.subtitle}</p>
        </div>
        <ExperienceClose onClose={onClose} />
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1500px] grid gap-8 px-6 py-4 lg:grid-cols-[minmax(20rem,28rem)_1fr]">
          <div className="xo-card xo-foil xo-suit-identity xo-glow rounded-modal p-5 space-y-5 self-start">
            <div className="flex items-center gap-4">
              <span
                aria-hidden
                className={`w-16 h-16 flex-shrink-0 rounded-card flex items-center justify-center bg-gradient-to-br ${sigil.tint}`}
              >
                <span className={`typo-data-lg ${sigil.color}`}>{sigil.glyph}</span>
              </span>
              <label className="flex-1 min-w-0 space-y-1.5">
                <span className="typo-title">{tc.name}</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && ready) {
                      e.preventDefault();
                      void submit().catch(toastCatch('features/plugins/twin/experience/create:enter'));
                    }
                  }}
                  placeholder={tc.namePlaceholder}
                  className={`${INPUT_FIELD} typo-title-lg`}
                  data-testid="xo-create-name"
                  autoFocus
                />
              </label>
            </div>
            <SigilCards value={gender} onChange={setGender} />
            <LanguageChips value={languages} onChange={setLanguages} />
          </div>

          <StyleDeck value={style} onChange={setStyle} />
        </div>
      </div>

      <footer className="flex-shrink-0 flex items-center gap-3 px-6 py-3 border-t border-primary/10 bg-background/60">
        <p className="typo-caption flex-1 min-w-0">{tc.footnote}</p>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {tc.cancel}
        </Button>
        <AsyncButton
          onClick={submit}
          disabled={!ready}
          disabledReason={tc.nameNeeded}
          variant="accent"
          accentColor="violet"
          loadingText={tc.creating}
          data-testid="xo-create-submit"
        >
          {tc.submit}
        </AsyncButton>
      </footer>
    </div>
  );
}

export default CreateStage;
