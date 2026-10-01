/**
 * The Twin Detail page's header (spark twin-portable-blueprint): who the twin
 * is (sigil, name, role), how ready it is, the two ways into the experience,
 * the learn-from-sample proposals waiting in the Hub, the export menu, and the
 * blueprint switcher.
 *
 * The switcher arrives as a SLOT: the page renders the strip beside the panel
 * it swaps and declares that panel (census `tabstrip-with-no-declared-panel`).
 * Readiness is read from the store here, not from the blueprint model, so the
 * header paints on the first frame while the blueprint's reads are in flight.
 */
import type { ReactNode } from 'react';
import { GraduationCap, Play } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';
import type { TwinProfile } from '@/lib/bindings/TwinProfile';
import { formatCount } from '@/lib/utils/formatters';
import { useSystemStore } from '@/stores/systemStore';

import TwinCardExportMenu from '../card/TwinCardExportMenu';
import { openTwinExperience } from '../experience/launcher';
import { genderDefFromPronouns } from '../shared/gender';
import { useTwinReadiness } from '../useTwinReadiness';

interface DetailHeaderProps {
  profile: TwinProfile;
  /** Open sample proposals; `null` (not measured) or 0 hides the chip. */
  samplesOpen: number | null;
  /** The blueprint variant switcher. */
  switcher: ReactNode;
}

export function DetailHeader({ profile, samplesOpen, switcher }: DetailHeaderProps) {
  const { t, tx, language } = useTranslation();
  const launch = t.twin.experience.launch;
  const detail = t.twin.detail;
  const readiness = useTwinReadiness();
  const setTwinTab = useSystemStore((s) => s.setTwinTab);
  const sigil = genderDefFromPronouns(profile.pronouns);
  const role = profile.role?.trim() || null;

  return (
    <ContentHeader
      fitWidth
      icon={
        <span
          aria-hidden
          className={`w-11 h-11 flex-shrink-0 rounded-card flex items-center justify-center bg-gradient-to-br ${sigil.tint}`}
        >
          <span className={`typo-data-lg ${sigil.color}`}>{sigil.glyph}</span>
        </span>
      }
      title={detail.tabLabel}
      subtitle={profile.name}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="accent"
            tone="agent"
            icon={<Play className="w-4 h-4" />}
            onClick={() => openTwinExperience({ mode: 'train', stage: 'setup' })}
            data-testid="twin-experience-launch-setup"
          >
            {launch.resume}
          </Button>
          <Button
            variant="secondary"
            icon={<GraduationCap className="w-4 h-4" />}
            onClick={() => openTwinExperience({ mode: 'train', stage: 'training' })}
            data-testid="twin-experience-launch-training"
          >
            {launch.train}
          </Button>
          <TwinCardExportMenu twinId={profile.id} twinName={profile.name} />
        </div>
      }
      toolbar={
        <>
          {role && <span className="typo-body text-foreground truncate max-w-[24rem]">{role}</span>}
          <span className="flex items-baseline gap-1.5" data-testid="twin-detail-readiness">
            <span className="typo-caption">{t.twin.blueprint.metrics.readiness}</span>
            <Numeric value={Math.round(readiness.score)} unit="percent" precision={0} className="typo-data text-foreground" />
          </span>
          {samplesOpen !== null && samplesOpen > 0 && (
            <Button
              variant="accent"
              tone="highlight"
              size="xs"
              onClick={() => setTwinTab('hub')}
              data-testid="twin-detail-proposals"
            >
              {tx(samplesOpen === 1 ? detail.proposals_one : detail.proposals_many, {
                count: formatCount(samplesOpen, { language }),
              })}
            </Button>
          )}
          <div className="ml-auto flex-1 min-w-[20rem] max-w-[30rem]">{switcher}</div>
        </>
      }
    />
  );
}

export default DetailHeader;
