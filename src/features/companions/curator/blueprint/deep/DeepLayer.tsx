/**
 * LAYER TWO - not a panel that slides in from somewhere else. It is the row
 * you opened, grown: the origin band is the row itself, still carrying its
 * nine marks in their nine columns, and every strip below it came out of one
 * of those cells.
 *
 * Hovering or focusing a strip rings the column it grew from, which is the
 * only thing in the page that says out loud what the transition means.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { CHANNEL_ORDER } from '../model/channels';
import type { BlueprintModel, BlueprintRow } from '../model/types';
import { fmt } from '../format';
import { LedgerRow } from '../ledger/LedgerRow';
import { ENGINE_GLYPH, STATE_GLYPH, stateColour } from '../ledger/vocabulary';
import { useWords } from '../words';

import { ChannelStrip } from './ChannelStrip';
import { DeepSide } from './DeepSide';

interface DeepProps {
  row: BlueprintRow;
  index: number;
  model: BlueprintModel;
  active: boolean;
  onBack: () => void;
  onMounted: (origin: HTMLElement | null, strips: HTMLElement[]) => void;
}

function DeepHead({ row, model, onBack }: { row: BlueprintRow; model: BlueprintModel; onBack: () => void }) {
  const { w, tx } = useWords();
  return (
    <div className="cb-dhead">
      <div className="cb-idy">
        <h2 className="typo-heading-lg">{row.slug}</h2>
        <div className="cb-at typo-code">{`${row.domain} / ${row.at}`}</div>
      </div>
      <button type="button" className="cb-tbtn typo-caption" data-role="cb-back" onClick={onBack}>
        <kbd>Esc</kbd>
        {w.deep_back}
      </button>
      <div className="cb-facts typo-caption">
        <span>
          <b className="typo-data-lg" style={{ color: 'var(--foreground)' }}>
            {row.points}
          </b>{' '}
          {tx(w.deep_points_rank, { rank: row.rank, total: fmt(model.rows.length) })}
        </span>
        <span style={{ color: stateColour(row.state) }}>
          <span className="cb-gl">{STATE_GLYPH[row.state]}</span> {w.state[row.state]}
        </span>
        <span>
          <span className="cb-gl">{ENGINE_GLYPH[row.engine]}</span> {w.deep_engine}{' '}
          <b style={{ color: 'var(--foreground)' }}>{row.engine}</b> {w.engine[row.engine]}
        </span>
        {row.declinedReason && (
          <span style={{ color: 'var(--status-error)' }}>{row.declinedReason}</span>
        )}
        {row.evidenceRef && (
          <span>
            {w.deep_evidence} <code className="typo-code">{row.evidenceRef}</code>
          </span>
        )}
        {row.dispatchedRunId && (
          <span>
            {w.deep_run} <code className="typo-code">{row.dispatchedRunId}</code>
          </span>
        )}
      </div>
    </div>
  );
}

export function DeepLayer({ row, index, model, active, onBack, onMounted }: DeepProps) {
  const { w } = useWords();
  const ref = useRef<HTMLElement>(null);
  const [hot, setHot] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!active) return;
    const scope = ref.current;
    onMounted(
      scope?.querySelector<HTMLElement>('[data-role="cb-origin"]') ?? null,
      Array.from(scope?.querySelectorAll<HTMLElement>('[data-role="cb-strip"]') ?? []),
    );
  }, [active, onMounted, row.id]);

  // The view lands on the first channel that actually scores - the reason the
  // row is here. If nothing scores, the first strip is as good an answer.
  useEffect(() => {
    if (!active) return;
    const first =
      ref.current?.querySelector<HTMLElement>('[data-role="cb-strip"]:not(.cb-empty)') ??
      ref.current?.querySelector<HTMLElement>('[data-role="cb-strip"]');
    first?.focus({ preventScroll: true });
  }, [active, row.id]);

  const track = useCallback((e: React.SyntheticEvent) => {
    const strip = e.target instanceof Element ? e.target.closest('[data-cb-ch]') : null;
    setHot(strip ? Number(strip.getAttribute('data-cb-ch')) : null);
  }, []);

  return (
    <section
      className="cb-deep"
      data-role="cb-deep"
      ref={ref}
      aria-label={w.deep_region}
      aria-hidden={!active}
    >
      <div className="cb-scrim" aria-hidden="true" />
      <div
        className="cb-dorigin"
        data-role="cb-origin"
        data-cb-tip={w.deep_origin_tip}
        onClick={onBack}
        role="presentation"
      >
        <LedgerRow row={row} index={index} model={model} current dimmed={false} asOrigin hot={hot} />
      </div>
      <div className="cb-dwrap">
        <DeepHead row={row} model={model} onBack={onBack} />
        <div className="cb-dbody">
          <div className="cb-dchans" onMouseOver={track} onFocus={track} onMouseLeave={() => { setHot(null); }}>
            {CHANNEL_ORDER.map((id) => (
              <ChannelStrip key={id} channel={id} row={row} model={model} />
            ))}
          </div>
          <DeepSide row={row} model={model} />
        </div>
      </div>
    </section>
  );
}
