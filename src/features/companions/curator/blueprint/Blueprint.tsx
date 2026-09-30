/**
 * BLUEPRINT - "The Ledger Opens".
 *
 * Layer one is the spread ledger and nothing else: nine columns, six of them
 * thin and icon-headed, ARE the graphic. Layer two is not a panel that arrives
 * from somewhere else - it is the row you clicked, grown, every cell becoming
 * the full drawing of its own reason in the place it already occupied.
 *
 * A PRESENTATIONAL PRIMITIVE: data (`model`, `docket`) and words (`words`)
 * come in as props and it reads nothing from the app, so the whole page can be
 * rendered and measured in a harness. The contest prototype's style contract
 * was retired at the 2026-09-25 module gate - controls and type are the app's
 * now, and only the nine-channel drawing stays bespoke.
 */
import { useCallback, useEffect, useRef, type ReactNode } from 'react';

import { AnchoredTooltip } from '@/features/shared/components/display/Tooltip';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

import { DeepLayer } from './deep/DeepLayer';
import { useDescent } from './deep/useDescent';
import { Docket } from './docket/Docket';
import { Foot } from './ledger/Foot';
import { LedgerBody } from './ledger/LedgerBody';
import type { BlueprintPhase } from './ledger/LedgerEmpty';
import { TopBar } from './ledger/TopBar';
import { Verdict } from './ledger/Verdict';
import type { DocketFeed } from './model/docket';
import type { BlueprintModel } from './model/types';
import { GapsDrawer } from './GapsDrawer';
import type { GapsReading } from './gaps/useGaps';
import { HelpSheet } from './HelpSheet';
import { QueueDrawer } from './QueueDrawer';
import { useBlueprintKeys } from './useBlueprintKeys';
import { useBlueprintState } from './useBlueprintState';
import { useDelegatedTip } from './useDelegatedTip';
import { BlueprintWordsProvider, type BlueprintWords } from './words';

import './blueprint.css';
import './docket.css';

/** No host supplied a reading: every door is unread, nothing is a zero. */
const EMPTY_GAPS: GapsReading = {
  impediments: null,
  growth: null,
  attrition: null,
  loading: false,
  reload: () => {},
};

export interface BlueprintProps {
  model: BlueprintModel;
  docket: DocketFeed;
  words: BlueprintWords;
  /**
   * The operator's console: its own grid row between the verdict and the
   * ledger, the order the work happens in - she drains the human lane BEFORE
   * the plan below it. A node rather than data, because the console reaches
   * IPC and this component reaches nothing; the slot element is always
   * rendered, so row placement never depends on whether a host passed one.
   */
  console?: ReactNode;
  /**
   * The operator's own request queue, drawn in the drawer beside the docket.
   * A node for the same reason the console is one: the lane reaches IPC and
   * this component reaches nothing.
   */
  queue?: ReactNode;
  /**
   * What is in her way, what her running cost, and whether the ecosystem grew.
   *
   * DATA rather than a node, unlike the console and the queue, because the
   * drawer's chrome and its three bands are page furniture and belong here; only
   * the reading crosses IPC. An all-`null` reading is the honest default: a
   * harness with no backend draws the drawer's unread form, which is a form the
   * app genuinely has.
   */
  gaps?: GapsReading;
  /**
   * Told which surface holds the right-hand slot, so a container that owns IPC
   * can pay for the Gaps reads only while that drawer is the open one. The one
   * drawer slot lives in here; this is how it gets out.
   */
  onDrawerChange?: (which: 'docket' | 'queue' | 'gaps' | null) => void;
  /**
   * Which unpopulated phase the page is in, read ONLY when the model carries no
   * rows. A read in flight, an instrument running and a registry nobody has
   * measured are three sentences, and the ledger body says the right one rather
   * than announcing emptiness over a read that has not landed.
   */
  phase?: BlueprintPhase;
}

