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
import { ArrowRight, ChevronLeft, Puzzle, Rocket, Wand2 } from 'lucide-react';

import { BaseModal } from '@/features/shared/components/modals';
import { RegistryTab } from '@/features/plugins/dev-tools/sub_skills/registry/RegistryTab';
import { SkillInfoModal } from '@/features/plugins/dev-tools/sub_skills/SkillInfoModal';
import { SkillsOverviewPanel } from '@/features/plugins/dev-tools/sub_skills/SkillsOverviewPanel';

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
      <span id="skills-workbench-title" className="sr-only">Skills — {wb.projectName}</span>
      <div className="flex flex-col h-[calc(100dvh-160px)] min-h-[520px] max-h-[760px]">
        {mode === null ? (
          <>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.04] flex-shrink-0">
              <Wand2 className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
              <span className="typo-title truncate">Skills — {wb.projectName}</span>
              <span className="ml-auto flex-shrink-0"><WorkbenchCounts counts={wb.counts} /></span>
            </div>
            <div className="flex-1 min-h-0 grid grid-cols-2 gap-4 p-6">
              {/* ── Manage half — enters the full skills board ──────────── */}
              <ChoiceCard
                icon={Puzzle}
                title="Manage skills"
                body="The full skills board: your library beside this repo's skills, with coverage, usage, memory bindings, adopt and share."
                meta={`${wb.adopt.items.length} to adopt · ${wb.share.items.length} to share`}
                onClick={() => setMode('manage')}
                testid="skills-workbench-choose-manage"
              />

              {/* ── Dispatch half — live quick-dispatch ledger in place ─── */}
              <div className="relative flex flex-col gap-2 p-5 min-h-0 rounded-card border border-primary/12 bg-secondary/[0.15]">
                <div className="flex items-start gap-2">
                  <CardTitle icon={Rocket} title="Dispatch a skill" />
                  {/* the aimed path: skill × context-group registry */}
                  <button
                    type="button"
                    onClick={() => setMode('dispatch')}
                    className="ml-auto flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive border border-primary/15 typo-caption text-foreground/70 hover:text-foreground hover:border-primary/35 hover:bg-primary/[0.06] transition-colors focus-ring"
                    data-testid="skills-workbench-choose-dispatch"
                  >
                    Open the registry
                    <ArrowRight className="w-3 h-3" aria-hidden />
                  </button>
                </div>
                <p className="typo-caption text-foreground/60 leading-snug" style={{ fontWeight: 400 }}>
                  One click runs a skill via Fleet — it picks its own context. The registry aims at a specific group.
                </p>
                <div className="flex-1 min-h-0 overflow-y-auto mt-1">
                  <QuickDispatchLedger model={quick} busySkill={busySkill} onDispatch={dispatchQuick} />
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
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
              <span className="typo-caption font-medium text-foreground">{mode === 'dispatch' ? 'Registry' : 'Manage'}</span>
              <span className="typo-label text-foreground/40 truncate">· {wb.projectName}</span>
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
      className="group relative overflow-hidden flex flex-col items-start text-left gap-2 p-5 rounded-card border border-primary/12 bg-secondary/[0.15] hover:bg-primary/[0.06] hover:border-primary/30 transition-colors focus-ring"
      data-testid={testid}
    >
      {/* illustrative background watermark — the lane's icon, oversized + faint */}
      <Icon
        className="pointer-events-none absolute -right-5 -bottom-6 w-32 h-32 text-primary/[0.06] group-hover:text-primary/[0.11] transition-colors"
        strokeWidth={1.25}
        aria-hidden
      />
      <CardTitle icon={Icon} title={title} />
      <span className="relative typo-caption text-foreground/60 leading-snug" style={{ fontWeight: 400 }}>{body}</span>
      <span className="relative typo-label text-foreground/40 mt-auto pt-1">{meta}</span>
    </button>
  );
}
