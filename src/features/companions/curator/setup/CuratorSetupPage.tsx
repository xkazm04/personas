// Curator > Setup - the switch, the mapped registries, and every brake on her.
//
// Her prerequisite is not hers to grant: a registry is mapped to a workspace in
// Dev Tools, and until one is, her switch stays locked and says why. The
// section below is the read of that wiring plus the one trip to where it is
// made.
//
// ## Why the policy sections are the safety surface
//
// All nine policy settings existed in `app_settings` - allow-listed, validated
// in Rust, projected as one typed `CuratorPolicy` - and NOTHING in the frontend
// read or wrote any of them. The page rendered exactly one toggle.
//
// That matters more here than it would for most settings, because her standing
// instruction is that she never idles: on an empty queue she re-runs the
// projection and keeps going. The daily budget, the daily run cap and the daily
// commit cap are therefore the only three things that ever stop her. They are
// not configuration; they are the brakes, and a brake nobody can reach is not a
// brake.
import { BookOpen } from 'lucide-react';

import { SettingRow } from '@/features/shared/components/forms/SettingRow';
import {
  ContentBody,
  ContentBox,
  ContentHeader,
} from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';

import { useCompanionSwitch } from '../../status/useCompanionSwitch';
import { CuratorAuthoritySection } from './CuratorAuthoritySection';
import { CuratorBrakesSection } from './CuratorBrakesSection';
import { CuratorLoopSection } from './CuratorLoopSection';
import { MappedRegistriesSection } from './MappedRegistriesSection';
import { useCuratorPolicy } from './useCuratorPolicy';

export default function CuratorSetupPage() {
  const { t } = useTranslation();
  const { status, loading, locked, prerequisite, toggle } = useCompanionSwitch('curator');
  const { policy, runtime, write } = useCuratorPolicy();

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

          {/* The three brakes first: they are the only things that stop her,
              so they lead rather than sitting under the authority levels. */}
          <CuratorBrakesSection policy={policy} runtime={runtime} write={write} />
          <CuratorLoopSection policy={policy} runtime={runtime} write={write} />
          <CuratorAuthoritySection policy={policy} write={write} />
        </div>
      </ContentBody>
    </ContentBox>
  );
}