export function Blueprint({
  model,
  docket,
  words,
  console: operatorConsole,
  queue,
  gaps,
  onDrawerChange,
  phase = 'unrun',
}: BlueprintProps) {
  const state = useBlueprintState(model, docket);
  const rootRef = useRef<HTMLDivElement>(null);
  const ledgerRef = useRef<HTMLDivElement>(null);
  const deepRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const reduced = useCallback(() => reducedMotion, [reducedMotion]);
  const { tip, bind } = useDelegatedTip();

  const land = useCallback(
    (index: number) => {
      state.setCursor(index);
      ledgerRef.current
        ?.querySelector<HTMLElement>(`[data-cb-row="${String(index)}"]`)
        ?.focus({ preventScroll: true });
    },
    [state],
  );
  const descent = useDescent(ledgerRef, deepRef, reduced, land);
  const deep = descent.layer === 'deep';

  const descend = useCallback(
    (index: number) => {
      state.setCursor(index);
      descent.descend(index);
    },
    [descent, state],
  );
  const onKeyDown = useBlueprintKeys({ state, deep, descend, ascend: descent.ascend });

  // The key map is bound on the page root, not on `window`, so the page never
  // eats a key while the operator is elsewhere - which needs focus inside it.
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  // The slot, reported outward. An effect rather than a call inside the toggle
  // because the slot also moves when one drawer swaps for another, and a host
  // that learned about it from three separate setters would miss exactly that.
  useEffect(() => {
    onDrawerChange?.(state.drawerName);
  }, [onDrawerChange, state.drawerName]);

  const current = state.rows[state.cursor];

  // An all-absent reading when no host supplied one: the drawer then draws its
  // unread form, which is a real form of the surface rather than a stand-in.
  const reading: GapsReading = gaps ?? EMPTY_GAPS;
  // What the bar's pill counts: the things a person would open the drawer FOR -
  // what is in her way, and what stopped reporting. `null` while neither door
  // has answered, because an unread count must not draw as a zero.
  const gapCount =
    reading.impediments === null && reading.attrition === null
      ? null
      : (reading.impediments?.length ?? 0) + (reading.attrition?.runs.length ?? 0);

  return (
    <BlueprintWordsProvider value={words}>
      <div
        className="cb-root"
        // The app's tier for a dense tool surface (typography.css, Gate 3):
        // one step down the ramp, everything else unchanged.
        data-type-density="compact"
        data-role="cb-blueprint"
        data-layer={descent.layer}
        ref={rootRef}
        role="application"
        aria-label={words.w.title}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        {...bind}
      >
        <TopBar
          model={model}
          waiting={state.waiting}
          docketOpen={state.docket.open}
          onToggleDocket={state.toggleDocket}
          queueOpen={state.queue.open}
          onToggleQueue={state.toggleQueue}
          gapsOpen={state.gaps.open}
          onToggleGaps={state.toggleGaps}
          gapCount={gapCount}
          query={state.query}
          onQuery={state.setQuery}
          onHelp={state.toggleHelp}
        />
        {/* Both collapse during the descent - the corpus and her queue are not
            what the operator is reading - and leave the a11y tree with it. */}
        <Verdict model={model} hidden={deep} />
        <div className="cb-console-slot" aria-hidden={deep}>
          {operatorConsole}
        </div>
        <main className="cb-stage" ref={deepRef}>
          <LedgerBody
            model={model}
            rows={state.rows}
            cursor={state.cursor}
            query={state.query.trim()}
            solo={state.solo}
            onSolo={state.toggleSolo}
            onDescend={descend}
            phase={phase}
            scrollRef={ledgerRef}
            hidden={deep}
          />
          {current && (
            <DeepLayer
              row={current}
              index={state.cursor}
              model={model}
              active={deep}
              onBack={descent.ascend}
              onMounted={descent.playIn}
            />
          )}
        </main>
        <Foot model={model} waiting={state.waiting} />
        <Docket
          feed={docket}
          state={state.docket}
          onSelect={state.selectCard}
          onAnswer={state.answer}
          onToggleFull={state.toggleFull}
          onClose={state.closeDocket}
          prompt={state.prompt}
          promptValue={state.promptValue}
          onPromptChange={state.setPromptValue}
          onPromptCommit={state.commitPrompt}
        />
        <QueueDrawer open={state.queue.open} onClose={state.closeQueue}>
          {queue}
        </QueueDrawer>
        <GapsDrawer open={state.gaps.open} onClose={state.closeGaps} reading={reading} />
        <HelpSheet open={state.help} onClose={state.toggleHelp} />
        <AnchoredTooltip anchor={tip.anchor} content={tip.content} />
      </div>
    </BlueprintWordsProvider>
  );
}
