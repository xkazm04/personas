// QuickDispatchDock — Activity's composer, as the "Launch Rail".
//
// Conversations has `ConversationComposer` pinned under its stream: the surface
// you are reading and the place you act on it are one column. Activity had no
// such place — dispatching a session meant summoning the Quick Dispatch overlay
// over the top of the board you were reading, or leaving for the Fleet page.
// This is that composer, in the same position, for the Activity board.
//
// IT IS THE SAME CONSOLE, not a second one. The brain is `useQuickDispatchController`,
// and the leaf pieces — chips, the reserved meta line, the typeahead panel, the
// skill picker — are the overlay's own, so the `@project` / `/skill` grammar,
// the headless fallback and the ARIA combobox contract cannot drift between the
// two hosts. What is re-authored here is the SHELL.
//
// ## Why it looks like this (the Launch Rail, 2026-09-21)
//
// The shell won a blind design contest against five other redesigns — three from
// a second model family — and the owner picked it over the host's own top-ranked
// entry. What it was picked FOR is the readout: firing an agent at a real
// repository is a pre-flight act, not a form submission, so the console answers
// three questions before the operator commits.
//
//   · WHERE this lands — the absolute target path, on the manifest line.
//   · WHAT IT COSTS — `≈ $` and `~ min`, recomputed live as the objective, the
//     model and the effort change (`dockEstimate.ts`). Until this shipped the
//     dock fired with no indication of what `opus × xhigh` would spend. The
//     rates are real published prices; the token volume is a heuristic, and the
//     gauge says so in its tooltip rather than posing as a quote.
//   · IS IT READY — STANDBY flips to ARMED, and the rail above quickens.
//
// The resting row was the one dimension this variant scored worst on, and the
// fix came from a rival entry the owner also saw: permanent chrome must pay
// rent. Collapsed, the row now carries the live fleet tally (how many sessions
// need you, how many are working) instead of restating a placeholder the
// expanded state shows anyway.
//
// ## The anti-shake contract — unchanged, and non-negotiable
//
// The dock sits at the BOTTOM of a live board: if its outer height moves as the
// operator types, the board above it moves too. So every volatile panel
// (suggestions, skill picker, both preset menus) renders absolutely at
// `bottom-full`, out of document flow, opening UPWARD; and every row inside has
// a reserved height — the chip rail is always mounted, the meta line is a
// fixed-height swap slot, and the objective field grows INSIDE a fixed 92px
// deck and then scrolls. Measured across collapsed → typed → typeahead-open →
// long-objective, the dock's top edge does not move by a pixel.
//
// The dock is the console and the dispatch mechanism, nothing else: the
// "recent dispatches" list it used to show above itself was removed 2026-09-15
// (the board above the dock already is the list of what was dispatched). Its
// content is capped at 800px and centred, so on a wide window the composer
// stays a readable column instead of a full-width strip.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, Ghost, LayoutGrid, Terminal } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { RunOnSelect } from '@/features/shared/dispatch/RunOnSelect';
import { laneOfState } from '@/features/plugins/fleet/fleetStateMeta';
import { DockPresetSelect } from './DockPresetSelect';
import { DockSkillPicker } from './DockSkillPicker';
import { estimateDispatch, formatEstimateCost, formatEstimateMinutes } from './dockEstimate';
import { QuickDispatchSuggestions } from '@/features/plugins/fleet/quick-dispatch/QuickDispatchSuggestions';
import {
  EFFORT_PRESETS,
  MODEL_PRESETS,
  useQuickDispatchController,
} from '@/features/plugins/fleet/quick-dispatch/quickDispatchController';
import { QuickDispatchChips, QuickDispatchMetaLine } from '@/features/plugins/fleet/quick-dispatch/QuickDispatchParts';

/** This dock's own typeahead listbox id — see the controller call below. */
const DOCK_LISTBOX_ID = 'activity-dock-typeahead-listbox';

/** One column, centred — the dock's content never spreads past this. */
const COLUMN = 'mx-auto w-full max-w-[800px]';

/** Server bound on the objective, mirrored from the controller's own door. */
const OBJECTIVE_MAX = 1200;

