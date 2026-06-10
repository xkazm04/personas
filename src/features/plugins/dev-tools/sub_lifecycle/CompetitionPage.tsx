/**
 * CompetitionPage — standalone dev-tools surface for multi-clone strategy
 * competitions. Promoted out of the old Lifecycle tab strip into its own
 * sidebar item so the competition workflow stands on its own. The body is the
 * existing CompetitionList; this shell adds the page header + project picker
 * so it matches every other dev-tools page.
 */
import { Swords } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { LifecycleProjectPicker } from './LifecycleProjectPicker';
import { CompetitionList } from './competitions/CompetitionList';

export default function CompetitionPage() {
  const { t } = useTranslation();
  const activeProject = useSystemStore((s) => s.projects.find((p) => p.id === s.activeProjectId));

  return (
    <ContentBox>
      <ContentHeader
        icon={<Swords className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={t.plugins.dev_tools.competition_title}
        subtitle={activeProject?.root_path ?? '—'}
        actions={<LifecycleProjectPicker />}
      />
      <ContentBody>
        <CompetitionList />
      </ContentBody>
    </ContentBox>
  );
}
