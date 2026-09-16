import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { BaseModal } from '@/lib/ui/BaseModal';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';
import { GENDERS, pronounsFromGender, type Gender } from '../shared/gender';

/**
 * Creating a twin asks for a name. That is the whole dialog.
 *
 * It replaces a four-step wizard that collected a role, generated or ingested
 * a bio, staged channel intent into a `twin.wizard.pending_tones.<id>`
 * localStorage key nothing ever read back reliably, and then offered a
 * training handoff — all before the twin existed. Every one of those is a slot
 * the guided Setup tab now fills WITH the twin in hand, which is why this
 * dialog's last act is to make the new twin active and hand over to Setup.
 *
 * The gender glyph stays because it is the card's avatar and costs one tap.
 */
export function CreateTwinDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const twin = t.twin;
  const createTwinProfile = useSystemStore((s) => s.createTwinProfile);
  const setActiveTwin = useSystemStore((s) => s.setActiveTwin);
  const setTwinTab = useSystemStore((s) => s.setTwinTab);

  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender>('neutral');

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const profile = await createTwinProfile(trimmed, undefined, undefined, undefined, pronounsFromGender(gender));
    // The backend auto-activates only the FIRST twin, so say it explicitly:
    // handing the user to Setup for somebody else's twin is the worst
    // possible landing.
    await setActiveTwin(profile.id);
    onClose();
    setTwinTab('setup');
  };

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId="twin-create-title"
      size="sm"
      panelClassName="rounded-card border border-violet-500/20 bg-card shadow-elevation-3"
    >
      <div className="flex items-center justify-between px-5 py-3 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-400" />
          <h2 id="twin-create-title" className="typo-section-title">{twin.wizard.title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={twin.wizard.close}
          className="p-1 rounded-interactive text-muted hover:text-foreground hover:bg-secondary/40 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-5 py-5 space-y-4">
        <label className="block space-y-1.5">
          <span className="typo-title">{twin.profiles.name}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={twin.profiles.namePlaceholder}
            className={INPUT_FIELD}
            autoFocus
          />
        </label>

        <div className="space-y-1.5">
          <span className="typo-title">{twin.identity.gender}</span>
          <div className="flex items-center gap-2">
            {GENDERS.map((g) => (
              <button
                type="button"
                key={g.id}
                onClick={() => setGender(g.id)}
                aria-pressed={gender === g.id}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-interactive border transition-colors ${
                  gender === g.id
                    ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                    : 'text-muted border-primary/10 hover:bg-secondary/40 hover:text-foreground'
                }`}
              >
                <span aria-hidden className={g.color}>{g.glyph}</span>
                <span className="typo-label">{twin.identity[g.labelKey]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-primary/10">
        <Button onClick={onClose} variant="ghost" size="sm">{twin.profiles.cancel}</Button>
        <AsyncButton
          onClick={submit}
          disabled={!name.trim()}
          variant="accent"
          accentColor="violet"
          size="sm"
          loadingText={twin.profiles.creating}
        >
          {twin.profiles.createTwin}
        </AsyncButton>
      </div>
    </BaseModal>
  );
}
