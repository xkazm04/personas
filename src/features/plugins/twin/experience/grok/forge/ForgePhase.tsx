/**
 * Create-twin beat: name, gender as large glyph cards, optional starting style.
 * Submits through the same contract as the old dialog — create, activate, record
 * a pending style — then the host deals the first training hand in-place.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useSystemStore } from '@/stores/systemStore';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { FormField } from '@/features/shared/components/forms/FormField';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotionVariants } from '@/hooks/utility/interaction/useMotion';
import { GENDERS, pronounsFromGender, type Gender } from '../../../shared/gender';
import { setPendingStyleStart } from '../../../setup/style/pendingStyleStart';
import type { StyleStart } from '../../../setup/style/styleContract';
import { FORGE_ITEM, FORGE_STAGGER } from '../cardMotion';
import { ForgeStyleFan } from './ForgeStyleFan';

interface ForgePhaseProps {
  onClose: () => void;
  /** Called after the twin exists and is active, with whether a style was queued. */
  onCreated: (opts: { withStyle: boolean }) => void;
}

export function ForgePhase({ onClose, onCreated }: ForgePhaseProps) {
  const { t } = useTranslation();
  const xg = t.twin.experience_grok;
  const identity = t.twin.identity;
  const createTwinProfile = useSystemStore((s) => s.createTwinProfile);
  const setActiveTwin = useSystemStore((s) => s.setActiveTwin);

  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender>('neutral');
  const [styleStart, setStyleStart] = useState<StyleStart | null>(null);
  const stagger = useMotionVariants(FORGE_STAGGER);
  const item = useMotionVariants(FORGE_ITEM);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const profile = await createTwinProfile(
      trimmed,
      undefined,
      undefined,
      undefined,
      pronounsFromGender(gender),
    );
    await setActiveTwin(profile.id);
    if (styleStart) setPendingStyleStart(profile.id, styleStart);
    onCreated({ withStyle: Boolean(styleStart) });
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
          <p className="typo-label text-primary">{xg.forge.eyebrow}</p>
          <h2 className="typo-heading-lg text-foreground mt-1">{xg.forge.title}</h2>
          <p className="typo-body text-foreground mt-2">{xg.forge.subtitle}</p>
        </motion.header>

        <motion.div variants={item}>
          <FormField label={xg.forge.name}>
            {(inputProps) => (
              <input
                {...inputProps}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={xg.forge.namePlaceholder}
                className={INPUT_FIELD}
                autoFocus
                data-testid="twin-experience-name"
              />
            )}
          </FormField>
        </motion.div>

        <motion.div variants={item} className="space-y-2">
          <p className="typo-title text-foreground">{xg.forge.gender}</p>
          <div className="grid grid-cols-3 gap-3">
            {GENDERS.map((g) => {
              const selected = gender === g.id;
              return (
                <button
                  type="button"
                  key={g.id}
                  onClick={() => setGender(g.id)}
                  aria-pressed={selected}
                  className={`focus-ring flex flex-col items-center gap-2 px-3 py-5 rounded-card border-2 transition-colors ${
                    selected
                      ? 'border-primary bg-primary/10 shadow-elevation-2'
                      : 'border-primary/15 bg-card-bg hover:border-primary/40'
                  }`}
                >
                  <span aria-hidden className={`typo-hero leading-none ${g.color}`}>{g.glyph}</span>
                  <span className="typo-label text-foreground">{identity[g.labelKey]}</span>
                </button>
              );
            })}
          </div>
        </motion.div>

        <motion.div variants={item}>
          <ForgeStyleFan value={styleStart} onChange={setStyleStart} />
        </motion.div>

        <motion.div variants={item} className="flex items-center justify-end gap-2">
          <Button onClick={onClose} variant="ghost" size="sm">{t.twin.profiles.cancel}</Button>
          <AsyncButton
            onClick={submit}
            disabled={!name.trim()}
            variant="accent"
            accentColor="violet"
            size="sm"
            loadingText={xg.forge.creating}
            data-testid="twin-experience-create"
          >
            {xg.forge.create}
          </AsyncButton>
        </motion.div>
      </div>
    </motion.div>
  );
}

export default ForgePhase;
