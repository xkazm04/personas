// Unified Skills Workbench — the SINGLE skills surface shared by the Passport
// wall (skills cell) and the Mastermind canvas (green Skills cell).
//
//   · Manage   → the Dev Tools Skills **Overview** board  (Passport lane)
//   · Dispatch → the Dev Tools Skills **Registry** heatmap (Mastermind lane)
//
// Both lanes now mount the dev-tools components verbatim rather than a modal-
// only reimplementation. The workbench previously carried its own two-pane
// list+detail (SkillListPane/SkillDetailPane, resolveLane) which could adopt,
// share and dispatch but showed none of what the real Skills module shows —
// coverage bars, memory bindings, usage/last-used, the preset library split,
// the context picker, the workspace adoption matrix. Two skills UIs meant every
// improvement had to be built twice; deleting the modal-only one closes that.
//
// The landing is a half/half chooser: the Manage card enters the board, while
// the Dispatch card carries a LIVE quick-dispatch ledger — every installed
// skill with its total context coverage, one click = a no-args Fleet run (the
// skill picks its own context). The full registry (aimed dispatch at a specific
// context group) stays one click away from the card header. `initialMode` lets
// each entry point land straight in its natural lane. The modal is `6xl` and
// tall because these surfaces are a two-panel board and a skills × projects
// matrix, not a list.
import { useState } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { ArrowRight, ChevronLeft, Puzzle, Rocket, Wand2 } from 'lucide-react';

import { BaseModal } from '@/features/shared/components/modals';
import { RegistryTab } from '@/features/plugins/dev-tools/sub_skills/registry/RegistryTab';
import { SkillInfoModal } from '@/features/plugins/dev-tools/sub_skills/SkillInfoModal';
import { SkillsOverviewPanel } from '@/features/plugins/dev-tools/sub_skills/SkillsOverviewPanel';
import { useTranslation } from '@/i18n/useTranslation';

import { useQuickDispatch } from './quickDispatch';
import { QuickDispatchLedger } from './QuickDispatchLedger';
import { useSkillsWorkbench, type WorkbenchMode } from './skillsWorkbenchData';
import { WorkbenchCounts } from './workbenchChrome';

