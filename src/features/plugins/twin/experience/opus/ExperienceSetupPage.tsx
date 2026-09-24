/**
 * What the Setup tab shows now: the way onto the table.
 *
 * Arriving on the tab opens the training layer straight away — the tab IS the
 * way in, from the sidebar and from every twin-card slot jump that lands here.
 * Close the layer and this card stays: where the twin stands, and the two ways
 * back in (carry on setting up, or start a training round).
 */

import { useEffect } from 'react';
import { GraduationCap, Play } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useTwinReadiness } from '../../useTwinReadiness';
import { genderDefFromPronouns } from '../../shared/gender';
import { openTwinExperience } from './launcher';
import './experience.css';

export default function ExperienceSetupPage() {
  const { t, tx } = useTranslation();
  const xo = t.twin.experience_opus.launch;
  const readiness = useTwinReadiness();
  const profile = useSystemStore((s) => s.twinProfiles.find((p) => p.id === s.activeTwinId) ?? null);
  const sigil = genderDefFromPronouns(profile?.pronouns ?? null);

  useEffect(() => {
    openTwinExperience({ mode: 'train' });
  }, []);

  return (
    <div className="xo-root xo-felt h-full w-full flex items-center justify-center p-8" data-testid="xo-launch">
      <div className="xo-suit-identity xo-card xo-card-raised xo-foil xo-glow rounded-modal w-full max-w-xl p-8 space-y-5 text-center">
        <span
          aria-hidden
          className={`mx-auto w-16 h-16 rounded-card flex items-center justify-center bg-gradient-to-br ${sigil.tint}`}
        >
          <span className={`typo-data-lg ${sigil.color}`}>{sigil.glyph}</span>
        </span>
        <div className="space-y-1.5">
          <h2 className="typo-heading-lg text-foreground">
            {profile ? tx(xo.title, { name: profile.name }) : xo.titleNoTwin}
          </h2>
          <p className="typo-body-lg text-foreground">{tx(xo.body, { score: readiness.score })}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            variant="accent"
            accentColor="violet"
            icon={<Play className="w-4 h-4" />}
            onClick={() => openTwinExperience({ mode: 'train', stage: 'setup' })}
            data-testid="xo-launch-setup"
          >
            {xo.resume}
          </Button>
          <Button
            variant="secondary"
            icon={<GraduationCap className="w-4 h-4" />}
            onClick={() => openTwinExperience({ mode: 'train', stage: 'training' })}
            data-testid="xo-launch-training"
          >
            {xo.train}
          </Button>
        </div>
      </div>
    </div>
  );
}
