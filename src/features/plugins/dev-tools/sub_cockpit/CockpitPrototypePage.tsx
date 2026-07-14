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
import CockpitCards from './CockpitCards';
import CockpitFocus from './CockpitFocus';

// R6: Cards won R5 (editorial identity); Plates + Console removed. Focus fuses
// Console's group boxes into Cards' skin with a focus-first content strategy:
// the divider IS a thin KPI-progress line, all-green plates recede (title
// readable, the rest faded on a green wash), and a new blue SETUP state marks
// unconfigured contexts (KPI not defined / sensors unwired). Tooltips are now
// ELEMENT-ANCHORED (the R5 cursor anchoring drifted near window edges).
type VariantId = 'focus' | 'cards';

const VARIANT_TABS: SegmentedTab<VariantId>[] = [
  { id: 'focus', label: 'Focus' },
  { id: 'cards', label: 'Cards (R5 ref)' },
];

export default function CockpitPrototypePage() {
  const [variant, setVariant] = useState<VariantId>('focus');
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
        title="Health grid — prototype R6"
        subtitle="First layer · KPI-progress dividers · greens recede, blue = setup needed · anchored tooltips · click-through is a later round"
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
      {variant === 'focus' && <CockpitFocus project={project} />}
      {variant === 'cards' && <CockpitCards project={project} />}
    </ContentBox>
  );
}