/**
 * The objective field's reserved box. It grows from one line to this ceiling
 * and then scrolls — the deck's own height never changes, which is half of why
 * the board above cannot move.
 */
const FIELD_MIN_PX = 34;
const FIELD_MAX_PX = 76;

export function QuickDispatchDock() {
  const { t } = useTranslation();
  // Its own listbox id rather than the module default: two composers
  // advertising the same `aria-controls` target would be one pointing at the
  // other's suggestions. The overlay that made that concrete is gone; the
  // property is kept because the next second host will not announce itself.
  const c = useQuickDispatchController({ listboxId: DOCK_LISTBOX_ID });
  const [expanded, setExpanded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [firing, setFiring] = useState(false);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  const { focusInput } = c;
  const expand = useCallback(() => {
    setExpanded(true);
    focusInput();
  }, [focusInput]);

  const showSuggestions = !!c.token && (c.suggestions.length > 0 || !!c.suggestionHint);
  // One volatile panel at a time: a typeahead token in the input outranks the
  // picker, which closes again the moment the operator starts typing a token.
  const showPicker = pickerOpen && !showSuggestions;

  const formatModel = (m: string | null) => (m ? c.tx(c.quickT.model_chip, { model: m }) : c.quickT.model_chip_unset);
  const formatEffort = (e: string | null) =>
    e ? c.tx(c.quickT.effort_chip, { effort: e }) : c.quickT.effort_chip_unset;

  // ARMED is "this would actually dispatch" — the same predicate the launch
  // button is enabled by, so the pill can never promise a flight the button
  // refuses. `canSend` is the controller's, and it already accounts for an
  // in-flight send and an empty objective.
  const armed = c.canSend && !c.sending;

  // The readout. Recomputed on every keystroke, which is the point — but it is
  // pure arithmetic over three scalars, so there is nothing to memoize away.
  const estimate = useMemo(
    () => estimateDispatch(c.value, c.model, c.effort, !!c.skillChip),
    [c.value, c.model, c.effort, c.skillChip],
  );

  // The resting row's rent: what the fleet is doing, from the same snapshot the
  // board above renders. Bare selector, no `useShallow` — a refetched list holds
  // fresh objects anyway (the controller documents the same deviation).
  const sessions = useSystemStore((s) => s.fleetSessions);
  const tally = useMemo(() => {
    let needsYou = 0;
    let working = 0;
    for (const s of sessions) {
      const lane = laneOfState(s.state);
      if (lane === 'needs_you') needsYou += 1;
      else if (lane === 'working') working += 1;
    }
    return { needsYou, working };
  }, [sessions]);

  // Grow the field inside its reserved box, then let it scroll. Runs on value
  // change rather than on input so a programmatic set (picking a suggestion,
  // clearing after dispatch) resizes too.
  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    el.style.height = `${FIELD_MIN_PX}px`;
    el.style.height = `${Math.min(FIELD_MAX_PX, Math.max(FIELD_MIN_PX, el.scrollHeight))}px`;
  }, [c.value, expanded]);

  const flareTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (flareTimer.current !== null) window.clearTimeout(flareTimer.current);
  }, []);

  const submit = useCallback(() => {
    if (!c.canSend) return;
    setFiring(true);
    if (flareTimer.current !== null) window.clearTimeout(flareTimer.current);
    flareTimer.current = window.setTimeout(() => setFiring(false), 600);
    void c.handleSubmit();
  }, [c]);

  if (!expanded) {
    return (
      <div className="relative flex-shrink-0 border-t border-border bg-foreground/[0.015]">
        <span className="dock-rail pointer-events-none absolute inset-x-0 -top-px z-[4] h-px overflow-hidden" aria-hidden />
        <button
          type="button"
          onClick={expand}
          data-testid="quick-dispatch-dock-expand"
          className="group block w-full text-left transition-colors hover:bg-secondary/30"
        >
          <span className={`${COLUMN} flex h-9 items-center gap-2 px-3`}>
            <Terminal className="h-3.5 w-3.5 flex-shrink-0 text-primary" aria-hidden />
            <span className="dock-caret h-3.5 w-[7px] flex-shrink-0 rounded-[1px] bg-primary" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground opacity-55 transition-opacity group-hover:opacity-85">
              {c.quickT.placeholder}
            </span>
            {/* The rent this row pays: what the fleet is doing right now. */}
            <span className="flex flex-shrink-0 items-center gap-2.5" data-testid="quick-dispatch-dock-tally">
              {tally.needsYou > 0 && (
                <span className="typo-label flex items-center gap-1 text-violet-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-400" aria-hidden />
                  {c.tx(c.quickT.rest_tally_needs_you, { count: tally.needsYou })}
                </span>
              )}
              {tally.working > 0 && (
                <span className="typo-label flex items-center gap-1 text-blue-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400" aria-hidden />
                  {c.tx(c.quickT.rest_tally_working, { count: tally.working })}
                </span>
              )}
            </span>
            <span className="typo-label flex-shrink-0 text-foreground opacity-50 transition-colors group-hover:text-primary group-hover:opacity-90">
              {c.quickT.title}
            </span>
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      className="relative flex-shrink-0 border-t border-border bg-foreground/[0.015]"
      data-testid="quick-dispatch-dock"
      onKeyDown={(e) => {
        // Escape collapses the dock rather than closing anything global — the
        // controller's own Escape handling (strip the open typeahead token) runs
        // first, in the capture phase, so the first press never collapses a
        // console the operator was mid-token in.
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setPickerOpen(false);
          setExpanded(false);
        }
      }}
    >
      {/* The rail — a light travelling the dock's own top hairline, quicker
          once the console is armed. Absolutely placed on the border itself, so
          it occupies no height. */}
      <span
        className={`dock-rail pointer-events-none absolute inset-x-0 -top-px z-[4] h-px overflow-hidden ${
          armed ? 'dock-rail-armed' : ''
        }`}
        aria-hidden
      />

      <div ref={c.cardRef} className={`${COLUMN} dock-instrument-grid relative pb-2`}>
        {/* The one volatile panel — absolutely anchored ABOVE the dock, out of
            flow, so its appearance never moves the dock or the board. */}
        {showPicker && (
          <div className="absolute bottom-full left-0 right-0 z-30 mb-1 px-3">
            <DockSkillPicker
              activeProjectId={c.projectChip?.id ?? null}
              onPick={c.pickFromRegistry}
              onClose={closePicker}
            />
          </div>
        )}
        {showSuggestions && (
          <div className="absolute bottom-full left-0 right-0 z-30 mb-1 px-3">
            <div className="animate-fade-slide-in overflow-hidden rounded-card border border-border bg-background shadow-elevation-3">
              <div className="max-h-[38vh] overflow-y-auto p-1.5">
                <QuickDispatchSuggestions
                  listboxId={c.listboxId}
                  items={c.suggestions}
                  activeIndex={c.activeIndex}
                  hint={c.suggestionHint}
                  onPick={c.pickSuggestion}
                  onHoverIndex={c.setActiveIndex}
                />
              </div>
            </div>
          </div>
        )}

        {/* 1 — MANIFEST (reserved 30px): where this lands, what it costs,
            whether it is ready, and the collapse control. */}
        <div className="relative z-[1] flex h-[30px] items-center gap-2 px-3">
          <span
            className={`min-w-0 flex-1 truncate text-right font-mono text-xs text-foreground ${
              c.projectChip ? 'opacity-90' : 'opacity-45'
            }`}
            dir="rtl"
          >
            <span dir="ltr" style={{ unicodeBidi: 'embed' }}>
              {c.projectChip ? c.projectChip.root_path : c.quickT.placeholder}
            </span>
          </span>

          <span className="flex flex-shrink-0 items-center gap-1.5" data-testid="quick-dispatch-readout">
            <Tooltip
              content={
                <span className="flex flex-col gap-0.5">
                  <span>{c.quickT.estimate_cost_label}</span>
                  <span className="typo-label text-primary">
                    {estimate.assumedModel ? c.quickT.estimate_assumed_model : c.quickT.estimate_disclaimer}
                  </span>
                </span>
              }
              placement="top"
            >
              <span
                className="typo-code flex items-center gap-1 rounded-pill border border-card-border bg-card-bg px-2 py-0.5 text-foreground opacity-80 [[data-theme^='light']_&]:border-primary/35 [[data-theme^='light']_&]:bg-secondary/50"
                data-testid="quick-dispatch-gauge-cost"
              >
                ≈
                <b className="font-semibold tabular-nums text-foreground">
                  {armed ? formatEstimateCost(estimate.cost) : '—'}
                </b>
              </span>
            </Tooltip>
            <Tooltip content={c.quickT.estimate_eta_label} placement="top">
              <span
                className="typo-code flex items-center gap-1 rounded-pill border border-card-border bg-card-bg px-2 py-0.5 text-foreground opacity-80 [[data-theme^='light']_&]:border-primary/35 [[data-theme^='light']_&]:bg-secondary/50"
                data-testid="quick-dispatch-gauge-eta"
              >
                ~
                <b className="font-semibold tabular-nums text-foreground">
                  {armed ? formatEstimateMinutes(estimate.minutes) : '—'}
                </b>
              </span>
            </Tooltip>
            <span
              className={`typo-label whitespace-nowrap rounded-pill border px-2 py-0.5 ${
                armed
                  ? 'border-status-success/45 bg-status-success/10 text-status-success'
                  : `border-card-border bg-card-bg text-muted [[data-theme^='light']_&]:border-primary/35 [[data-theme^='light']_&]:bg-secondary/50`
              }`}
              data-testid="quick-dispatch-status-pill"
            >
              {armed ? c.quickT.status_armed : c.quickT.status_standby}
            </span>
          </span>

          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label={t.monitor.grid_dock_collapse}
            data-testid="quick-dispatch-dock-collapse"
            className="flex-shrink-0 rounded-interactive p-0.5 text-foreground opacity-50 transition-colors hover:bg-secondary/60 hover:opacity-100"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* 2 — CHIP RAIL: ALWAYS mounted at a fixed height, chips or empty. */}
        <div
          className="relative z-[1] mb-1 flex h-6 items-center gap-1 overflow-x-auto px-3"
          data-testid="quick-dispatch-chips"
        >
          <QuickDispatchChips c={c} />
        </div>

        {/* 3 — THE DECK (reserved 92px): the skill-registry door and the char
            budget down the left, the objective in the middle, the launch on the
            right. The field grows inside this box; the box never grows. */}
        <div className="relative z-[1] px-3" onKeyDownCapture={c.onComposerKeyDownCapture}>
          <div
            className={`flex h-[92px] items-stretch gap-2 rounded-card border p-2 transition-[border-color,box-shadow,background] ${
              c.sending
                ? 'border-status-info/55 bg-status-info/[0.06]'
                : 'border-card-border bg-foreground/[0.03] focus-within:border-primary/55 focus-within:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_30%,transparent),inset_0_0_22px_color-mix(in_srgb,var(--primary)_7%,transparent)]'
            }`}
          >
            <div className="flex flex-shrink-0 flex-col items-center justify-between">
              <Tooltip content={c.quickT.skill_picker_open} placement="top">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setPickerOpen((v) => !v)}
                  aria-label={c.quickT.skill_picker_open}
                  aria-pressed={pickerOpen}
                  aria-haspopup="dialog"
                  data-testid="quick-dispatch-skill-picker-toggle"
                  className={pickerOpen ? 'bg-primary/10 text-primary' : 'text-foreground'}
                >
                  <LayoutGrid className="h-4 w-4" aria-hidden />
                </Button>
              </Tooltip>
              {/* The char budget, where the deck has room for it — the server
                  bound is 1200 and the operator used to meet it only as an
                  error after pressing send. */}
              <span
                className={`typo-code tabular-nums ${
                  c.value.length > OBJECTIVE_MAX ? 'text-status-error' : 'text-foreground opacity-60'
                }`}
                data-testid="quick-dispatch-char-count"
              >
                {c.value.length}
              </span>
            </div>

            <div className="flex min-w-0 flex-1 items-start">
              <textarea
                ref={fieldRef}
                value={c.value}
                onChange={(e) => c.setValue(e.target.value)}
                onKeyDown={(e) => {
                  // The capture handler above has already consumed Enter while a
                  // typeahead token is open, so reaching here means the operator
                  // is finishing a plain objective.
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                disabled={c.sending}
                maxLength={OBJECTIVE_MAX}
                rows={1}
                placeholder={c.quickT.input_placeholder}
                data-testid="quick-dispatch-input"
                className="typo-body w-full resize-none border-0 bg-transparent p-0 text-foreground outline-none placeholder:text-foreground placeholder:opacity-40"
                style={{ height: FIELD_MIN_PX }}
              />
            </div>

            {/* The launch. A real `Button`, so the busy state is the shared
                spinner + `aria-busy` rather than a hand-rolled one; the tall
                block and the gradient are this dock's own. */}
            <Button
              variant="primary"
              onClick={submit}
              disabled={!c.canSend}
              loading={c.sending}
              aria-label={c.quickT.send}
              data-testid="quick-dispatch-send"
              className={`typo-label dock-launch-flare relative w-[84px] flex-shrink-0 flex-col justify-center gap-1 self-stretch overflow-hidden rounded-input border !px-0 ${
                firing ? 'dock-launch-firing' : ''
              } ${
                c.canSend
                  ? 'border-primary/60 bg-gradient-to-b from-accent to-btn-primary text-btn-primary-fg shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_25%,transparent),0_6px_18px_color-mix(in_srgb,var(--primary)_22%,transparent)] hover:brightness-110'
                  : 'border-card-border bg-card-bg text-muted'
              }`}
            >
              {!c.sending && <ArrowUp className="h-[18px] w-[18px]" aria-hidden />}
              <span>{c.quickT.send}</span>
            </Button>
          </div>
        </div>

        {/* 4 — INSTRUMENTS (reserved 34px): presets, the swap-slot meta line,
            and the headless toggle. */}
        <div className="relative z-[1] flex h-[34px] items-center gap-1.5 px-3">
          <DockPresetSelect
            presets={MODEL_PRESETS}
            value={c.model}
            onChange={c.setModel}
            format={formatModel}
            ariaLabel={c.quickT.model_chip_unset}
            testId="quick-dispatch-model-chip"
          />
          <DockPresetSelect
            presets={EFFORT_PRESETS}
            value={c.effort}
            onChange={c.setEffort}
            format={formatEffort}
            ariaLabel={c.quickT.effort_chip_unset}
            testId="quick-dispatch-effort-chip"
          />
          {/* Run on another device: hidden unless p2p is in this build and a
              device is paired. Opens upward, like the preset menus. */}
          <RunOnSelect value={c.runOn} onChange={c.setRunOn} githubUrl={c.projectRemote} placement="up" />
          <div className="min-w-0 flex-1 px-1">
            <QuickDispatchMetaLine c={c} />
          </div>
          {/* Headless is a switch with a visible track now rather than a tinted
              icon: it is the one control that changes where the WORK happens,
              and an icon that only differs by tint read as decoration. State is
              still carried by aria-pressed, and spelled out in the tooltip and
              the meta line's caption. */}
          <Tooltip content={c.headless ? c.quickT.headless_toggle_on : c.quickT.headless_toggle_off} placement="top">
            <button
              type="button"
              onClick={c.toggleHeadless}
              aria-label={c.quickT.headless_label}
              aria-pressed={c.headless}
              data-testid="quick-dispatch-headless-toggle"
              className={`typo-label ml-auto flex h-6 flex-shrink-0 items-center gap-1.5 rounded-pill border py-0 pl-1 pr-2.5 transition-colors ${
                c.headless
                  ? 'border-brand-purple/50 bg-brand-purple/10 text-brand-purple'
                  : `border-card-border bg-card-bg text-foreground opacity-80 hover:border-primary/45 hover:opacity-100 [[data-theme^='light']_&]:border-primary/35 [[data-theme^='light']_&]:bg-secondary/50`
              }`}
            >
              <span
                className={`relative h-[15px] w-[26px] flex-shrink-0 rounded-pill transition-colors ${
                  c.headless ? 'bg-brand-purple/55' : 'bg-foreground/15'
                }`}
                aria-hidden
              >
                <span
                  className={`absolute left-0.5 top-0.5 h-[11px] w-[11px] rounded-full transition-transform ${
                    c.headless ? 'translate-x-[11px] bg-btn-primary-fg' : 'bg-muted-foreground'
                  }`}
                />
              </span>
              <Ghost className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

export default QuickDispatchDock;
