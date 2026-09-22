// Curator > Setup - the switch and the mapped registries.
//
// Her prerequisite is not hers to grant: a registry is mapped to a workspace in
// Dev Tools, and until one is, her switch stays locked and says why. The
// section below is the read of that wiring plus the one trip to where it is
// made.
import { BookOpen } from 'lucide-react';

import { SettingRow } from '@/features/shared/components/forms/SettingRow';
import {
  ContentBody,
  ContentBox,
  ContentHeader,
} from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';

import { useCompanionSwitch } from '../../status/useCompanionSwitch';
import { MappedRegistriesSection } from './MappedRegistriesSection';

export default function CuratorSetupPage() {
  const { t } = useTranslation();
  const { status, loading, locked, prerequisite, toggle } = useCompanionSwitch('curator');

  return (
    <ContentBox>
      <ContentHeader
        icon={<BookOpen className="w-4 h-4" />}
        iconColor="cyan"
        title={t.companions.nav.group_curator}
        subtitle={t.companions.identity.curator_tagline}
      />
      <ContentBody>
        <div className="space-y-6 max-w-3xl">
          <section className="space-y-2">
            <h3 className="typo-title">{t.companions.setup.enable_section}</h3>
            <SettingRow
              icon={<BookOpen className="w-4 h-4 text-cyan-400" />}
              label={t.companions.setup.curator_enable}
              description={
                <>
                  {t.companions.setup.curator_enable_desc}
                  {/* Locked is not broken: the control names the missing
                      prerequisite rather than going grey in silence. */}
                  {prerequisite ? (
                    <span className="block mt-1 text-[var(--status-warning)]">{prerequisite}</span>
                  ) : null}
                </>
              }
              checked={status?.enabled ?? false}
              disabled={loading || locked}
              onChange={() => void toggle()}
              testId="curator-enable-toggle"
            />
          </section>

          <MappedRegistriesSection />
        </div>
      </ContentBody>
    </ContentBox>
  );
}
