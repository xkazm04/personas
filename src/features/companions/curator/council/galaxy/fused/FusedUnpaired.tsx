// The fused stage before a registry is paired: the same state, words and
// ways out the classic stage offers, because unpaired is a state of the page,
// not of the variant.
import { Link2 } from 'lucide-react';

import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { COUNCIL_UNPAIRED_GLYPH } from '@/features/shared/glyph/glyphs/councilUnpairedGlyph';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';

import { useCouncilStore } from '../../councilStore';
import { IS_DEV } from '../fixture';

export function FusedUnpaired() {
  const { t } = useTranslation();
  const g = t.council.galaxy;
  const loadFixture = useCouncilStore((s) => s.loadFixture);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  return (
    <div className="flex h-full flex-1 items-center justify-center" data-testid="council-unpaired">
      <EmptyState
        glyph={COUNCIL_UNPAIRED_GLYPH}
        icon={Link2}
        title={g.unpaired_title}
        description={g.unpaired_description}
        action={{
          label: g.unpaired_action,
          onClick: () => {
            setSidebarSection('plugins');
            setDevToolsTab('workspaces');
          },
        }}
        secondaryAction={IS_DEV ? { label: g.fixture_action, onClick: () => void loadFixture() } : undefined}
      />
    </div>
  );
}

export default FusedUnpaired;
