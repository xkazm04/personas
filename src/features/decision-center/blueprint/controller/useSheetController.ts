// The sheet's controller: composes the read side (data, plan, work), the reducer, the engine's view, navigation,
// the writes and the keyboard into the one `Sheet` value every panel reads. Panels never reach past it.
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Engine } from '../engine/Engine';
import { scopeOf, queueIn, type Level } from '../model/scope';
import type { BlueprintActions, BlueprintData } from '../source';
import { TipStore } from '../state/tipStore';
import { initialUi, uiReducer } from '../state/uiState';
import { ViewStore, useViewLevel } from '../state/viewStore';
import type { Sheet } from './SheetContext';
import { useBlueprintText, useEngineWords } from './useBlueprintText';
import { useEngineHooks } from './useEngineHooks';
import { startLines } from '../ui/rail/panels/agentsModel';
import { useStartedBuilds } from '../live/useStartedBuilds';
import { useLiveRefresh } from './useLiveRefresh';
import { useNavigation } from './useNavigation';
import { useSheetData } from './useSheetData';
import { useSheetKeys } from './useSheetKeys';
import { useWrites, type Say } from './useWrites';

interface Props {
  data: BlueprintData;
  actions: BlueprintActions;
  onClose: () => void;
  initialFeature?: string;
}

export function useSheetController({ data: initial, actions, onClose, initialFeature }: Props) {
  const text = useBlueprintText();
  const words = useEngineWords(text);
  const { data, plan, work, reload, readAt } = useSheetData(initial, actions);
  const [ui, dispatch] = useReducer(uiReducer, undefined, () => initialUi());
  const view = useRef(new ViewStore()).current;
  const tip = useRef(new TipStore()).current;
  const [engine, setEngine] = useState<Engine | null>(null);
  const level = useViewLevel(view);
  const { B, tx } = text;

  const scope = useMemo(
    () => scopeOf(plan.L, level.n as Level, { wing: level.wing, room: level.room, bay: level.bay }, ui.sheet),
    [plan, level, ui.sheet],
  );
  const queue = useMemo(() => queueIn(work, plan.L, scope, ui.lens), [work, plan, scope, ui.lens]);
  const queueAll = useMemo(() => queueIn(work, plan.L, scopeOf(plan.L, 0, {}, null), ui.lens), [work, plan, ui.lens]);
  const current = ui.itemId ? work.byId.get(ui.itemId) ?? null : null;

  const nav = useNavigation({ engine, plan, work, ui, dispatch, queue });
  const say = useMemo<Say>(() => {
    const verb = { approve: B.verb_approve, decline: B.verb_decline, build: B.verb_build, accept: B.verb_accept, rework: B.verb_rework, descope: B.verb_descope, reopen: B.verb_reopen };
    return {
      pickFirst: () => B.say_pick,
      nothingToMove: (m) => (m === 'approve' ? B.say_nothing_approve : m === 'decline' ? B.say_nothing_decline : B.say_nothing_build),
      armed: (n, jobs) => tx(B.say_armed, { items: n, jobs }),
      sent: (m, done, skipped) => tx(B.say_sent, { verb: verb[m], done, skipped }),
      failed: (message) => tx(B.say_failed, { message }),
      disarmed: () => B.say_disarmed,
    };
  }, [B, tx]);
  // the builds this sheet started, followed on the fleet; the last session of one ending is one immediate reload
  const starts = useMemo(() => startLines(ui.lines), [ui.lines]);
  const started = useStartedBuilds(starts, reload, data.scan.runs);
  const fast = started.unsettled || data.scan.runs.some((r) => r.status === 'running');
  useLiveRefresh({ reload, readAt, fast });
  const live = useMemo(() => ({ building: started.building, started: started.byLabel }), [started.building, started.byLabel]);
  const writes = useWrites({ actions, work, ui, dispatch, reload, say });
  const hooks = useEngineHooks({ engine, plan, work, lens: ui.lens, nav, dispatch, tip });

  useSheetKeys({ plan, ui, dispatch, levelNow: () => (engine ? engine.cam.level().n : 0), nav, writes, current, onClose, sayEnterHint: () => dispatch({ type: 'say', text: B.say_enter_hint }) });

  // open at the item the caller named, once the camera exists
  const opened = useRef(false);
  useEffect(() => {
    if (!engine || opened.current || !initialFeature) return;
    opened.current = true;
    const T = plan.L.TILE[initialFeature];
    if (!T) return;
    engine.cam.flyTo(engine.cam.fitOf(T.bay), 0);
    nav.openSheet(initialFeature);
  }, [engine, initialFeature, plan, nav]);

  const sheet = useMemo<Sheet>(
    () => ({ data, actions, plan, work, ui, dispatch, engine, view, text, words, scope, queue, queueAll, current, nav, writes, live, onClose }),
    [data, actions, plan, work, ui, engine, view, text, words, scope, queue, queueAll, current, nav, writes, live, onClose],
  );
  return { sheet, words, hooks, tip, setEngine };
}