export function SkillsWorkbench({ slug, initialMode, onClose }: {
  slug: string;
  /** Entry-point lane: Passport opens on 'manage', Mastermind on 'dispatch'.
   *  Undefined shows the landing chooser first (the neutral entry). */
  initialMode?: WorkbenchMode;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const wb = useSkillsWorkbench(slug);
  const [mode, setMode] = useState<WorkbenchMode | null>(initialMode ?? null);
  // Registry's skill-name click opens the shared metadata modal; Manage's lives
  // inside SkillsOverviewPanel.
  const [infoSkill, setInfoSkill] = useState<string | null>(null);
  // Quick-dispatch (landing): aggregate coverage per installed skill.
  const quick = useQuickDispatch(slug);
  const [busySkill, setBusySkill] = useState<string | null>(null);

  if (!wb) return null;

  const dispatchQuick = (name: string) => {
    setBusySkill(name);
    // No arguments: the skill decides its own context; Fleet is the channel.
    void wb.runDispatch(name, '').finally(() => setBusySkill(null));
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId="skills-workbench-title" size="6xl" portal staggerChildren={false}>
      <span id="skills-workbench-title" className="sr-only">{tx(d.skills_workbench_title, { name: wb.projectName })}</span>
      <div className="flex flex-col h-[calc(100dvh-160px)] min-h-[520px] max-h-[760px]">
        {mode === null ? (
          <>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-hair bg-surface-1 flex-shrink-0">
              <Wand2 className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
              <span className="typo-title truncate">{tx(d.skills_workbench_title, { name: wb.projectName })}</span>
              <span className="ml-auto flex-shrink-0"><WorkbenchCounts counts={wb.counts} /></span>
            </div>
            <div className="flex-1 min-h-0 grid grid-cols-2 gap-4 p-6">
              {/* ── Manage half — enters the full skills board ──────────── */}
              <ChoiceCard
                icon={Puzzle}
                title={d.skills_workbench_manage_title}
                body={d.skills_workbench_manage_body}
                meta={tx(d.skills_workbench_manage_meta, { adopt: wb.adopt.items.length, share: wb.share.items.length })}
                onClick={() => setMode('manage')}
                testid="skills-workbench-choose-manage"
              />

              {/* ── Dispatch half — live quick-dispatch ledger in place ─── */}
              <div className="relative flex flex-col gap-2 p-5 min-h-0 rounded-card border border-hair bg-surface-1">
                <div className="flex items-start gap-2">
                  <CardTitle icon={Rocket} title={d.skills_workbench_dispatch_title} />
                  {/* the aimed path: skill × context-group registry */}
                  <Button variant="secondary" size="sm" className="ml-auto flex-shrink-0" onClick={() => setMode('dispatch')} data-testid="skills-workbench-choose-dispatch" iconRight={<ArrowRight className="w-3 h-3" aria-hidden />}>
{d.skills_workbench_open_registry}
</Button>
                </div>
                <p className="typo-caption text-ink-3" style={{ fontWeight: 400 }}>
                  {d.skills_workbench_dispatch_body}
                </p>
                <div className="flex-1 min-h-0 overflow-y-auto mt-1">
                  <QuickDispatchLedger model={quick} busySkill={busySkill} onDispatch={dispatchQuick} />
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-hair bg-surface-1 flex-shrink-0">
              <Button variant="ghost" size="sm" onClick={() => setMode(null)} data-testid="skills-workbench-back" icon={<ChevronLeft className="w-3.5 h-3.5" aria-hidden />}>
{d.skills_title}
</Button>
              <span className="typo-caption text-ink-3">/</span>
              <span className="typo-caption text-ink-2">
                {mode === 'dispatch' ? d.skills_workbench_crumb_registry : d.skills_workbench_crumb_manage}
              </span>
              <span className="typo-label text-ink-3 truncate">· {wb.projectName}</span>
              <span className="ml-auto flex-shrink-0"><WorkbenchCounts counts={wb.counts} /></span>
            </div>

            <div className="flex-1 min-h-0 p-3">
              {/* The canvas's registry looks INWARD: columns are this
                  project's context groups, not the workspace's projects, and
                  every cell dispatches (nothing is adopted per context). */}
              {mode === 'dispatch'
                ? <RegistryTab activeProjectId={slug} axis="project" onOpenInfo={setInfoSkill} />
                : <SkillsOverviewPanel projectId={slug} />}
            </div>
          </>
        )}
      </div>

      {infoSkill && (
        <SkillInfoModal skillName={infoSkill} projectId={slug} onClose={() => setInfoSkill(null)} />
      )}
    </BaseModal>
  );
}

/** Promoted card heading — same type + accent as the modal header (typo-title,
 *  primary icon), so each half reads with the header's weight. */
function CardTitle({ icon: Icon, title }: { icon: typeof Rocket; title: string }) {
  return (
    <span className="relative inline-flex items-center gap-2 min-w-0">
      <Icon className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
      <span className="typo-title truncate">{title}</span>
    </span>
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
      className="group relative overflow-hidden flex flex-col items-start text-left gap-2 p-5 rounded-card border border-hair bg-surface-1 hover:bg-surface-2 hover:border-hair transition-colors focus-ring"
      data-testid={testid}
    >
      {/* illustrative background watermark — the lane's icon, oversized + faint */}
      <Icon
        className="pointer-events-none absolute -right-5 -bottom-6 w-32 h-32 text-primary/[0.06] group-hover:text-primary/[0.11] transition-colors"
        strokeWidth={1.25}
        aria-hidden
      />
      <CardTitle icon={Icon} title={title} />
      <span className="relative typo-caption text-ink-3" style={{ fontWeight: 400 }}>{body}</span>
      <span className="relative typo-label text-ink-3 mt-auto pt-1">{meta}</span>
    </button>
  );
}
