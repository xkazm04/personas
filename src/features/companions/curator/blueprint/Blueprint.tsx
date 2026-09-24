/**
 * BLUEPRINT - "The Ledger Opens".
 *
 * Layer one is the spread ledger and nothing else: nine columns, six of them
 * thin and icon-headed, ARE the graphic. Layer two is not a panel that arrives
 * from somewhere else - it is the row you clicked, grown, every cell becoming
 * the full drawing of its own reason in the place it already occupied.
 *
 * A PRESENTATIONAL PRIMITIVE. It takes its data (`model`, `docket`) and its
 * words (`words`) as props and reads nothing from the app, so the page can be
 * rendered against the product's real stylesheet outside the shell and held to
 * the winner's measured style contract.
 */
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { AnchoredTooltip } from '@/features/shared/components/display/Tooltip';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { matchesQuery } from '@/lib/text/search';

import { DeepLayer } from './deep/DeepLayer';
import { useDescent } from './deep/useDescent';
import { Docket } from './docket/Docket';
import { Bands } from './ledger/Bands';
import { Foot } from './ledger/Foot';
import { LedgerHead } from './ledger/LedgerHead';
import { LedgerRow } from './ledger/LedgerRow';
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
   * The operator's console, rendered as its own grid row between the verdict
   * and the ledger - the order the work happens in: she drains the human lane
   * BEFORE the plan below it.
   *
   * A node rather than data, because the console reaches IPC and this
   * component reaches nothing. The slot element is always rendered so the
   * grid's row placement does not depend on whether a host passed one; with
   * no node it collapses to nothing.
   */
  console?: ReactNode;
}

export function Blueprint({ model, docket, words, console: operatorConsole }: BlueprintProps) {
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

  // The map is bound on the page root rather than on `window`, so the page
  // never eats a key while the operator is somewhere else in the app. That
  // only works if something inside it holds focus, so it claims focus once.
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  // The matching policy (case folding, diacritics, multi-term) is the app's,
  // not this call site's: a subject slug typed with an accent must still find
  // its row in all fourteen locales.
  const query = state.query.trim();
  const current = state.rows[state.cursor];
  const bodyRows = useMemo(
    () =>
      state.rows.map((row, i) => (
        <LedgerRow
          key={row.id}
          row={row}
          index={i}
          model={model}
          current={i === state.cursor}
          dimmed={!!query && !matchesQuery(row.id, query)}
        />
      )),
    [model, query, state.cursor, state.rows],
  );

  return (
    <BlueprintWordsProvider value={words}>
      <div
        className="cb-root"
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
        <Verdict model={model} />
        <div className="cb-console-slot">{operatorConsole}</div>
        <main className="cb-stage" ref={deepRef}>
          <section className="cb-ledger" aria-label={words.w.ledger_region} aria-hidden={deep}>
            <div className="cb-lscroll" ref={ledgerRef}>
              <LedgerHead model={model} solo={state.solo} onSolo={state.toggleSolo} />
              <div
                role="listbox"
                aria-label={words.w.ledger_region}
                tabIndex={-1}
                onClick={(e) => {
                  const row = e.target instanceof Element ? e.target.closest('[data-cb-row]') : null;
                  if (row) descend(Number(row.getAttribute('data-cb-row')));
                }}
              >
                {bodyRows}
                <Bands model={model} />
              </div>
            </div>
          </section>
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
