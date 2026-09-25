import { useRef, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { SiteSketch } from '@/lib/bindings/SiteSketch';
import type { BuildPhase } from '../../studioBuildModel';
import type { StudioActivity } from '../../studioActivity';
import { activityText, guideStrings } from '../guideCopy';
import type { SetupStepKey, SetupStepState } from '../guideModel';
import { clock, useElapsed } from '../useGuideRuntime';
import DraftingPage, { type DraftingRegion, type RegionState } from './DraftingPage';
import DraftingPen from './DraftingPen';
import DraftingTitleBlock, { type TitleGoal } from './DraftingTitleBlock';
import { LETTERING, doneShare, proofFilter, regionForGoal, sheetMoment } from './draftingModel';
import './drafting.css';

// The drafting sheet: contest A/3 ("Blueprint") brought into Personas as a
// second sheet style beside the plan cards. One drawing carries the whole
// story on real data:
// - setup: the stock Next.js page is drawn in dashed outline, the setup steps
//   log into the title block's notes, and the pen waits there;
// - the sketch lands: the pages are redrawn from it, region by region, as
//   numbered sheets, with the brief and the goals in the title block;
// - the plan: goals ink in as they get done, the region the current goal is
//   about is hatched under the pen, each action writes a callout;
// - the live page shows through the home drawing as a cyanotype proof that
//   develops into colour as the plan gets done; a stamp lands for approval
//   and when everything is done.
export default function GuideDraftingSheet({
  name,
  sketch,
  sketchState,
  steps,
  startedAt,
  phases,
  placeholder,
  activity,
  working,
  notes,
  awaitingApproval,
  proofUrl,
  booting = false,
}: {
  name: string;
  sketch: SiteSketch | null;
  sketchState: 'loading' | 'ready' | 'failed' | null;
  steps: { key: SetupStepKey; state: SetupStepState }[];
  startedAt: number | null;
  phases: BuildPhase[];
  placeholder: boolean;
  activity: StudioActivity[];
  working: boolean;
  notes: string | null;
  awaitingApproval: boolean;
  /** The live preview's home page, when it is running. */
  proofUrl: string | null;
  /** An opened project whose preview is still starting: its stored plan is replayed meanwhile. */
  booting?: boolean;
}) {
  const { t } = useTranslation();
  const g = guideStrings(t);
  const rootRef = useRef<HTMLDivElement>(null);
  const [regionEl, setRegionEl] = useState<HTMLElement | null>(null);
  const [goalEl, setGoalEl] = useState<HTMLLIElement | null>(null);
  const [notesEl, setNotesEl] = useState<HTMLDivElement | null>(null);
  const elapsed = useElapsed(steps.some((s) => s.state === 'running') ? startedAt : null);

  const moment = sheetMoment(!!sketch, phases, placeholder);
  const pages = sketch?.pages.length
    ? sketch.pages
    : [
        {
          title: g.template_home,
          route: '/',
          regions: [g.template_region_nav, g.template_region_banner, g.template_region_content, g.template_region_footer].map(
            (title) => ({ title, purpose: '' }),
          ),
        },
      ];
  const [home, ...rest] = pages;
  const active = moment === 'plan' ? phases.find((p) => p.status === 'active') : undefined;
  const activeRegion = active && home ? regionForGoal(active.title, home.regions) : -1;
  const doneRegions = new Set(
    moment === 'plan' && home
      ? phases.filter((p) => p.status === 'done').map((p) => regionForGoal(p.title, home.regions)).filter((i) => i >= 0)
      : [],
  );
  const regionState = (i: number): RegionState =>
    i === activeRegion && working ? 'drafting' : doneRegions.has(i) ? 'done' : 'pending';
  const stateWords: Record<RegionState, string> = { pending: '', drafting: g.draft_state_drafting, done: g.draft_state_done };

  const goals: TitleGoal[] =
    moment === 'plan'
      ? phases.map((p) => ({ title: p.title, note: p.note, state: p.status === 'done' ? 'done' : p.status === 'active' ? 'active' : 'pending' }))
      : (sketch?.goals ?? []).map((goal) => ({ title: goal.title, note: goal.note, state: 'pending' as const }));
  const allDone = moment === 'plan' && phases.length > 0 && phases.every((p) => p.status === 'done');
  const stamp = allDone ? g.draft_stamp_issued : awaitingApproval ? g.draft_stamp_approval : null;

  const stepLabel: Record<SetupStepKey, string> = {
    sketch: g.setup_step_sketch,
    create: g.setup_step_create,
    preview: g.setup_step_preview,
    plan: g.setup_step_plan,
  };
  const settingUp = steps.some((s) => s.state === 'running' || s.state === 'failed');
  const noteBody = settingUp ? (
    <ul className="flex flex-col">
      {steps
        .filter((s) => s.state !== 'pending')
        .map((s) => (
          <li key={s.key} className="truncate typo-code text-foreground/90">
            <span style={{ color: 'var(--ink-strong)' }}>{s.state === 'done' ? '✓' : s.state === 'failed' ? '✕' : '›'}</span> {stepLabel[s.key]}
            {s.state === 'running' && elapsed > 0 ? ` ${clock(elapsed)}` : ''}
          </li>
        ))}
    </ul>
  ) : (
    (notes ?? (sketchState === 'loading' ? g.sketch_loading : sketchState === 'failed' ? g.sketch_failed : g.draft_notes_empty))
  );

  const last = activity[activity.length - 1];
  const kindWord: Record<StudioActivity['kind'], string> = {
    research: g.draft_kind_research,
    search: g.draft_kind_search,
    read: g.draft_kind_read,
    build: g.draft_kind_build,
    check: g.draft_kind_check,
    browser: g.draft_kind_browser,
    command: g.draft_kind_command,
    other: g.draft_kind_other,
  };
  const callout = last ? { id: last.id, kind: kindWord[last.kind], text: activityText(g, last) } : null;
  const toRegions = (regions: { title: string; purpose: string }[], main: boolean): DraftingRegion[] =>
    regions.map((r, i) => ({ title: r.title, purpose: r.purpose, state: main ? regionState(i) : 'pending' }));
  const status = allDone
    ? g.draft_stamp_issued
    : booting && moment === 'plan'
      ? g.preview_booting_plan
      : { template: g.draft_status_template, sketch: g.draft_status_sketch, plan: g.draft_status_plan }[moment];

  return (
    <div ref={rootRef} className="drafting-root absolute inset-0 overflow-hidden" data-testid="drafting-sheet">
      <div className="grid h-full grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-10 px-8 pb-7 pt-6">
        {home && (
          <DraftingPage
            num={1}
            title={home.title}
            route={home.route}
            regions={toRegions(home.regions, true)}
            stateWords={stateWords}
            proof={proofUrl ? { url: proofUrl, filter: proofFilter(doneShare(phases)) } : null}
            draftingRef={setRegionEl}
          />
        )}
        <div className="flex min-h-0 flex-col gap-5">
          {rest.slice(0, 2).map((p, i) => (
            <DraftingPage
              key={`${p.route}-${p.title}`}
              num={i + 2}
              title={p.title}
              route={p.route}
              regions={toRegions(p.regions, false)}
              stateWords={stateWords}
              compact
              delay={0.4 + 0.3 * i}
            />
          ))}
          {rest.length === 0 && (
            // Before the sketch: the next sheet is a dashed ghost that says what comes.
            <div className="flex min-h-0 flex-1 flex-col">
              <p className="mb-2 flex items-baseline gap-2.5">
                <span
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                  style={{ ...LETTERING, letterSpacing: 0, border: '1px dashed var(--ink-dim)', color: 'var(--ink-dim)' }}
                >
                  2
                </span>
              </p>
              <div className="flex flex-1 items-center justify-center rounded-interactive p-6 text-center" style={{ border: '1px dashed var(--ink-faint)' }}>
                <p className="max-w-xs typo-caption">{g.template_hint}</p>
              </div>
            </div>
          )}
          <div className="flex h-[48%] min-h-[220px] shrink-0 flex-col">
            <DraftingTitleBlock
              labels={{ project: g.draft_project, status: g.draft_status, brief: g.draft_brief, goals: g.draft_goals, notes: g.draft_notes, drawn: g.draft_drawn }}
              project={name}
              status={status}
              brief={sketch?.summary ?? null}
              goals={goals}
              goalsEmpty={g.draft_goals_empty}
              stateWords={{ pending: '', active: g.draft_state_drafting, done: g.draft_state_done }}
              notes={noteBody}
              stamp={stamp}
              activeGoalRef={setGoalEl}
              notesRef={setNotesEl}
            />
          </div>
        </div>
      </div>
      <DraftingPen
        rootRef={rootRef}
        target={(activeRegion >= 0 ? regionEl : null) ?? goalEl ?? (settingUp || working ? notesEl : null)}
        working={working || settingUp}
        callout={callout}
      />
    </div>
  );
}
