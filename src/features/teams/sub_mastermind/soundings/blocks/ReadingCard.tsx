// Soundings L2 — ONE READING, lifted: its tooling and the real Improve action,
// the progress ladder, which depth it puts the project at, and the same reading
// across the whole portfolio.
import type { CSSProperties } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { DIM_REGISTRY, type DimKey } from '../../lib/dimRegistry';
import type { Box, ChartGeo } from '../soundingsGeometry';
import { BAND_OF, categoryOf, type Station } from '../soundingsModel';
import { STATUS_COLOR, StatusMark, toolText } from '../soundingsParts';
import { anchorOf, CompareStrip, useActionWord, useBandWords, useStatusWord, type CardHandlers } from '../cardShell';

export function ReadingCard({ station, dimKey, stations, g, card, h }: {
  station: Station;
  dimKey: DimKey;
  stations: readonly Station[];
  g: ChartGeo;
  card: Box;
  h: CardHandlers;
}) {
  const { t, tx } = useTranslation();
  const m = t.mastermind;
  const band = useBandWords();
  const statusWord = useStatusWord();
  const actionWord = useActionWord();
  const node = station.island.nodes.find((n) => n.key === dimKey);
  if (!node) return null;
  const def = DIM_REGISTRY[dimKey];
  const b = BAND_OF[node.status];
  const catLabel = { runtime: m.dim_cat_runtime, delivery: m.dim_cat_delivery, agentic: m.dim_cat_agentic, product: m.dim_cat_product }[categoryOf(dimKey)];
  const errors = station.island.monitorErrors;

  let reach: string;
  if (node.steps) reach = tx(m.soundings_reached, { reached: node.reached, steps: node.steps });
  else if (node.status === 'solid') reach = m.soundings_check_yes;
  else if (node.status === 'partial') reach = m.soundings_check_partly;
  else reach = m.soundings_check;

  return (
    <div className="sd-card-body" key={`${station.island.slug}:${dimKey}`} style={{ '--c': STATUS_COLOR[node.status] } as CSSProperties}>
      <div className="sd-c-head">
        <span className="sd-c-over typo-label">{`${station.island.name} · ${catLabel}`}</span>
        <h2 className="sd-c-title typo-heading-lg" id="sd-card-title">{node.label}</h2>
        <span className="sd-c-status"><StatusMark status={node.status} /><span>{statusWord(node.status)}</span></span>
      </div>
      <div className="sd-c-body">
        <div>
          <span className="sd-c-lab typo-label">{m.world_tooling}</span>
          <div className="sd-c-tool">
            {node.detail ? toolText(node.detail) : <span className="sd-muted">{node.status === 'unknown' ? m.soundings_could_not_read : m.cell_empty}</span>}
          </div>
          {def.viewOnly ? (
            <div className="sd-c-note">{m.soundings_view_only}</div>
          ) : node.action ? (
            <div className="sd-acts">
              <button type="button" className="sd-act" data-testid="sd-improve" onClick={(e) => h.onImprove(node, anchorOf(e))}>
                {tx(m.soundings_improve_action, { action: actionWord(node.action) })}
              </button>
            </div>
          ) : null}
        </div>
        <div>
          <span className="sd-c-lab typo-label">{m.world_progress}</span>
          <ol className="sd-ladder">
            {node.steps
              ? Array.from({ length: node.steps }, (_, k) => (
                <li key={k} className={`typo-code${k < node.reached ? ' sd-on' : ''}`}><i />{tx(m.soundings_step, { n: k + 1 })}</li>
              ))
              : (
                <>
                  <li className={`typo-code${node.status === 'solid' ? ' sd-on' : ''}`}><i />{m.soundings_yes}</li>
                  <li className="typo-code"><i />{m.soundings_no}</li>
                </>
              )}
          </ol>
          <div className="sd-c-reach">{reach}</div>
        </div>
        <div>
          <span className="sd-c-lab typo-label">{m.soundings_depth}</span>
          <div className="sd-c-tool">{`${band.name[b]}, ${band.mean[b]}`}</div>
          {dimKey === 'monitoring' && errors !== null && (
            <div className="sd-c-note">{tx(errors === 1 ? m.soundings_live_errors_one : m.soundings_live_errors_other, { count: errors })}</div>
          )}
        </div>
      </div>
      <CompareStrip
        stations={stations}
        g={g}
        card={card}
        me={station.index}
        label={tx(m.soundings_across, { dim: node.label })}
        markFor={(s) => {
          const q = s.island.nodes.find((n) => n.key === dimKey);
          return q ? { status: q.status, band: BAND_OF[q.status] } : null;
        }}
        onPick={h.onCompare}
      />
    </div>
  );
}
