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
import { LETTERING, doneShare, drawingOf, proofFilter, regionForGoal, sheetMoment } from './draftingModel';
import { useBuildUp } from './useBuildUp';
import './drafting.css';

/** A new project's sheet builds up across the setup wait; a reopened one replays quickly. */
const STEP_MS = { template: 1100, sketch: 1500, replay: 140 } as const;
/** Unlabelled ghost frames for a reopened project whose plan has not loaded. */
const SKELETON = ['Top bar', 'Hero', 'Content', 'Content', 'Footer'].map((title) => ({ title, purpose: '' }));

// The drafting sheet: contest A/3 ("Blueprint") brought into Personas as a
// second sheet style beside the plan cards. One drawing carries the whole
// story on real data:
// - a new project: the stock Next.js page, then the sketch, is BUILT UP part by
//   part across the setup wait (the pen goes to each part as it is drawn and
//   letters its name; then the other pages, the brief, the goals), while the
//   setup steps log into the notes; a question that lands early sits over the
//   sheet and the build-up carries on behind it;
// - the plan: goals ink in as they get done, the region the current goal is
//   about is hatched under the pen, each action writes a callout;
// - the live page shows through the home drawing as a cyanotype proof that
//   develops into colour as the plan gets done; a stamp lands for approval
//   and when everything is done;
// - a reopened project replays its stored drawing quickly, and never draws a
//   part it has nothing for: no sketch but a plan draws the plan itself, no
//   plan yet draws unlabelled ghost frames, and empty cells are left out.
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
  opened = false,
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
  /** A project opened from disk rather than created now: no stock page, no setup log. */
  opened?: boolean;
}) {
  const { t } = useTranslation();
  const g = guideStrings(t);
  const rootRef = useRef<HTMLDivElement>(null);
  const [regionEl, setRegionEl] = useState<HTMLElement | null>(null);
  const [latestEl, setLatestEl] = useState<HTMLElement | null>(null);
  const [goalEl, setGoalEl] = useState<HTMLLIElement | null>(null);
  const [notesEl, setNotesEl] = useState<HTMLDivElement | null>(null);
  const elapsed = useElapsed(steps.some((s) => s.state === 'running') ? startedAt : null);

  const moment = sheetMoment(!!sketch, phases, placeholder);
  const drawing = drawingOf({ sketch, planned: moment === 'plan', opened });
  const templatePage = {
    title: g.template_home,
    route: '/',
    regions: [g.template_region_nav, g.template_region_banner, g.template_region_content, g.template_region_footer].map(
      (title) => ({ title, purpose: '' }),
    ),
  };
  const pages =
    drawing === 'sketch'
      ? sketch!.pages.filter((p) => p.regions.length > 0)
      : drawing === 'plan'
        ? [{ title: g.draft_plan_sheet, route: '', regions: phases.map((p) => ({ title: p.title, purpose: p.note ?? '' })) }]
        : drawing === 'skeleton'
          ? [{ title: '', route: '', regions: SKELETON }]
          : [templatePage];
  const [home, ...others] = pages;
  const rest = others.slice(0, 2);

  // Plan states on the drawing: by shared words for a sketch, directly for the plan sheet.
  const active = moment === 'plan' ? phases.find((p) => p.status === 'active') : undefined;
  const activeRegion =
    drawing === 'plan' ? phases.findIndex((p) => p.status === 'active') : active && home ? regionForGoal(active.title, home.regions) : -1;
  const doneRegions = new Set(
    drawing === 'plan'
      ? phases.flatMap((p, i) => (p.status === 'done' ? [i] : []))
      : moment === 'plan' && home
        ? phases.filter((p) => p.status === 'done').map((p) => regionForGoal(p.title, home.regions)).filter((i) => i >= 0)
        : [],
  );
  const regionState = (i: number): RegionState =>
    i === activeRegion && (working || drawing === 'plan') ? 'drafting' : doneRegions.has(i) ? 'done' : 'pending';
  const stateWords: Record<RegionState, string> = { pending: '', drafting: g.draft_state_drafting, done: g.draft_state_done };

  const goals: TitleGoal[] =
    moment === 'plan'
      ? phases.map((p) => ({ title: p.title, note: p.note, state: p.status === 'done' ? 'done' : p.status === 'active' ? 'active' : 'pending' }))
      : (sketch?.goals ?? []).map((goal) => ({ title: goal.title, note: goal.note, state: 'pending' as const }));
  const allDone = moment === 'plan' && phases.length > 0 && phases.every((p) => p.status === 'done');
  const stamp = allDone ? g.draft_stamp_issued : awaitingApproval ? g.draft_stamp_approval : null;
  // The brief: the sketch's summary, else what the plan's vision goal says.
  const brief = sketch?.summary || phases.find((p) => /vision/i.test(p.id) || /vision/i.test(p.title))?.note || null;
  const showGoalsInBlock = drawing !== 'plan';

  // The build-up: every region of every page in order, then the brief, then
  // each goal. A reopened project replays it quickly.
  const regionCounts = [home, ...rest].map((p) => (p ? p.regions.length : 0));
  const regionsTotal = regionCounts.reduce((a, b) => a + b, 0);
  const briefStep = brief ? 1 : 0;
  const goalSteps = showGoalsInBlock ? goals.length : 0;
  const total = drawing === 'skeleton' ? 0 : regionsTotal + briefStep + goalSteps;
  const buildKey = `${drawing}:${pages.map((p) => `${p.title}(${p.regions.map((r) => r.title).join(',')})`).join('|')}`;
  const stepMs = opened || drawing === 'plan' ? STEP_MS.replay : drawing === 'template' ? STEP_MS.template : STEP_MS.sketch;
  const count = useBuildUp(buildKey, total, stepMs);
  const building = count < total;
  // Regions drawn so far on the page at `index`, which has `regions` of them.
  const shownOn = (index: number, regions: number) => {
    const before = regionCounts.slice(0, index).reduce((a, b) => a + b, 0);
    return Math.max(0, Math.min(regions, count - before));
  };
  const briefShown = briefStep > 0 && count > regionsTotal;
  const goalsShown = Math.max(0, count - regionsTotal - briefStep);
  // What was drawn last, for the pen's callout while the sheet builds up.
  const lastDrawn = (() => {
    if (count <= regionsTotal) {
      let left = count;
      for (const p of [home, ...rest]) {
        if (!p) continue;
        if (left <= p.regions.length) return p.regions[left - 1]?.title ?? null;
        left -= p.regions.length;
      }
      return null;
    }
    if (goalsShown > 0) return goals[goalsShown - 1]?.title ?? null;
    return briefShown ? g.draft_brief : null;
  })();

  const stepLabel: Record<SetupStepKey, string> = {
    sketch: g.setup_step_sketch,
    create: g.setup_step_create,
    preview: g.setup_step_preview,
    plan: g.setup_step_plan,
  };
  const settingUp = !opened && steps.some((s) => s.state === 'running' || s.state === 'failed');
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
    notes ?? (opened ? null : sketchState === 'loading' ? g.sketch_loading : sketchState === 'failed' ? g.sketch_failed : null)
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
  const callout =
    building && lastDrawn
      ? { id: `${buildKey}#${count}`, kind: g.draft_kind_draw, text: lastDrawn }
      : last
        ? { id: last.id, kind: kindWord[last.kind], text: activityText(g, last) }
        : null;
  const toRegions = (regions: { title: string; purpose: string }[], main: boolean): DraftingRegion[] =>
    regions.map((r, i) => ({ title: r.title, purpose: r.purpose, state: main ? regionState(i) : 'pending' }));
  const status = allDone
    ? g.draft_stamp_issued
    : drawing === 'skeleton'
      ? g.draft_status_loading
      : booting && moment === 'plan'
        ? g.preview_booting_plan
        : { template: g.draft_status_template, sketch: g.draft_status_sketch, plan: g.draft_status_plan }[moment];
  // The pen: at the part just drawn while the sheet builds up, else where she works.
  const penTarget = building
    ? (count <= regionsTotal ? latestEl : goalsShown > 0 ? null : notesEl) ?? notesEl
    : ((activeRegion >= 0 ? regionEl : null) ?? goalEl ?? (settingUp || working ? notesEl : null));
  const ghostSheet = rest.length === 0 && !opened;

  return (
    <div ref={rootRef} className="drafting-root absolute inset-0 overflow-hidden" data-testid="drafting-sheet" data-drawing={drawing}>
      <div className="grid h-full grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-10 px-8 pb-7 pt-6">
        {home && (
          <DraftingPage
            num={1}
            title={home.title}
            route={home.route || undefined}
            regions={toRegions(home.regions, true)}
            stateWords={stateWords}
            proof={proofUrl && drawing !== 'plan' ? { url: proofUrl, filter: proofFilter(doneShare(phases)) } : null}
            draftingRef={setRegionEl}
            latestRef={setLatestEl}
            shown={shownOn(0, home.regions.length)}
            skeleton={drawing === 'skeleton'}
          />
        )}
        <div className="flex min-h-0 flex-col gap-5">
          {rest.map((p, i) => (
            <DraftingPage
              key={`${p.route}-${p.title}`}
              num={i + 2}
              title={p.title}
              route={p.route}
              regions={toRegions(p.regions, false)}
              stateWords={stateWords}
              compact
              latestRef={setLatestEl}
              shown={shownOn(i + 1, p.regions.length)}
            />
          ))}
          {ghostSheet && (
            // A new project before its sketch: the next sheet is a dashed ghost that says what comes.
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
          {/* Beside other sheets the title block takes the lower half; alone it
              sits in the corner at its own size, with open paper above, as on
              a drawing, rather than stretching into an empty box. */}
          <div className={`flex shrink-0 flex-col ${rest.length > 0 || ghostSheet ? 'h-[48%] min-h-[220px]' : 'mt-auto'}`}>
            <DraftingTitleBlock
              labels={{ project: g.draft_project, status: g.draft_status, brief: g.draft_brief, goals: g.draft_goals, notes: g.draft_notes, drawn: g.draft_drawn }}
              project={name}
              status={status}
              brief={briefShown || !building ? brief : null}
              goals={goals}
              goalsEmpty={opened ? null : g.draft_goals_empty}
              goalsShown={building ? goalsShown : goals.length}
              showGoals={showGoalsInBlock && drawing !== 'skeleton'}
              stateWords={{ pending: '', active: g.draft_state_drafting, done: g.draft_state_done }}
              notes={noteBody}
              stamp={stamp}
              activeGoalRef={setGoalEl}
              notesRef={setNotesEl}
              letterBrief={!opened}
            />
          </div>
        </div>
      </div>
      <DraftingPen rootRef={rootRef} target={penTarget} working={working || settingUp || building} callout={callout} />
    </div>
  );
}
