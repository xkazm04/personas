// PROTOTYPE VARIANT A — "Console".
// Persistent mode header: a segmented [Manage · Dispatch] control always
// visible; Manage reveals an inline [Adopt · Share] toggle. Everything is on
// one screen — no landing step — so power users switch lanes in one click.
// Fixed height throughout; switching a lane swaps the list + detail in place.
import { useEffect, useState } from 'react';
import { Wand2 } from 'lucide-react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';

import { SkillListPane } from './SkillListPane';
import { SkillDetailPane } from './SkillDetailPane';
import { resolveLane, type ManageDirection, type SkillsWorkbench, type WorkbenchMode } from './skillsWorkbenchData';
import { WorkbenchCounts } from './workbenchChrome';

export function SkillsWorkbenchConsole({ wb, initialMode }: {
  wb: SkillsWorkbench;
  initialMode: WorkbenchMode;
}) {
  const [mode, setMode] = useState<WorkbenchMode>(initialMode);
  const [direction, setDirection] = useState<ManageDirection>('adopt');
  const [selected, setSelected] = useState<string | null>(null);

  const lane = resolveLane(wb, mode, direction);
  // New lane → clear the selection so the detail pane resets cleanly.
  useEffect(() => { setSelected(null); }, [mode, direction]);
  const active = lane.items.find((s) => s.name === selected) ?? null;

  return (
    <div className="flex flex-col h-[540px]">
      {/* identity + counts */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.04] flex-shrink-0">
        <Wand2 className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
        <span className="typo-title truncate">Skills — {wb.projectName}</span>
        <span className="ml-auto flex-shrink-0"><WorkbenchCounts counts={wb.counts} /></span>
      </div>

      {/* mode row */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-primary/10 flex-shrink-0">
        <SegmentedTabs
          tabs={[{ id: 'manage', label: 'Manage' }, { id: 'dispatch', label: 'Dispatch' }]}
          activeTab={mode}
          onTabChange={(m) => setMode(m as WorkbenchMode)}
          variant="segment"
          size="sm"
          fullWidth={false}
          ariaLabel="Skills mode"
        />
        {mode === 'manage' && (
          <SegmentedTabs
            tabs={[{ id: 'adopt', label: 'Adopt' }, { id: 'share', label: 'Share' }]}
            activeTab={direction}
            onTabChange={(d) => setDirection(d as ManageDirection)}
            variant="pill"
            size="sm"
            fullWidth={false}
            ariaLabel="Manage direction"
          />
        )}
        <span className="ml-auto typo-label text-foreground/35">
          {mode === 'dispatch' ? 'Run an installed skill' : direction === 'adopt' ? 'Bring skills into this repo' : 'Publish a skill to your library'}
        </span>
      </div>

      {/* two-pane body */}
      <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
        <div className="min-h-0 border-r border-primary/10">
          <SkillListPane
            items={lane.items}
            selected={selected}
            onSelect={setSelected}
            loading={lane.loading}
            emptyLabel={lane.emptyList}
          />
        </div>
        <div className="min-h-0">
          <SkillDetailPane
            key={`${mode}:${direction}:${selected ?? ''}`}
            skill={active}
            kind={lane.kind}
            busy={lane.busy}
            onAct={lane.run}
            emptyPrompt={lane.emptyDetail}
          />
        </div>
      </div>
    </div>
  );
}
