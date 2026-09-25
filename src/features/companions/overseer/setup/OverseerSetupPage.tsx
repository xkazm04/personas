// Overseer > Setup - the switch and the watched roster.
//
// The page answers two questions and nothing else: is he on, and who is he
// watching. His prerequisite is the roster, so the two sections are one story
// read downwards - the switch states what is missing, the section below is
// where you fix it.
import { Eye } from 'lucide-react';

import { SettingRow } from '@/features/shared/components/forms/SettingRow';
import {
  ContentBody,
  ContentBox,
  ContentHeader,
} from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';

import { useCompanionSwitch } from '../../status/useCompanionSwitch';
import { WatchedAgentsSection } from './WatchedAgentsSection';

export default function OverseerSetupPage() {
  const { t } = useTranslation();
  const { status, loading, locked, prerequisite, toggle } = useCompanionSwitch('overseer');

  return (
    <ContentBox>
      <ContentHeader
        icon={<Eye className="w-4 h-4" />}
        iconColor="violet"
        title={t.companions.nav.group_overseer}
        subtitle={t.companions.identity.overseer_tagline}
      />
      <ContentBody>
        <div className="space-y-6 max-w-3xl">
          <section className="space-y-2">
            <h3 className="typo-title">{t.companions.setup.enable_section}</h3>
            <SettingRow
              icon={<Eye className="w-4 h-4 text-violet-400" />}
              label={t.companions.setup.overseer_enable}
              description={
                <>
                  {t.companions.setup.overseer_enable_desc}
                  {/* Locked is not broken: the control says on itself which
                      prerequisite is missing, instead of going grey in silence. */}
                  {prerequisite ? (
                    <span className="block mt-1 text-[var(--status-warning)]">{prerequisite}</span>
                  ) : null}
                </>
              }
              checked={status?.enabled ?? false}
              disabled={loading || locked}
              onChange={() => void toggle()}
              testId="overseer-enable-toggle"
            />
          </section>

          <WatchedAgentsSection />
        </div>
      </ContentBody>
    </ContentBox>
  );
}
