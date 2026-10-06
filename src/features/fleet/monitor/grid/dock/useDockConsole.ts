// useDockConsole — everything the dispatch dock KNOWS, lifted out of the shell
// that paints it.
//
// Three shells now render the same console (`DockRail`, `DockConsole`,
// `DockRibbon`). The brain stays one object so a variant cannot quietly own a
// different dispatch path, a different estimate or a different Athena grant —
// the whole point of hosting variants is that only the ARRANGEMENT varies.
//
// Lifted verbatim from `QuickDispatchDock.tsx` (2026-10-06, no behaviour
// change). The reasoning that earned each piece lives in that file's header and
// is not repeated here; what follows is only what a reader of THIS file needs.
//
// THE DEFERRED READINGS ARE PART OF THE CONTRACT. The typeahead snapshot, the
// objective the estimate prices, and both fleet collections are
// `useDeferredValue`d; `c.value`, `armed` and `canSend` are NOT, so the caret
// and the launch button commit on the urgent frame. A shell must read
// `objective` only for readings and `c.value` only for the field.

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import { setSessionAthenaFlag } from '@/api/fleet/fleet';
import { laneOfState } from '@/features/plugins/fleet/fleetStateMeta';
import { useQuickDispatchController } from '@/features/plugins/fleet/quick-dispatch/quickDispatchController';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { grantAthenaToDispatch } from '../dockAthenaGrant';
import { dockLanding } from '../dockLanding';
import { estimateDispatch } from '../dockEstimate';

/** This dock's own typeahead listbox id — two composers must not share one. */
const DOCK_LISTBOX_ID = 'activity-dock-typeahead-listbox';

/** Server bound on the objective, mirrored from the controller's own door. */
export const OBJECTIVE_MAX = 1200;

/**
 * The objective field's reserved box. It grows from one line to this ceiling
 * and then scrolls — the deck's own height never changes, which is half of why
 * the board above cannot move.
 */
export const FIELD_MIN_PX = 34;
export const FIELD_MAX_PX = 50;

export type DockConsole = ReturnType<typeof useDockConsole>;

export function useDockConsole() {
  const { t } = useTranslation();
  const c = useQuickDispatchController({ listboxId: DOCK_LISTBOX_ID });
  const [expanded, setExpanded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [firing, setFiring] = useState(false);
  // Armed, not applied: the grant is a decision about a dispatch that has not
  // happened yet, and it is written only once a session exists to write it to.
  const [athenaArmed, setAthenaArmed] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  const closePicker = useCallback(() => setPickerOpen(false), []);
  const togglePicker = useCallback(() => setPickerOpen((v) => !v), []);
  const toggleAthena = useCallback(() => setAthenaArmed((v) => !v), []);
  const collapse = useCallback(() => {
    setPickerOpen(false);
    setExpanded(false);
  }, []);

  const { focusInput } = c;
  const expand = useCallback(() => {
    setExpanded(true);
    focusInput();
  }, [focusInput]);

  // The typeahead panel, deferred as ONE snapshot: deferring the token, the
  // rows and the hint separately would let the listbox paint last frame's rows
  // under this frame's emptiness.
  const typeahead = useDeferredValue(
    useMemo(
      () => ({ token: c.token, items: c.suggestions, hint: c.suggestionHint }),
      [c.token, c.suggestions, c.suggestionHint],
    ),
  );
  const showSuggestions = !!typeahead.token && (typeahead.items.length > 0 || !!typeahead.hint);
  // One volatile panel at a time: a typeahead token in the input outranks the
  // picker, which closes again the moment the operator starts typing a token.
  const showPicker = pickerOpen && !showSuggestions;

  // ARMED is "this would actually dispatch" — the same predicate the launch
  // button is enabled by, so no reading can promise a flight the button refuses.
  const armed = c.canSend && !c.sending;

  const objective = useDeferredValue(c.value);
  const estimate = useMemo(
    () => estimateDispatch(objective, c.model, c.effort, !!c.skillChip),
    [objective, c.model, c.effort, c.skillChip],
  );

  const sessions = useDeferredValue(useSystemStore((s) => s.fleetSessions));
  const queue = useDeferredValue(useSystemStore((s) => s.fleetQueue));
  const landing = useMemo(() => dockLanding(queue), [queue]);
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
  // change rather than on input so a programmatic set resizes too.
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
    // Read BEFORE the door opens: which sessions already existed, and where
    // this one is aimed. `grantAthenaToDispatch` takes the difference.
    const cwd = c.projectChip?.root_path ?? null;
    const before = new Set(useSystemStore.getState().fleetSessions.map((s) => s.id));
    const wantAthena = athenaArmed;
    const remote = c.runOn !== null;
    void (async () => {
      await c.handleSubmit();
      // A remote dispatch creates no session in THIS fleet, so there is
      // nothing here that could hold the grant.
      if (!wantAthena || !cwd || remote) return;
      const outcome = await grantAthenaToDispatch({
        cwd,
        before,
        sessions: () => useSystemStore.getState().fleetSessions,
        flag: setSessionAthenaFlag,
      });
      if (outcome.problem === 'none') return;
      // THE FAILURE THAT MATTERS. A dispatch that ran while the operator
      // believes Athena owns it is worse than no feature at all, so a grant
      // that did not land is TOLD, loudly, and names the manual way out.
      toastCatch(
        'fleet/dock:athena-grant',
        outcome.problem === 'unseen'
          ? t.monitor.grid_dock_athena_unseen
          : t.monitor.grid_dock_athena_failed,
      )(new Error(`athena grant ${outcome.problem} for dispatch at ${cwd}`));
    })();
  }, [c, athenaArmed, t]);

  return {
    c,
    t,
    expanded,
    expand,
    collapse,
    pickerOpen,
    togglePicker,
    closePicker,
    showPicker,
    showSuggestions,
    typeahead,
    athenaArmed,
    toggleAthena,
    firing,
    armed,
    estimate,
    landing,
    tally,
    fieldRef,
    submit,
  };
}
