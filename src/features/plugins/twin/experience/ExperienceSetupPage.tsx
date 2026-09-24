/**
 * What the Setup tab shows: the way into the table.
 *
 * Arriving on the tab opens the overlay straight away — the tab IS the way in,
 * from the sidebar and from every readiness jump that lands here. Close the
 * overlay and this card stays behind it: where the twin stands, and the two
 * ways back in.
 */

import { useEffect } from 'react';
import { GraduationCap, Play } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useTwinReadiness } from '../useTwinReadiness';
import { genderDefFromPronouns } from '../shared/gender';
import { openTwinExperience } from './launcher';
import './experience.css';

export default function ExperienceSetupPage() {
  const { t, tx: fmt } = useTranslation();
  const tx = t.twin.experience.launch;
  const readiness = useTwinReadiness();
  const profile = useSystemStore((s) => s.twinProfiles.find((p) => p.id === s.activeTwinId) ?? null);
  const sigil = genderDefFromPronouns(profile?.pronouns ?? null);

  useEffect(() => {
    openTwinExperience({ mode: 'train' });
  }, []);

  return (
    <div className="tx-felt h-full w-full flex items-center justify-center p-8" data-testid="twin-experience-launch">
      <div className="w-full max-w-lg rounded-card border-2 border-primary/30 bg-card-bg shadow-elevation-2 p-8 space-y-5 text-center">
        <span
          aria-hidden
          className={`mx-auto w-16 h-16 rounded-card flex items-center justify-center bg-gradient-to-br ${sigil.tint}`}
        >
          <span className={`typo-data-lg ${sigil.color}`}>{sigil.glyph}</span>
        </span>
        <div className="space-y-1.5">
          <h2 className="typo-heading-lg text-foreground">
            {profile ? fmt(tx.title, { name: profile.name }) : tx.titleNoTwin}
          </h2>
          <p className="typo-body-lg text-foreground flex items-center justify-center gap-1.5">
            <Numeric value={Math.round(readiness.score)} unit="percent" precision={0} className="typo-data" />
            <span>{t.twin.setup.scoreLabel}</span>
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            variant="accent"
            accentColor="violet"
            icon={<Play className="w-4 h-4" />}
            onClick={() => openTwinExperience({ mode: 'train', stage: 'setup' })}
            data-testid="twin-experience-launch-setup"
          >
            {tx.resume}
          </Button>
          <Button
            variant="secondary"
            icon={<GraduationCap className="w-4 h-4" />}
            onClick={() => openTwinExperience({ mode: 'train', stage: 'training' })}
            data-testid="twin-experience-launch-training"
          >
            {tx.train}
          </Button>
        </div>
      </div>
    </div>
  );
}
