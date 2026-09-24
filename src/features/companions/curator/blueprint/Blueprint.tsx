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
import { HelpSheet } from './HelpSheet';
import { useBlueprintKeys } from './useBlueprintKeys';
import { useBlueprintState } from './useBlueprintState';
import { useDelegatedTip } from './useDelegatedTip';
import { BlueprintWordsProvider, type BlueprintWords } from './words';

import './blueprint.css';
import './docket.css';

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

  const current = state.rows[state.cursor];

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
        <HelpSheet open={state.help} onClose={state.toggleHelp} />
        <AnchoredTooltip anchor={tip.anchor} content={tip.content} />
      </div>
    </BlueprintWordsProvider>
  );
}
