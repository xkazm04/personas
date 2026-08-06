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
// A landing chooser is still the first content (two cards — Manage vs Dispatch,
// each with its icon as an illustrative watermark); picking one enters the lane
// with a breadcrumb back. `initialMode` lets each entry point land straight in
// its natural lane. The modal is `6xl` and tall because these surfaces are a
// two-panel board and a skills × projects matrix, not a list.
import { useState } from 'react';
import { ArrowRight, ChevronLeft, Puzzle, Rocket, Wand2 } from 'lucide-react';

import { BaseModal } from '@/features/shared/components/modals';
import { RegistryTab } from '@/features/plugins/dev-tools/sub_skills/registry/RegistryTab';
import { SkillInfoModal } from '@/features/plugins/dev-tools/sub_skills/SkillInfoModal';
import { SkillsOverviewPanel } from '@/features/plugins/dev-tools/sub_skills/SkillsOverviewPanel';

import { useQuickDispatch } from './quickDispatch';
import { QuickDispatchFrontier } from './QuickDispatchFrontier';
import { QuickDispatchLedger } from './QuickDispatchLedger';
import { QuickDispatchSigils } from './QuickDispatchSigils';
import { useSkillsWorkbench, type WorkbenchMode } from './skillsWorkbenchData';
import { WorkbenchCounts } from './workbenchChrome';

// ── PROTOTYPE SWITCHER (throwaway — deleted at consolidation) ────────────────
// Three directional variants of the landing's quick-dispatch visualization.
const QUICK_VARIANTS = [
  { id: 'sigils', label: 'Sigils', hint: 'badge wall, coverage rings', component: QuickDispatchSigils },
  { id: 'ledger', label: 'Ledger', hint: 'dense rows, segmented bars', component: QuickDispatchLedger },
  { id: 'frontier', label: 'Frontier', hint: 'gaps first, heat strips', component: QuickDispatchFrontier },
] as const;
type QuickVariantId = (typeof QUICK_VARIANTS)[number]['id'];

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
  const [variant, setVariant] = useState<QuickVariantId>('sigils'); // prototype-only state
  const QuickViz = QUICK_VARIANTS.find((v) => v.id === variant)!.component;

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
            <div className="flex-1 min-h-0 grid grid-cols-[17rem_1fr] gap-5 p-5">
              {/* ── Manage lane ─────────────────────────────────────────── */}
              <div className="flex flex-col gap-3 min-h-0">
                <SectionTitle
                  title="Manage skills"
                  subtitle="Adopt from your library, share back, review usage and memory bindings."
                />
                <ChoiceCard
                  icon={Puzzle}
                  title="Open the board"
                  body="Your library beside this repo's skills — coverage, usage, adopt and share."
                  meta={`${wb.adopt.items.length} to adopt · ${wb.share.items.length} to share`}
                  onClick={() => setMode('manage')}
                  testid="skills-workbench-choose-manage"
                />
              </div>

              {/* ── Dispatch lane ───────────────────────────────────────── */}
              <div className="flex flex-col gap-3 min-h-0">
                <div className="flex items-start gap-3">
                  <SectionTitle
                    title="Dispatch a skill"
                    subtitle="One click runs it via Fleet — the skill picks its own context. Open the registry to aim at a specific context group."
                  />
                  {/* AS-IS path: the full skill × context-group registry */}
                  <button
                    type="button"
                    onClick={() => setMode('dispatch')}
                    className="ml-auto flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive border border-primary/15 typo-caption text-foreground/70 hover:text-foreground hover:border-primary/35 hover:bg-primary/[0.06] transition-colors focus-ring"
                    data-testid="skills-workbench-choose-dispatch"
                  >
                    <Rocket className="w-3.5 h-3.5" aria-hidden />
                    Open the registry
                    <ArrowRight className="w-3 h-3" aria-hidden />
                  </button>
                </div>

                {/* PROTOTYPE SWITCHER — throwaway, removed at consolidation */}
                <div className="flex items-center gap-1 flex-shrink-0" data-testid="quick-dispatch-variant-tabs">
                  {QUICK_VARIANTS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVariant(v.id)}
                      className={`px-2 py-1 rounded-interactive typo-label transition-colors ${variant === v.id ? 'bg-primary/15 text-foreground' : 'text-foreground/45 hover:text-foreground hover:bg-primary/[0.06]'}`}
                      title={v.hint}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                  <QuickViz model={quick} busySkill={busySkill} onDispatch={dispatchQuick} />
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

/** Standardized section heading — every landing section leads with the same
 *  title/subtitle form so the two lanes read as siblings. */
function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <h3 className="typo-body font-semibold text-foreground">{title}</h3>
      <p className="typo-caption text-foreground/55 leading-snug" style={{ fontWeight: 400 }}>{subtitle}</p>
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
