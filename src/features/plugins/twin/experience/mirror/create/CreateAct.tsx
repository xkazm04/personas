/**
 * Act one: name them. Nothing else is on screen.
 *
 * The whole act is one question, and the rest of it arrives only once it has
 * been answered — the sigil row and the way on both fade up the moment a name
 * exists, so the first sight is a field and a sentence rather than a form. The
 * two things a create form normally asks next (the languages they write in,
 * a starting voice) are a DOOR, not a section: they open one layer down, and
 * the lane stays a lane.
 *
 * The disc carries `layoutId="mirror-sigil"` — the same id the stage rail
 * uses. It is what physically travels into the chrome when this act ends.
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Settings2, X } from 'lucide-react';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { LOCALES } from '@/i18n/locales.manifest';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import type { Gender } from '../../../shared/gender';
import type { StyleStart } from '../../../setup/style/styleContract';
import { MIRROR_TITLE_ID } from '../mirrorIds';
import { revealVariants } from '../motion';
import { SigilDisc } from '../SigilDisc';
import { SigilRow } from './SigilRow';
import { OptionsLayer } from './OptionsLayer';
import { useCreateTwin } from './useCreateTwin';

interface CreateActProps {
  onClose: () => void;
  onCreated: () => void;
}

export function CreateAct({ onClose, onCreated }: CreateActProps) {
  const { t, language } = useTranslation();
  const mc = t.twin.experience_mirror.create;
  const create = useCreateTwin();
  const reduced = useReducedMotion();

  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender>('neutral');
  // Starts on the app's language: the likeliest first answer, one tap to undo.
  const [languages, setLanguages] = useState<string[]>(() =>
    LOCALES.some((l) => l.code === language) ? [language] : [],
  );
  const [style, setStyle] = useState<StyleStart | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const named = name.trim().length > 0;

  const submit = async () => {
    const profile = await create({ name, gender, languages, style });
    if (profile) onCreated();
  };

  return (
    <motion.div
      className="absolute inset-0 flex flex-col"
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -24, transition: { duration: 0.24 } }}
      data-testid="mr-create"
    >
      <div className="flex-shrink-0 flex justify-end px-4 pt-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label={t.common.close}
          data-testid="mr-create-close"
          icon={<X className="w-4 h-4" />}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center px-6 pb-10">
        <div className="w-full max-w-[var(--mr-lane)] flex flex-col items-center gap-7 text-center">
          <SigilDisc gender={gender} size="lg" shared />

          <div className="space-y-2">
            <h2 id={MIRROR_TITLE_ID} className="typo-hero text-foreground">
              {mc.ask}
            </h2>
            <p className="typo-body-lg text-foreground">{mc.hint}</p>
          </div>

          {/* The one field. No border, no label — the sentence above is the
              label, and the rule under it lights as soon as it has a name. */}
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && named) {
                e.preventDefault();
                void submit().catch(toastCatch('features/plugins/twin/experience/mirror/create:enter'));
              }
            }}
            placeholder={mc.namePlaceholder}
            aria-label={mc.namePlaceholder}
            className={`focus-ring w-full max-w-md bg-transparent text-center typo-heading-lg text-foreground rounded-input px-4 py-3 border-b-2 transition-colors ${
              named ? 'border-primary' : 'border-primary/20'
            }`}
            data-testid="mr-create-name"
            autoFocus
          />

          <AnimatePresence initial={false}>
            {named && (
              <motion.div
                key="rest"
                variants={revealVariants(reduced)}
                initial="enter"
                animate="rest"
                exit="gone"
                className="w-full flex flex-col items-center gap-6"
              >
                <SigilRow value={gender} onChange={setGender} />

                <div className="flex flex-col items-center gap-3">
                  <AsyncButton
                    onClick={submit}
                    variant="accent"
                    accentColor="violet"
                    loadingText={mc.creating}
                    icon={<ArrowRight className="w-4 h-4" />}
                    data-testid="mr-create-begin"
                  >
                    {mc.begin}
                  </AsyncButton>
                  <button
                    type="button"
                    onClick={() => setOptionsOpen(true)}
                    className="mr-door focus-ring inline-flex items-center gap-2 px-3 py-1.5 rounded-interactive typo-caption"
                    data-testid="mr-create-options"
                  >
                    <Settings2 className="w-3.5 h-3.5 text-primary" aria-hidden />
                    {mc.door}
                    {(style !== null || languages.length > 1) && (
                      <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-primary" />
                    )}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <OptionsLayer
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        languages={languages}
        onLanguages={setLanguages}
        style={style}
        onStyle={setStyle}
      />
    </motion.div>
  );
}

export default CreateAct;
