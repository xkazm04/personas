// Project Cockpit — /prototype R1 lab bench (docs/plans/dev-tools-cx-redesign.md §3).
//
// MOCK DATA ONLY — nothing here touches stores or IPC. Mounted on the vestigial
// `skills` DevToolsTab (which previously dead-ended into FleetPage), plus a
// temporary "Cockpit (proto)" sidebar entry so it's reachable for review.
//
// Two directional variants over IDENTICAL props (the A/B is layout, not data):
//   • Dimension board — mission-control measurement grid, dimensions as bands
//   • Strategy ledger — goals as the spine; KPI/feature/finding as indented rows
// Three projects at the three wiring tiers (full / half / bare) — switching tier
// is the test of "measurement before opinion": a bare project must become an
// establishment journey, never a broken dashboard.
import { useState } from 'react';
import { FlaskConical } from 'lucide-react';

import { ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { SegmentedTabs, type SegmentedTab } from '@/features/shared/components/layout/SegmentedTabs';
import { MOCK_PROJECTS } from './cockpitMock';
import CockpitDimensionBoard from './CockpitDimensionBoard';
import CockpitStrategyLedger from './CockpitStrategyLedger';

type VariantId = 'board' | 'ledger';

const VARIANT_TABS: SegmentedTab<VariantId>[] = [
  { id: 'board', label: 'Dimension board' },
  { id: 'ledger', label: 'Strategy ledger' },
];

export default function CockpitPrototypePage() {
  const [variant, setVariant] = useState<VariantId>('board');
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
        title="Project Cockpit — prototype R1"
        subtitle="Mock data · dimension-based KPI detail view · dispatch + wiring CTAs are stubs"
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
              ariaLabel="Cockpit variant (prototype)"
            />
          </div>
        }
      />
      {variant === 'board'
        ? <CockpitDimensionBoard project={project} />
        : <CockpitStrategyLedger project={project} />}
    </ContentBox>
  );
}
