// Unified Skills Workbench — the SINGLE skills surface shared by the Passport
// wall (skills cell) and the Mastermind canvas (green Skills cell). Same
// typography, panes, and operations from both entry points:
//   · Manage  → adopt from library / share to library   (Passport lane)
//   · Dispatch → run an installed skill via Fleet         (Mastermind lane)
//
// A landing chooser is the first content (two cards — Manage vs Dispatch, each
// with its icon as an illustrative background watermark); picking one enters a
// two-pane workbench (title-only list + detail) with a breadcrumb back. Fixed
// height throughout so the modal never resizes on lane-switch or select.
// `initialMode` lets each entry point land straight in its natural lane.
import { useEffect, useState } from 'react';
import { ChevronLeft, Puzzle, Rocket, Wand2 } from 'lucide-react';

import { BaseModal } from '@/features/shared/components/modals';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';

import { SkillListPane } from './SkillListPane';
import { SkillDetailPane } from './SkillDetailPane';
import { resolveLane, useSkillsWorkbench, type ManageDirection, type WorkbenchMode } from './skillsWorkbenchData';
import { WorkbenchCounts } from './workbenchChrome';

export function SkillsWorkbench({ slug, initialMode, onClose }: {
  slug: string;
  /** Entry-point lane: Passport opens on 'manage', Mastermind on 'dispatch'.
   *  Undefined shows the landing chooser first (the neutral entry). */
  initialMode?: WorkbenchMode;
  onClose: () => void;
}) {
  const wb = useSkillsWorkbench(slug);
  const [mode, setMode] = useState<WorkbenchMode | null>(initialMode ?? null);
  const [direction, setDirection] = useState<ManageDirection>('adopt');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => { setSelected(null); }, [mode, direction]);
  if (!wb) return null;

  return (
    <BaseModal isOpen onClose={onClose} titleId="skills-workbench-title" size="lg" portal staggerChildren={false}>
      <span id="skills-workbench-title" className="sr-only">Skills — {wb.projectName}</span>
      <div className="flex flex-col h-[540px]">
        {mode === null ? (
          <>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.04] flex-shrink-0">
              <Wand2 className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
              <span className="typo-title truncate">Skills — {wb.projectName}</span>
              <span className="ml-auto flex-shrink-0"><WorkbenchCounts counts={wb.counts} /></span>
            </div>
            <div className="flex-1 min-h-0 grid grid-cols-2 gap-4 p-6">
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
                body="Run an installed skill now as a background Fleet session in the project root. You stay where you are."
                meta={wb.dispatch.loading ? 'loading…' : `${wb.dispatch.items.length} installed`}
                onClick={() => setMode('dispatch')}
                testid="skills-workbench-choose-dispatch"
              />
            </div>
          </>
        ) : (
          <Workbench
            wb={wb}
            mode={mode}
            direction={direction}
            selected={selected}
            onSelect={setSelected}
            onDirection={setDirection}
            onBack={() => setMode(null)}
          />
        )}
      </div>
    </BaseModal>
  );
}

function Workbench({ wb, mode, direction, selected, onSelect, onDirection, onBack }: {
  wb: NonNullable<ReturnType<typeof useSkillsWorkbench>>;
  mode: WorkbenchMode;
  direction: ManageDirection;
  selected: string | null;
  onSelect: (name: string) => void;
  onDirection: (d: ManageDirection) => void;
  onBack: () => void;
}) {
  const lane = resolveLane(wb, mode, direction);
  const active = lane.items.find((s) => s.name === selected) ?? null;

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-primary/10 bg-primary/[0.04] flex-shrink-0">
        <button
          type="button"
          onClick={onBack}
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
              onTabChange={(d) => onDirection(d as ManageDirection)}
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
            onSelect={onSelect}
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
    </>
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
      className="group relative overflow-hidden flex flex-col items-start text-left gap-2 p-5 rounded-card border border-primary/12 bg-secondary/[0.15] hover:bg-primary/[0.06] hover:border-primary/30 transition-colors focus-ring"
      data-testid={testid}
    >
      {/* illustrative background watermark — the lane's icon, oversized + faint */}
      <Icon
        className="pointer-events-none absolute -right-5 -bottom-6 w-32 h-32 text-primary/[0.06] group-hover:text-primary/[0.11] transition-colors"
        strokeWidth={1.25}
        aria-hidden
      />
      <span className="relative typo-body font-semibold text-foreground">{title}</span>
      <span className="relative typo-caption text-foreground/60 leading-snug" style={{ fontWeight: 400 }}>{body}</span>
      <span className="relative typo-label text-foreground/40 mt-auto pt-1">{meta}</span>
    </button>
  );
}
