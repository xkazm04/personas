/**
 * THE DOCKET - one drawer, three states (shut, a lane, the full surface), and
 * three visibly different FORMS for the three states a decision can be in.
 *
 * It ships EMPTY, and that is the point. `curator_decisions_list` does not
 * exist and nothing writes a decision yet, so there are no rows to show. The
 * page's own doctrine is that an absent thing must not be drawn as a zero, and
 * this is that rule applied to itself: the drawer says nothing is waiting
 * rather than rendering a queue of zeros or a fabricated demo.
 */
import { InboxZero } from '@/features/shared/components/feedback/ScenarioEmptyState';

import type { DocketEntry, DocketFeed } from '../model/docket';
import { useWords } from '../words';

import { CardDetail, DocketCard } from './DocketCard';
import { DocketOptions } from './DocketOptions';
import { DocketReceipt } from './DocketReceipt';
import { SettledLines } from './SettledLines';

export interface DocketState {
  open: boolean;
  full: boolean;
  selected: string | null;
  decided: Record<string, { option: string; reason: string }>;
}

interface DocketProps {
  feed: DocketFeed;
  state: DocketState;
  onSelect: (id: string) => void;
  onAnswer: (entry: DocketEntry, option: string) => void;
  onToggleFull: () => void;
  onClose: () => void;
  prompt: { id: string; option: string } | null;
  onPromptChange: (value: string) => void;
  promptValue: string;
  onPromptCommit: () => void;
}

function Section({ label, count }: { label: string; count: number }) {
  return (
    <div className="cb-sect typo-label cb-up">
      {label} <b>{count}</b>
      <span className="cb-ln" />
    </div>
  );
}

export function Docket(props: DocketProps) {
  const { feed, state, onSelect, onToggleFull, onClose } = props;
  const { w } = useWords();
  const waiting = feed.entries.filter((e) => !e.answeredBy && !state.decided[e.id]);
  const granted = feed.entries.filter((e) => e.answeredBy && !state.decided[e.id]);
  const settledCount = feed.settled.length + Object.keys(state.decided).length;
  const nothingAtAll = !feed.entries.length && !feed.settled.length;

  return (
    <section
      className={`cb-docket${state.open ? ' cb-open' : ''}${state.full ? ' cb-full' : ''}`}
      data-role="cb-docket"
      aria-label={w.docket_title}
      aria-hidden={!state.open}
    >
      <div className="cb-dk-head" data-role="cb-docket-head">
        <h2 className="typo-section-title">{w.docket_title}</h2>
        <div className="cb-cnt typo-caption">
          <span>
            <b style={{ color: 'var(--brand-amber)' }}>{waiting.length}</b> {w.docket_waiting}
          </span>
          <span>
            <b style={{ color: 'var(--status-success)' }}>{granted.length}</b> {w.docket_by_grant}
          </span>
          <span>
            <b style={{ color: 'var(--foreground)' }}>{settledCount}</b> {w.docket_settled}
          </span>
        </div>
        <span className="cb-sp" />
        <button
          type="button"
          className="cb-tbtn typo-caption"
          data-role="cb-docket-full"
          onClick={onToggleFull}
        >
          <kbd>F</kbd>
          {state.full ? w.docket_lane : w.docket_full}
        </button>
        <button type="button" className="cb-tbtn typo-caption" onClick={onClose}>
          <kbd>Esc</kbd>
          {w.docket_close}
        </button>
      </div>
      <div className="cb-dk-body">
        <div className="cb-dk-list">
          {nothingAtAll ? (
            <div className="cb-empty-docket">
              <InboxZero title={w.docket_empty_title} subtitle={w.docket_empty_body} />
            </div>
          ) : (
            <>
              <Section label={w.docket_section_waiting} count={waiting.length} />
              {waiting.map((entry) => (
                <DocketCard
                  key={entry.id}
                  entry={entry}
                  selected={state.selected === entry.id}
                  expanded={!state.full}
                  prompt={props.prompt}
                  promptValue={props.promptValue}
                  onPromptChange={props.onPromptChange}
                  onPromptCommit={props.onPromptCommit}
                  onSelect={onSelect}
                  onAnswer={props.onAnswer}
                />
              ))}
              <Section label={w.docket_section_grant} count={granted.length} />
              {granted.map((entry) => (
                <DocketReceipt
                  key={entry.id}
                  entry={entry}
                  selected={state.selected === entry.id}
                  expanded={!state.full}
                  onSelect={onSelect}
                  onAnswer={props.onAnswer}
                />
              ))}
              <Section label={w.docket_section_settled} count={settledCount} />
              <SettledLines
                feed={feed}
                decided={state.decided}
                selected={state.selected}
                onSelect={onSelect}
              />
            </>
          )}
        </div>
        <div className="cb-dk-detail">
          {state.full &&
            feed.entries
              .filter((e) => e.id === state.selected)
              .map((entry) => (
                <div key={entry.id}>
                  <div className="cb-k1 typo-caption">
                    <span className="cb-lvl typo-code">{entry.level}</span>
                    {w.kind[entry.kind]}
                  </div>
                  <h3 className="typo-heading-lg" style={{ margin: '5px 0 9px' }}>
                    {entry.title}
                  </h3>
                  {!state.decided[entry.id] && (
                    <DocketOptions entry={entry} onAnswer={props.onAnswer} />
                  )}
                  <div style={{ marginTop: '11px' }}>
                    <CardDetail
                      entry={entry}
                      prompt={props.prompt}
                      promptValue={props.promptValue}
                      onPromptChange={props.onPromptChange}
                      onPromptCommit={props.onPromptCommit}
                    />
                  </div>
                </div>
              ))}
        </div>
      </div>
    </section>
  );
}
