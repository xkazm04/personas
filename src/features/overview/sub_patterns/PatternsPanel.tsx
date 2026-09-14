// Patterns — the Overview host for the knowledge surfaces. Two lanes
// (persisted per device, `Subjects` default), both READERS over the knowledge
// registry — the app never ingests it:
//
// - **Subjects** — the v2 knowledge hierarchy (Golden Paths → Techniques →
//   Applications → Evidence), read live from a managed repo's
//   `docs/concepts/paths/**` by the Rust reader. Needs only a project id —
//   no workspace.
// - **Coverage** — Project × registry-status grid over the paired knowledge
//   registry (docs/plans/registry-coverage-ui.md R2), successor to the
//   retired hierarchy-graph lane (2026-08-23).
//
// A third lane, **Practices**, rendered the in-app Workspace Knowledge library
// (a DB-backed practice store). It was retired together with that store: the
// external ai-registry is the knowledge authority now.
import { useState } from 'react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

import { CoverageLane } from './coverage/CoverageLane';
import { SubjectsView } from './hierarchy/SubjectsView';

type Lane = 'subjects' | 'coverage';

const LANE_KEY = 'patterns:lane';

function initialLane(): Lane {
  try {
    const stored = localStorage.getItem(LANE_KEY);
    if (stored === 'subjects' || stored === 'coverage') return stored;
  } catch (err) {
    // localStorage unavailable — default lane.
    silentCatch('patterns:laneRead')(err);
  }
  return 'subjects';
}

export default function PatternsPanel() {
  const { t } = useTranslation();
  const p = t.overview.patterns_v2;
  const [lane, setLane] = useState<Lane>(initialLane);

  const pickLane = (next: Lane) => {
    setLane(next);
    try {
      localStorage.setItem(LANE_KEY, next);
    } catch (err) {
      // Persistence is a convenience, never a blocker.
      silentCatch('patterns:laneWrite')(err);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-4 md:p-6 gap-3">
      <div className="flex-shrink-0">
        <SegmentedTabs<Lane>
          tabs={[
            { id: 'subjects', label: p.lane_subjects },
            { id: 'coverage', label: p.lane_coverage },
          ]}
          activeTab={lane}
          onTabChange={pickLane}
          ariaLabel={p.lane_switch_aria}
          fullWidth={false}
        />
      </div>

      {lane === 'subjects' ? <SubjectsView /> : <CoverageLane />}
    </div>
  );
}
