// Project Cockpit — /prototype lab bench (docs/plans/dev-tools-cx-redesign.md §3).
//
// ROUND 7. Focus WON R6 and is consolidated as the project-level cockpit (Cards
// removed). The bench grows the layer ABOVE: the inter-project PORTFOLIO wall.
// Three variants, all reading the SAME three mock passports through the SAME
// row spec as Factory's production wall:
//   • Passport (ref) — the production ProjectsPassportWall, unmodified: the
//     baseline every restyle is judged against.
//   • Ledger  — projects as stacked Focus row boxes (scan down the register).
//   • Compare — the passport's side-by-side columns in Focus ink.
// Navigation hierarchy: Portfolio → project cockpit. A project title in any
// wall variant is the door into Focus; the new breadcrumb carries the way back
// AND a sibling switcher on the leaf crumb (jump between projects in place).
import { useState } from 'react';
import { FlaskConical } from 'lucide-react';

import { ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { SegmentedTabs, type SegmentedTab } from '@/features/shared/components/layout/SegmentedTabs';

import { CockpitBreadcrumb, NEON, SETUP_BLUE } from './cockpitGlyphs';
import { MOCK_PROJECTS, type MockProject } from './cockpitMock';
import { wallHealth } from './wallMock';
import CockpitFocus from './CockpitFocus';
import WallCompare from './WallCompare';
import WallLedger from './WallLedger';
import WallPassportRef from './WallPassportRef';

type WallVariant = 'passport' | 'ledger' | 'compare';

const WALL_TABS: SegmentedTab<WallVariant>[] = [
  { id: 'passport', label: 'Passport (ref)' },
  { id: 'ledger', label: 'Ledger' },
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
  const [wallVariant, setWallVariant] = useState<WallVariant>('ledger');
  const [projectId, setProjectId] = useState<string | null>(null);
  const project = projectId ? MOCK_PROJECTS.find((p) => p.id === projectId) ?? null : null;

  return (
    <ContentBox data-testid="cockpit-prototype">
      <ContentHeader
        icon={<FlaskConical className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Portfolio → Cockpit — prototype R7"
        subtitle="Focus consolidated as the cockpit · new layer above: inter-project wall (3 variants) · titles open the cockpit · breadcrumb navigates back + switches siblings"
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
        <CockpitFocus project={project} />
      ) : (
        <>
          {wallVariant === 'passport' && <WallPassportRef onOpenProject={setProjectId} />}
          {wallVariant === 'ledger' && <WallLedger onOpenProject={setProjectId} />}
          {wallVariant === 'compare' && <WallCompare onOpenProject={setProjectId} />}
        </>
      )}
    </ContentBox>
  );
}
