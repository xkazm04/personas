// sessionNodeView — what a SESSION node paints (a live row, or a queued one on
// the queue boards): its title, hue, frame, the symbol ids `nodeSymbols` orders
// for it, the elapsed fill and its label, and one renderer per symbol. Plain
// function, no hooks: `FleetNode` resolves the context, the formatted times and
// the motion posture and hands them in.

import { Timer } from 'lucide-react';
import { formatElapsedCompact } from '@/lib/utils/formatters';
import { sessionLabel, sessionStateMeta } from '../../fleetSessionModel';
import { asOrigin } from '../queue/useQueueModel';
import { originLabel } from '../queue/originLabel';
import { NUMERAL, GLYPH, StateGlyph, Swatch, Sym } from './NodeSymbolParts';
import {
  frameClass, ORIGIN_GLYPH, SESSION_STATE_MARK, sessionHue, sessionSymbols, symbolClass, WARNING_HUE,
} from './nodeSymbols';
import { liveMeterFill, queuedMeterFill, type NodeView, type SessionNodeProps } from './nodeTypes';
import type { NodeI18n } from './personaNodeView';

export interface SessionViewContext {
  meanDurationMs: number | null;
  queueLength: number;
  /** The queued row's estimated start, already formatted. */
  eta: string;
  /** The queued row's not-before gate, already formatted. */
  notBefore: string;
  reducedMotion: boolean;
}

export function sessionNodeView(
  props: SessionNodeProps,
  { t, tx }: NodeI18n,
  { meanDurationMs, queueLength, eta, notBefore, reducedMotion }: SessionViewContext,
): NodeView {
  const s = t.monitor;
  const { session, overAdmitted = false, originDevice = null } = props;
  const queue = props.queue ?? null;
  const m = sessionStateMeta(session.state);
  const queued = session.state === 'queued';
  const rank = queue?.rank ?? null;
  const gated = queue?.notBeforeMs != null && queue.notBeforeMs > Date.now();
  const origin = asOrigin(queue?.origin ?? session.origin);
  const createdAt = Number(session.createdAtMs);
  const stateLabel = t.plugins.fleet[m.labelKey];
  const hasFill = queued ? rank !== null && queueLength > 0 : session.state === 'running' && meanDurationMs !== null;
  const elapsedFill = !hasFill ? 0 : queued ? queuedMeterFill(rank, queueLength) : liveMeterFill(Date.now() - createdAt, meanDurationMs);
  const hue = overAdmitted ? WARNING_HUE : sessionHue(session.state);
  const OriginIcon = ORIGIN_GLYPH[origin];
  const renderers: NodeView['renderers'] = {};

  renderers.state = () => (
    <Sym id="state" label={overAdmitted ? `${stateLabel} · ${s.queue_over_admitted}` : stateLabel} testId="fleet-node-state" data={{ 'data-state': session.state }} className={symbolClass(hue)}>
      <StateGlyph mark={SESSION_STATE_MARK[session.state]} reducedMotion={reducedMotion} />
    </Sym>
  );
  const originText = originDevice
    ? tx(s.remote_from_device, { device: originDevice })
    : tx(s.node_symbol_origin, { origin: originLabel(s, origin) });
  renderers.origin = () => (
    <Sym id="origin" label={originText} testId="fleet-queue-origin" data={{ 'data-origin': origin, ...(originDevice ? { 'data-origin-device': originDevice } : {}) }} className={symbolClass(hue)}>
      <OriginIcon aria-hidden className={GLYPH} />
    </Sym>
  );
  renderers.rank = () => (
    <Sym id="rank" label={tx(s.queue_rank_aria, { rank: rank! })} testId="fleet-queue-rank" data={{ 'data-rank': String(rank) }} className={`${symbolClass(hue)}`}>
      <span aria-hidden className={NUMERAL}>{rank! > 99 ? '99+' : rank}</span>
    </Sym>
  );
  renderers.gate = () => (
    <Sym id="gate" label={tx(s.queue_not_before, { time: notBefore })} testId="fleet-node-gate" className={symbolClass(hue)}>
      <Timer aria-hidden className={GLYPH} />
    </Sym>
  );
  renderers.project = () => (
    <Sym id="project" label={tx(s.node_symbol_project, { name: session.projectLabel ?? '' })} testId="fleet-node-project" className="">
      <Swatch name={session.projectLabel ?? ''} />
    </Sym>
  );

  return {
    title: sessionLabel(session),
    hue,
    frame: frameClass(hue),
    titleTone: '',
    ids: sessionSymbols({
      state: session.state, elapsedFill: hasFill ? elapsedFill : null, rank, gated, projectLabel: session.projectLabel ?? null,
    }),
    bubble: null,
    elapsedFill,
    elapsedLabel: queued
      ? (queue?.estimatedStartMs != null ? tx(s.queue_estimated_start, { time: eta }) : s.queue_no_estimate)
      : tx(s.node_symbol_elapsed, { time: formatElapsedCompact(new Date(createdAt).toISOString(), '-') }),
    renderers,
  };
}
