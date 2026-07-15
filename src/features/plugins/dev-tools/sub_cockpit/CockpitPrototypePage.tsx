// Project Cockpit — /prototype lab bench (docs/plans/dev-tools-cx-redesign.md §3).
//
// ROUND 8. Compare WON R7 (Ledger removed). This round absorbs the production
// Passport wall's readability concepts into Compare per the verdict: larger
// typography, brand icons for tools/stack (techIcons resolver, names kept
// visible), segmented level bars on level-based rows ("which level was
// reached"), and the upgrade mechanism on the majority of rows (hover gear →
// level-ladder popover with the row's action — write config / queue Claude
// task / wire connector; mock, not wired). Passport (ref) stays as baseline.
import { useState } from 'react';
import { FlaskConical } from 'lucide-react';

import { ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { SegmentedTabs, type SegmentedTab } from '@/features/shared/components/layout/SegmentedTabs';

import { CockpitBreadcrumb, NEON, SETUP_BLUE } from './cockpitGlyphs';
import { MOCK_PROJECTS, type MockProject } from './cockpitMock';
import { wallHealth } from './wallMock';
import CockpitL2Tabs from './CockpitL2Tabs';
import WallCompare from './WallCompare';
import WallPassportRef from './WallPassportRef';

type WallVariant = 'passport' | 'compare';

const WALL_TABS: SegmentedTab<WallVariant>[] = [
  { id: 'passport', label: 'Passport (ref)' },
  { id: 'compare', label: 'Compare' },
];

/** The project's worst-state hue — the breadcrumb/switcher dot. */
function worstHue(project: MockProject): string {
  const h = wallHealth(project);
  if (h.crit > 0) return NEON.red;
  if (h.warn > 0) return NEON.amber;
  if (h.total === 0) return SETUP_BLUE;
  return NEON.emerald;
}

function crumbNote(project: MockProject): string {
  const h = wallHealth(project);
  if (h.total === 0) return 'set up';
  if (h.crit > 0) return `${h.crit} critical`;
  if (h.warn > 0) return `${h.warn} warning`;
  return 'healthy';
}

export default function CockpitPrototypePage() {
  const [wallVariant, setWallVariant] = useState<WallVariant>('compare');
  const [projectId, setProjectId] = useState<string | null>(null);
  const project = projectId ? MOCK_PROJECTS.find((p) => p.id === projectId) ?? null : null;

  return (
    <ContentBox data-testid="cockpit-prototype">
      <ContentHeader
        icon={<FlaskConical className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Portfolio → Cockpit — prototype R13"
        subtitle="Project level synced to the real Factory L2: Module tabs (Overview default · KPIs · Context map · Observability) on populated mock data"
        fitWidth
        actions={
          project ? undefined : (
            <SegmentedTabs
              tabs={WALL_TABS}
              activeTab={wallVariant}
              onTabChange={setWallVariant}
              variant="segment"
              size="sm"
              fullWidth={false}
              ariaLabel="Wall variant (prototype)"
            />
          )
        }
      />

      <div className="mx-5 mt-3">
        <CockpitBreadcrumb
          root="Portfolio"
          rootNote={project ? undefined : `${MOCK_PROJECTS.length} projects · mock`}
          onRoot={project ? () => setProjectId(null) : undefined}
          leaf={
            project
              ? {
                  label: project.name,
                  hue: worstHue(project),
                  siblings: MOCK_PROJECTS.map((p) => ({
                    id: p.id,
                    label: p.name,
                    note: crumbNote(p),
                    hue: worstHue(p),
                  })),
                  onSelect: setProjectId,
                }
              : undefined
          }
        />
      </div>

      {project ? (
        <CockpitL2Tabs project={project} />
      ) : (
        <>
          {wallVariant === 'passport' && <WallPassportRef onOpenProject={setProjectId} />}
          {wallVariant === 'compare' && <WallCompare onOpenProject={setProjectId} />}
        </>
      )}
    </ContentBox>
  );
}
