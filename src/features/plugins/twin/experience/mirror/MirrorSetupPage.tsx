/**
 * What the Setup tab shows: the way into the lane.
 *
 * Arriving on the tab opens the layer straight away — the tab IS the way in,
 * from the sidebar and from every readiness jump that lands here. Close the
 * layer and this card stays behind it: where the twin stands, and the two ways
 * back in.
 */

import { useEffect } from 'react';
import { GraduationCap, Play } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useTwinReadiness } from '../../useTwinReadiness';
import { openMirror } from './launcher';
import { SigilDisc } from './SigilDisc';
import './mirror.css';

export default function MirrorSetupPage() {
  const { t, tx } = useTranslation();
  const mr = t.twin.experience_mirror.launch;
  const readiness = useTwinReadiness();
  const profile = useSystemStore((s) => s.twinProfiles.find((p) => p.id === s.activeTwinId) ?? null);

  useEffect(() => {
    openMirror({ mode: 'train' });
  }, []);

  return (
    <div className="mr-root mr-field h-full w-full flex items-center justify-center p-8" data-testid="mr-launch">
      <div className="mr-frame mr-frame-lit rounded-modal w-full max-w-lg p-8 space-y-5 text-center">
        <span className="flex justify-center">
          <SigilDisc pronouns={profile?.pronouns ?? null} size="lg" />
        </span>
        <div className="space-y-1.5">
          <h2 className="typo-heading-lg text-foreground">
            {profile ? tx(mr.title, { name: profile.name }) : mr.titleNoTwin}
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
            onClick={() => openMirror({ mode: 'train', stage: 'setup' })}
            data-testid="mr-launch-setup"
          >
            {mr.resume}
          </Button>
          <Button
            variant="secondary"
            icon={<GraduationCap className="w-4 h-4" />}
            onClick={() => openMirror({ mode: 'train', stage: 'training' })}
            data-testid="mr-launch-training"
          >
            {mr.train}
          </Button>
        </div>
      </div>
    </div>
  );
}
