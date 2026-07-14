// Project Cockpit — /prototype lab bench (docs/plans/dev-tools-cx-redesign.md §3).
//
// ROUND 2. R1's variants (Dimension board / Strategy ledger) were rejected —
// stitching existing module styles (passport seals, coverage chips, verdict
// pills) together read as a collage, not a design. R2 starts from a blank
// creative slate: custom component sets per variant, with Personas theming
// (dark surface, neon accent discipline, typo-* scale, radii/elevation) as the
// ONLY inherited frame. Mock data only; nothing touches stores or IPC.
//
//   • Pulse Monitor — a flight/medical instrument panel: readiness meters, a
//     wiring power-rail, the loop's week as an ECG strip, feature telemetry
//     channels with live traces, an arc-gauge cluster. Unwired = unlit glass.
//   • Transit lines — the strategy as a transit network: each goal a glowing
//     line whose bright portion IS its progress, features as stations showing
//     their headline number, findings as branch stubs ending in verdict glyphs,
//     each line terminating in a dispatch platform.
import { useState } from 'react';
import { FlaskConical } from 'lucide-react';

import { ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { SegmentedTabs, type SegmentedTab } from '@/features/shared/components/layout/SegmentedTabs';
import { MOCK_PROJECTS } from './cockpitMock';
import CockpitPulseMonitor from './CockpitPulseMonitor';
import CockpitTransitLines from './CockpitTransitLines';

type VariantId = 'pulse' | 'transit';

const VARIANT_TABS: SegmentedTab<VariantId>[] = [
  { id: 'pulse', label: 'Pulse Monitor' },
  { id: 'transit', label: 'Transit lines' },
];

export default function CockpitPrototypePage() {
  const [variant, setVariant] = useState<VariantId>('pulse');
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
        title="Project Cockpit — prototype R2"
        subtitle="Mock data · custom component sets, theme frame only · dispatch + wiring CTAs are stubs"
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
      {variant === 'pulse'
        ? <CockpitPulseMonitor project={project} />
        : <CockpitTransitLines project={project} />}
    </ContentBox>
  );
}
