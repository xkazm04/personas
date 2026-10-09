/**
 * The run viewer's output: read on open (`useRunOutput`), then shown as
 * labelled sections with the first error line marked and scrolled to, a
 * search with next / previous (Enter / Shift+Enter in the field) and a copy.
 *
 * Its states are each their own words: reading (a ghost of lines under the
 * permanent toolbar), nothing kept (`null`: the command did not run, or was
 * stopped at its timeout), printed nothing (`""`), and a read failure with a
 * retry.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

import { Button, CopyButton } from '@/features/shared/components/buttons';
import { Banner } from '@/features/shared/components/feedback/Banner';
import { GhostRows, SearchField, Toolbar } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { LifecycleRun } from '@/lib/bindings/LifecycleRun';

import { useLifecycleViewModel } from '../../context';
import { lcShape, lcSurface } from '../../system/lcSurface';
import { LT } from '../../system/lcType';
import { GLYPH } from '../../system/scales';
import { FirstErrorPlate } from './FirstErrorPlate';
import { firstErrorIndex, parseOutput, searchLines, stepMatch } from './outputModel';
import { OutputLines } from './OutputLines';
import { useRunOutput, type RunOutputState } from './useRunOutput';

function Plate({ text, testId }: { text: string; testId: string }) {
  return <p className={`${lcSurface('plate')} ${LT.row}`} data-testid={testId}>{text}</p>;
}

function OutputText({ text, run }: { text: string; run: LifecycleRun }) {
  const { dl, tx } = useLifecycleViewModel();
  const { language } = useTranslation();
  const parsed = useMemo(() => parseOutput(text), [text]);
  const errorAt = useMemo(() => firstErrorIndex(parsed.lines, run.firstError), [parsed, run.firstError]);
  const [query, setQuery] = useState('');
  const hits = useMemo(() => searchLines(parsed.lines, query, language), [parsed, query, language]);
  const hitSet = useMemo(() => new Set(hits), [hits]);
  const [at, setAt] = useState(-1);
  const box = useRef<HTMLDivElement>(null);

  const scrollTo = (line: number) => {
    const el = box.current?.querySelector<HTMLElement>(`[data-line="${line}"]`);
    if (!el || !box.current) return;
    box.current.scrollTop = Math.max(0, el.offsetTop - box.current.clientHeight / 2);
  };
  // Open on the first error; a new search lands on its first match.
  useEffect(() => { if (errorAt >= 0) scrollTo(errorAt); }, [errorAt]);
  useEffect(() => { setAt(hits.length ? 0 : -1); }, [hits]);
  useEffect(() => { if (at >= 0 && hits[at] != null) scrollTo(hits[at]!); }, [at, hits]);

  const step = (dir: 1 | -1) => setAt((a) => stepMatch(a, hits.length, dir));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    step(e.shiftKey ? -1 : 1);
  };
  const count = !query.trim() ? null : hits.length ? tx(dl.lcx6_search_count, { at: at + 1, count: hits.length }) : dl.lcx6_search_none;

  return (
    <div className="flex flex-col gap-3">
      <FirstErrorPlate text={run.firstError} onJump={errorAt >= 0 ? () => scrollTo(errorAt) : undefined} />
      <div onKeyDown={onKeyDown}>
        <Toolbar label={dl.lcx6_viewer_output}>
          <SearchField value={query} onChange={setQuery} placeholder={dl.lcx6_search} testId="lc6-output-search" />
          <span className={`${LT.metaNum} min-w-16`} role="status" data-testid="lc6-search-count">{count ?? ''}</span>
          <Button variant="ghost" size="icon-sm" onClick={() => step(-1)} disabled={!hits.length} aria-label={dl.lcx6_search_prev} data-testid="lc6-search-prev"><ChevronUp className={GLYPH.sm} /></Button>
          <Button variant="ghost" size="icon-sm" onClick={() => step(1)} disabled={!hits.length} aria-label={dl.lcx6_search_next} data-testid="lc6-search-next"><ChevronDown className={GLYPH.sm} /></Button>
          <CopyButton text={text} label={dl.lcx6_copy_output} tooltip={dl.lcx6_copy_output} />
        </Toolbar>
      </div>
      <div
        ref={box}
        className={`relative max-h-[calc(88vh-24rem)] min-h-40 overflow-auto border border-primary/15 bg-background ${lcShape('card')} shadow-inner`}
        tabIndex={0}
        aria-label={dl.lcx6_viewer_output}
        data-testid="lc6-output"
      >
        <OutputLines parsed={parsed} errorAt={errorAt} query={query} matches={hitSet} current={at >= 0 ? hits[at] ?? -1 : -1} />
      </div>
    </div>
  );
}

/** What the viewer shows for a run whose output is not (yet) text: its first error, then the state. */
function Quiet({ run, children }: { run: LifecycleRun; children: ReactNode }) {
  return <div className="flex flex-col gap-3"><FirstErrorPlate text={run.firstError} />{children}</div>;
}

export function RunOutput({ projectId, run }: { projectId: string | null; run: LifecycleRun }) {
  const { state, retry } = useRunOutput(projectId, run.id);
  if (state.status === 'ready' && state.text) return <OutputText text={state.text} run={run} />;
  return <Quiet run={run}><OutputState state={state} run={run} retry={retry} /></Quiet>;
}

function OutputState({ state, run, retry }: { state: RunOutputState; run: LifecycleRun; retry: () => void }) {
  const { dl } = useLifecycleViewModel();
  if (state.status === 'loading') {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" data-testid="lc6-output-loading">
        <span className="sr-only" role="status">{dl.lcx6_output_loading}</span>
        <GhostRows count={6} />
      </div>
    );
  }
  if (state.status === 'failed') return <Banner severity="error" compact message={dl.lcx6_output_failed} cause={state.error} onRetry={retry} />;
  if (state.text === null) {
    const why = run.outcome === 'did_not_run' ? dl.lcx6_output_none_did_not_run : run.outcome === 'timeout' ? dl.lcx6_output_none_timeout : dl.lcx6_output_none;
    return <Plate text={why} testId="lc6-output-none" />;
  }
  return <Plate text={dl.lcx6_output_empty} testId="lc6-output-empty" />;
}
