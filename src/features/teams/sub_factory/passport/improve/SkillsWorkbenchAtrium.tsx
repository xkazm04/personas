// PROTOTYPE VARIANT B — "Atrium".
// A landing chooser is the first content: two large cards — Manage vs Dispatch
// — each stating its purpose. Picking one enters the two-pane workbench with a
// slim breadcrumb back to the chooser. Deliberate: the lane is a decision, not
// a toggle. Fixed height; the chooser is centered in the same box the workbench
// fills, so entering/leaving never resizes the modal.
import { useEffect, useState } from 'react';
import { ChevronLeft, Puzzle, Rocket, Wand2 } from 'lucide-react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';

import { SkillListPane } from './SkillListPane';
import { SkillDetailPane } from './SkillDetailPane';
import { resolveLane, type ManageDirection, type SkillsWorkbench, type WorkbenchMode } from './skillsWorkbenchData';
import { WorkbenchCounts } from './workbenchChrome';

export function SkillsWorkbenchAtrium({ wb }: { wb: SkillsWorkbench }) {
  const [mode, setMode] = useState<WorkbenchMode | null>(null);
  const [direction, setDirection] = useState<ManageDirection>('adopt');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => { setSelected(null); }, [mode, direction]);

  // Landing chooser
  if (mode === null) {
    return (
      <div className="flex flex-col h-[540px]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.04] flex-shrink-0">
          <Wand2 className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
          <span className="typo-title truncate">Skills — {wb.projectName}</span>
          <span className="ml-auto flex-shrink-0"><WorkbenchCounts counts={wb.counts} /></span>
        </div>
        <div className="flex-1 min-h-0 grid grid-cols-2 gap-4 p-6 place-items-stretch">
          <ChoiceCard
            icon={Puzzle}
            title="Manage skills"
            body="Adopt shared skills into this repo, or publish yours to the library. Claude does the customizing."
            meta={`${wb.adopt.items.length} to adopt · ${wb.share.items.length} to share`}
            onClick={() => { setDirection('adopt'); setMode('manage'); }}
            testid="skills-workbench-choose-manage"
          />
          <ChoiceCard
            icon={Rocket}
            title="Dispatch a skill"
            body="Run an installed skill now as a background Fleet session in the project root — you stay on the canvas."
            meta={wb.dispatch.loading ? 'loading…' : `${wb.dispatch.items.length} installed`}
            onClick={() => setMode('dispatch')}
            testid="skills-workbench-choose-dispatch"
          />
        </div>
      </div>
    );
  }

  const lane = resolveLane(wb, mode, direction);
  const active = lane.items.find((s) => s.name === selected) ?? null;

  return (
    <div className="flex flex-col h-[540px]">
      {/* breadcrumb header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-primary/10 bg-primary/[0.04] flex-shrink-0">
        <button
          type="button"
          onClick={() => setMode(null)}
          className="inline-flex items-center gap-1 pl-1 pr-2 py-1 rounded-interactive typo-caption text-foreground/60 hover:text-foreground hover:bg-primary/10 transition-colors"
          data-testid="skills-workbench-back"
        >
          <ChevronLeft className="w-3.5 h-3.5" aria-hidden />
          Skills
        </button>
        <span className="typo-caption text-foreground/30">/</span>
        <span className="typo-caption font-medium text-foreground">{mode === 'dispatch' ? 'Dispatch' : 'Manage'}</span>
        <span className="typo-label text-foreground/40 truncate">· {wb.projectName}</span>
        {mode === 'manage' && (
          <span className="ml-auto flex-shrink-0">
            <SegmentedTabs
              tabs={[{ id: 'adopt', label: 'Adopt' }, { id: 'share', label: 'Share' }]}
              activeTab={direction}
              onTabChange={(d) => setDirection(d as ManageDirection)}
              variant="pill"
              size="sm"
              fullWidth={false}
              ariaLabel="Manage direction"
            />
          </span>
        )}
      </div>

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

function ChoiceCard({ icon: Icon, title, body, meta, onClick, testid }: {
  icon: typeof Rocket;
  title: string;
  body: string;
  meta: string;
  onClick: () => void;
  testid: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-start text-left gap-2 p-5 rounded-card border border-primary/12 bg-secondary/[0.15] hover:bg-primary/[0.06] hover:border-primary/30 transition-colors focus-ring"
      data-testid={testid}
    >
      <span className="inline-flex items-center justify-center w-9 h-9 rounded-card bg-primary/12 text-primary group-hover:bg-primary/20 transition-colors">
        <Icon className="w-5 h-5" aria-hidden />
      </span>
      <span className="typo-body font-semibold text-foreground mt-1">{title}</span>
      <span className="typo-caption text-foreground/60 leading-snug" style={{ fontWeight: 400 }}>{body}</span>
      <span className="typo-label text-foreground/40 mt-auto pt-1">{meta}</span>
    </button>
  );
}
