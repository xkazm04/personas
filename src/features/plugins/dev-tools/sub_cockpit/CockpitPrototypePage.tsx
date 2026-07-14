// Project Cockpit — /prototype lab bench (docs/plans/dev-tools-cx-redesign.md §3).
//
// ROUND 3. R1 (reuse-collage) and R2 (Pulse Monitor / Transit lines) both
// rejected — R2's failure was informational, not stylistic: text labels
// overflow and truncate at real scale. A solid project has 50–100 contexts;
// the FIRST LAYER must read as health at a glance, which means COLOUR +
// SYMBOLICS carry the information and names exist only on demand (tooltips).
// Click-through to specific KPIs is a LATER round.
//
// The R3 grid: one cell per context, grouped into context groups. Variants
// differ in how the grid is composed into dimensions and how group-level
// status is indicated:
//   • Floorplan — composed spatially BY GROUP (chip die-map); cell = dominant
//     worst-wins colour + one loop glyph; group status = tinted frame + lamp.
//     Answers "WHERE in my system is it unhealthy?"
//   • Spectrum — composed BY DIMENSION inside each cell (2×2 quadrants:
//     errors|cost / kpi|loop); rows + cells sort worst-first (triage order);
//     group status = four per-dimension lamps on the rail. Answers "WHAT KIND
//     of unhealthy?" — and an unwired sensor reads as a dark quadrant column.
import { useState } from 'react';
import { FlaskConical } from 'lucide-react';

import { ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { SegmentedTabs, type SegmentedTab } from '@/features/shared/components/layout/SegmentedTabs';
import { MOCK_PROJECTS } from './cockpitMock';
import CockpitFloorplan from './CockpitFloorplan';
import CockpitPlates from './CockpitPlates';
import CockpitWeighted from './CockpitWeighted';

// R4: Floorplan won R3's composition; Spectrum deleted. The new A/B keeps the
// group-block die-map but puts CONTEXT NAMES on the rectangles — state readable
// at first sight, no tooltip required. Plates = uniform name-plates in
// architectural order (spatial memory); Weighted = severity-sized tiles in
// worst-first order (the layout itself triages). Floorplan stays as the R3
// reference for glanceability comparison.
type VariantId = 'plates' | 'weighted' | 'floorplan';

const VARIANT_TABS: SegmentedTab<VariantId>[] = [
  { id: 'plates', label: 'Plates' },
  { id: 'weighted', label: 'Weighted' },
  { id: 'floorplan', label: 'Floorplan (R3 ref)' },
];

export default function CockpitPrototypePage() {
  const [variant, setVariant] = useState<VariantId>('plates');
  const [projectId, setProjectId] = useState(MOCK_PROJECTS[0]!.id);
  const project = MOCK_PROJECTS.find((p) => p.id === projectId) ?? MOCK_PROJECTS[0]!;

  const projectTabs: SegmentedTab<string>[] = MOCK_PROJECTS.map((p) => ({
    id: p.id,
    label: `${p.name} (${p.tier})`,
  }));

  return (
    <ContentBox data-testid="cockpit-prototype">
      <ContentHeader
        icon={<FlaskConical className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Health grid — prototype R4"
        subtitle="First layer · named context rectangles (50–100) · state at first sight, no tooltips needed · KPI click-through is a later round"
        fitWidth
        actions={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <SegmentedTabs
              tabs={projectTabs}
              activeTab={project.id}
              onTabChange={setProjectId}
              variant="pill"
              size="sm"
              fullWidth={false}
              ariaLabel="Mock project (wiring tier)"
            />
            <SegmentedTabs
              tabs={VARIANT_TABS}
              activeTab={variant}
              onTabChange={setVariant}
              variant="segment"
              size="sm"
              fullWidth={false}
              ariaLabel="Grid variant (prototype)"
            />
          </div>
        }
      />
      {variant === 'plates' && <CockpitPlates project={project} />}
      {variant === 'weighted' && <CockpitWeighted project={project} />}
      {variant === 'floorplan' && <CockpitFloorplan project={project} />}
    </ContentBox>
  );
}
