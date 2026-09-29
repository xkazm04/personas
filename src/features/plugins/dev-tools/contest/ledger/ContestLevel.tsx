// Level 2, one contest: its seats as dials on the left (the ring is the time
// limit, the beads are delivered variants), the chain and the decision below
// them, and the sorting bench beside them: five trays, the empty ones slim.
// Drag a card or focus it and press 1-4; Enter opens the variant.
import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  Check,
  CircleDot,
  Circle,
  Eye,
  FileText,
  Film,
  GitBranch,
  Layers,
  Lock,
  Medal,
  Minus,
  Monitor,
  NotebookPen,
  Pin,
  Play,
  RotateCcw,
  Square,
  Trophy,
  Wrench,
  X,
} from 'lucide-react';

import { cancelContest, decideContest, launchContest, runContestStep } from '@/api/contest';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import type { ContestReviewBucket } from '@/lib/bindings/ContestReviewBucket';
import type { ContestSeat } from '@/lib/bindings/ContestSeat';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';
import type { ContestVariant } from '@/lib/bindings/ContestVariant';
import { toastCatch } from '@/lib/silentCatch';
import { formatCount } from '@/lib/utils/formatters';
import { useToastStore } from '@/stores/toastStore';

import { openSessionInMonitor } from '../openInMonitor';
import { primeSummary } from '../hooks/contestStore';
import type { ReviewDraft } from '../hooks/useReviewDraft';
import { chainStations, recordedBucket, retrySteps, trays, variantName, formatUntil, type StationStatus } from '../model/contestModel';
import { bucketLabel, canRerun, isRerunnable, phaseLabel, stepLabel, type ContestStrings } from '../model/labels';
import {
  canDecide,
  decisionLock,
  decisionReadiness,
  refineDeletions,
  variantReview,
  winnerNote,
} from '../model/reviewModel';
import {
  BENCH_ORDER,
  benchLayout,
  ceilingS,
  childrenOf,
  heatPercent,
  parentOf,
  participantSeats,
  reportedCost,
  SCORE_DIMS,
  seatElapsedS,
  seatEstimate,
  shortTitle,
  startOf,
  type BenchTray,
} from './ledgerModel';
import { plainStateLabel, stationLabel, stationStatusLabel, type LedgerStrings } from './ledgerLabels';
import {
  bucketColor,
  cssVars,
  formatBytes,
  formatClock,
  formatDay,
  formatDuration,
  formatUsd,
  Kbd,
  PhaseDot,
  Rich,
  Seat,
  seatColor,
  stillOf,
  Still,
  toneVar,
} from './parts';

export const BUCKET_KEY: Record<ContestReviewBucket, string> = { winner: '1', shortlist: '2', impractical: '3', failure: '4' };
export const BUCKET_ICON = { winner: Trophy, shortlist: Medal, impractical: Wrench, failure: Ban } as const;

export interface ContestLevelProps {
  summary: ContestSummary;
  detail: ContestDetail | null;
  detailError: unknown;
  draft: ReviewDraft;
  contests: ContestSummary[];
  card: string | null;
  onCard: (key: string) => void;
  onSort: (vkey: string, bucket: ContestReviewBucket | null) => void;
  onOpenVariant: (vkey: string | null, from: HTMLElement | null) => void;
  onOpenContest: (key: string) => void;
  onBack: () => void;
  cardRefs: RefObject<Map<string, HTMLDivElement>>;
  nowMs: number;
  wide: boolean;
  mainWidth: number;
}

/** Whether the owner may still sort: not once the verdict is written. */
export function isEditable(summary: Pick<ContestSummary, 'phase'>): boolean {
  return summary.phase !== 'decided' && summary.phase !== 'shortlisted';
}

export function lockText(L: LedgerStrings, s: ContestStrings, summary: ContestSummary, tx: (t: string, v: Record<string, string | number>) => string): string | null {
  const lock = decisionLock(summary.phase);
  switch (lock) {
    case null: return null;
    case 'racing': return summary.phase === 'queued' ? L.lock_queued : summary.phase === 'draft' ? L.lock_draft : L.lock_building;
    case 'judging': return L.lock_judging;
    case 'decided': return summary.winner ? tx(s.decide_locked_decided, { key: summary.winner }) : s.phase_decided;
    case 'shortlisted': return s.decide_locked_shortlisted;
    case 'collecting': return s.decide_locked_collecting;
    case 'failed': return s.decide_locked_failed;
  }
}

export function ContestLevel(props: ContestLevelProps) {
  const { summary, detail, detailError, draft, contests, nowMs, onBack, onOpenContest } = props;
  const { t, tx, language } = useTranslation();
  const s = t.plugins.contest;
  const L = s.ledger;
  const [confirmStop, setConfirmStop] = useState(false);
  const parent = parentOf(contests, summary);
  const start = startOf(summary.ledger, nowMs);
  const cost = reportedCost(summary.ledger.seats);
  const kids = childrenOf(contests, summary);
  const variants = detail?.variants ?? [];
  const { projectId, contestId, phase } = summary;
  const live = phase === 'queued' || phase === 'running' || phase === 'collecting' || phase === 'judging';

  const meta = [
    <span key="ph" className="ph">
      <PhaseDot phase={phase} />
      {phaseLabel(s, phase)}
    </span>,
    summary.round ? tx(L.round_n, { n: summary.round }) : null,
    new Set(contests.map((c) => c.projectId)).size > 1 ? summary.projectName : null,
    start ? (
      start.upcoming ? (
        tx(L.meta_starts, { when: formatUntil(start.ms, nowMs, language) })
      ) : (
        <Rich key="st" template={L.meta_started} values={{ when: <RelativeTime timestamp={start.ms} showTooltip={false} /> }} />
      )
    ) : (
      tx(L.meta_created, { date: formatDay(summary.date, language) })
    ),
    tx(L.meta_limit, { count: summary.ledger.timeoutMin }),
    cost === null ? L.meta_no_cost : tx(L.meta_cost, { amount: formatUsd(cost) }),
  ].filter(Boolean);

  return (
    <>
      <div className="crumbs">
        <div className="cc">
          <nav className="crumb-path" aria-label={L.crumb_label}>
            <Button variant="ghost" className="crumb" onClick={onBack} data-testid="ledger-crumb-all">
              {L.crumb_all}
            </Button>
            {parent && (
              <>
                <span className="slash">/</span>
                <Tooltip content={parent.title}>
                  <Button variant="ghost" className="crumb" onClick={() => onOpenContest(`${parent.projectId}/${parent.contestId}`)}>
                    {shortTitle(parent.title)}
                  </Button>
                </Tooltip>
              </>
            )}
            <span className="slash">/</span>
            <span className="cur" data-testid="ledger-contest-title">{summary.title}</span>
          </nav>
          <div className="crumb-meta">
            {meta.map((m, i) => (
              <span key={i}>
                {i > 0 && <span className="sep">·</span>}
                {m}
              </span>
            ))}
          </div>
        </div>
        <div className="acts">
          {phase === 'draft' && (
            <AsyncButton
              variant="primary"
              className="cl-btn cl-primary"
              icon={<Play className="w-3.5 h-3.5" />}
              onClick={() => launchContest(projectId, contestId, 'participant').catch(toastCatch('contest:ledger-launch'))}
              data-testid="ledger-launch"
            >
              {L.start}
            </AsyncButton>
          )}
          {live && (
            <Button variant="accent" tone="error" className="cl-btn" icon={<Square className="w-3 h-3" />} onClick={() => setConfirmStop(true)} data-testid="ledger-cancel">
              {L.stop}
            </Button>
          )}
          {phase === 'shortlisted' && kids.length > 0 && (
            <Button
              variant="secondary"
              className="cl-btn"
              icon={<GitBranch className="w-3.5 h-3.5" />}
              onClick={() => onOpenContest(`${kids[kids.length - 1]!.projectId}/${kids[kids.length - 1]!.contestId}`)}
            >
              {tx(L.round_n, { n: kids[kids.length - 1]!.round ?? 2 })}
            </Button>
          )}
          <Button
            variant={phase === 'review' && variants.length ? 'primary' : 'secondary'}
            className={`cl-btn${phase === 'review' && variants.length ? ' cl-primary' : ''}`}
            icon={<Eye className="w-3.5 h-3.5" />}
            disabled={!variants.length}
            onClick={(e) => props.onOpenVariant(props.card, e.currentTarget)}
            data-testid="ledger-open-variant"
          >
            {L.open_variant}
            <Kbd>↵</Kbd>
          </Button>
        </div>
      </div>
      <div className="l2body">
        <aside className="l2left">
          <Dials summary={summary} detail={detail} nowMs={nowMs} s={s} />
          <Schedule summary={summary} nowMs={nowMs} L={L} />
          <Chain summary={summary} detail={detail} s={s} />
          {detail && <Decision summary={summary} detail={detail} draft={draft} s={s} onRefined={(child) => onOpenContest(`${child.projectId}/${child.contestId}`)} />}
        </aside>
        <div className="l2main">
          {detail == null && detailError != null ? (
            <div className="empty-state">
              <AlertTriangle className="ic w-4 h-4" aria-hidden />
              <div>{L.detail_failed}</div>
            </div>
          ) : (
            <>
              <div>
                <div className="sect-h">
                  {L.variants_title}
                  <span className="n">
                    {variants.length > 0
                      ? tx(L.variants_sorted, { count: variants.length, sorted: variants.length - trays(draft.review, variants, summary).unsorted.length })
                      : variants.length}
                  </span>
                  <span className="r">
                    {variants.length > 0 && (isEditable(summary) ? L.bench_hint : lockText(L, s, summary, tx))}
                    {variants.length > 0 && isEditable(summary) && (
                      <>
                        <span className="sep">·</span>
                        <SaveState draft={draft} s={s} />
                      </>
                    )}
                  </span>
                </div>
                {variants.length > 0 ? (
                  <Bench {...props} variants={variants} s={s} />
                ) : detail ? (
                  <EmptyBench summary={summary} nowMs={nowMs} L={L} />
                ) : null}
              </div>
              {detail && <Desk summary={summary} detail={detail} draft={draft} s={s} wide={props.wide} />}
            </>
          )}
        </div>
      </div>
      {confirmStop && (
        <ConfirmDialog
          danger
          title={L.cancel_title}
          body={L.cancel_body}
          confirmLabel={L.cancel_confirm}
          onCancel={() => setConfirmStop(false)}
          onConfirm={async () => {
            await cancelContest(projectId, contestId).catch(toastCatch('contest:ledger-cancel'));
            setConfirmStop(false);
          }}
        />
      )}
    </>
  );
}

export function SaveState({ draft, s }: { draft: ReviewDraft; s: ContestStrings }) {
  const { tx } = useTranslation();
  const label = draft.isSaving || draft.dirty ? s.saving : draft.lastError ? tx(s.save_failed, { message: draft.lastError }) : s.saved;
  return (
    <span className="savest" role="status" data-testid="ledger-save-state">
      {label}
    </span>
  );
}

// ── Seats ─────────────────────────────────────────────────────────────────

function Dials({ summary, detail, nowMs, s }: { summary: ContestSummary; detail: ContestDetail | null; nowMs: number; s: ContestStrings }) {
  const { tx } = useTranslation();
  const L = s.ledger;
  const seats = detail ? participantSeats(detail.seats) : summary.ledger.seats;
  const judges = detail ? detail.seats.filter((x) => x.kind === 'judge') : [];
  const judgeSpecs = judges.length ? judges.map((j) => j.spec) : (detail?.judges ?? []).map((j) => `${j.engine}:${j.model}@${j.effort}${j.label ? `#${j.label}` : ''}`);
  return (
    <div>
      <div className="sect-h">
        {L.seats_title}
        <span className="n">{seats.length}</span>
        <span className="r">{tx(L.seats_each, { count: summary.ledger.timeoutMin })}</span>
      </div>
      <div className="dials">
        {seats.map((seat) => (
          <DialRow key={seat.seatId} seat={seat} summary={summary} detail={detail} nowMs={nowMs} s={s} />
        ))}
      </div>
      {summary.ledger.judgesEnabled && judgeSpecs.length > 0 && (
        <div className="judgeline">
          <span className="lab">{L.judges_title}</span>
          {judgeSpecs.map((spec) => (
            <Seat key={spec} spec={spec} quiet />
          ))}
        </div>
      )}
    </div>
  );
}

function DialRow({ seat, summary, detail, nowMs, s }: { seat: ContestSeat; summary: ContestSummary; detail: ContestDetail | null; nowMs: number; s: ContestStrings }) {
  const { tx } = useTranslation();
  const L = s.ledger;
  const tone = seatColor(seat.state);
  const ran = seat.state !== 'queued' && seat.state !== 'idle';
  const ceiling = ceilingS(summary.ledger);
  const elapsed = seatElapsedS(seat, nowMs);
  const delivered = (detail?.variants ?? summary.ledger.variants).filter((v) => v.seatId === seat.seatId).length;
  const expected = Math.max(summary.variantsPerSeat || 3, delivered);
  const rerunOpen = isRerunnable(seat.state) && canRerun(summary.phase, seat.kind);
  const est = rerunOpen ? seatEstimate(seat.spec, [summary], summary.variantsPerSeat || 3, summary.ledger.timeoutMin) : null;
  const price = est ? (est.cost !== null ? tx(L.price_about, { amount: formatUsd(est.cost) }) : est.reportsCost ? L.price_no_history : L.price_not_reported) : '';
  const costLine = [
    seat.costUsd !== null && ran ? formatUsd(seat.costUsd) : ran ? L.seat_cost_none : null,
    ran && seat.turns !== null ? tx(seat.turns === 1 ? L.seat_turns_one : L.seat_turns_other, { count: seat.turns }) : null,
  ].filter(Boolean);
  return (
    <div className="dialrow" data-testid={`ledger-dial-${seat.seatId}`}>
      <div className="dial">
        <Dial state={seat.state} fraction={ceiling && elapsed !== null ? Math.min(1, elapsed / ceiling) : 0} center={formatDuration(elapsed, false)} got={delivered} expected={expected} tone={tone}
          label={tx(L.dial_label, { state: plainStateLabel(L, seat.state), elapsed: formatDuration(elapsed), limit: formatDuration(ceiling, false) })} />
      </div>
      <div className="dinfo">
        <div className="l1">
          <Seat spec={seat.spec} />
        </div>
        <div className="l2" style={cssVars({ '--t': tone })}>
          <span className="st">{plainStateLabel(L, seat.state)}</span>
        </div>
        <div className="l2">
          <span className="tab">{formatDuration(elapsed)}</span>
          {' / '}
          {formatDuration(ceiling, false)}
        </div>
        {costLine.length > 0 && <div className="l3 tab">{costLine.join(' · ')}</div>}
        {(seat.fleetSessionId || rerunOpen) && (
          <div className="dacts">
            {seat.fleetSessionId && (
              <Button variant="ghost" className="lnk" icon={<Monitor className="w-3.5 h-3.5" />} onClick={() => openSessionInMonitor(seat.fleetSessionId!)}>
                {L.monitor}
              </Button>
            )}
            {rerunOpen && (
              <Tooltip content={tx(L.rerun_tip, { price, count: est?.runs ?? 0 })}>
                <AsyncButton
                  variant="ghost"
                  className="lnk paid"
                  icon={<RotateCcw className="ic w-3.5 h-3.5" />}
                  onClick={() => launchContest(summary.projectId, summary.contestId, seat.kind, [seat.seatId]).catch(toastCatch('contest:ledger-rerun'))}
                  data-testid={`ledger-rerun-${seat.seatId}`}
                >
                  {tx(L.rerun_price, { price })}
                </AsyncButton>
              </Tooltip>
            )}
          </div>
        )}
      </div>
      {seat.errors.length > 0 && (
        <div className="derr">
          {seat.errors.map((e, i) => (
            <div key={i} className="errbox" style={cssVars({ '--t': tone })}>
              {e}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The dial: a ring the length of the time limit, filled to the elapsed time,
 *  with one bead per variant the seat owes (lit when delivered). */
export function Dial({ state, fraction, center, got, expected, tone, label }: {
  state: ContestSeat['state'];
  fraction: number;
  center: string;
  got: number;
  expected: number;
  tone: string;
  label: string;
}) {
  const R = 34;
  const CIRC = 2 * Math.PI * R;
  const running = state === 'running';
  const angle = fraction * 2 * Math.PI - Math.PI / 2;
  const bw = 9;
  const bx0 = 44 - ((expected - 1) * bw) / 2;
  return (
    <svg width="100%" height="100%" viewBox="0 0 88 88" role="img" aria-label={label} style={cssVars({ '--t': tone })}>
      <circle className="ring" cx="44" cy="44" r={R} strokeWidth="5" />
      {fraction > 0 && (
        <circle className="arc" cx="44" cy="44" r={R} strokeWidth="5" strokeDasharray={`${(fraction * CIRC).toFixed(1)} ${CIRC.toFixed(1)}`} transform="rotate(-90 44 44)" />
      )}
      {running && <circle className="head" cx={(44 + R * Math.cos(angle)).toFixed(1)} cy={(44 + R * Math.sin(angle)).toFixed(1)} r="4.2" />}
      {(state === 'queued' || state === 'idle') && <line x1="44" y1="6" x2="44" y2="14" stroke={tone} strokeWidth="2.4" strokeLinecap="round" />}
      <text className="ctr" x="44" y={expected ? 46 : 49} textAnchor="middle">
        {center}
      </text>
      <g>
        {Array.from({ length: expected }).map((_, i) => (
          <circle key={i} className={`bead${i < got ? '' : ' off'}`} cx={bx0 + i * bw} cy="58" r="2.6" style={{ fill: i < got ? tone : 'none' }} />
        ))}
      </g>
    </svg>
  );
}

function Schedule({ summary, nowMs, L }: { summary: ContestSummary; nowMs: number; L: LedgerStrings }) {
  const { language } = useTranslation();
  const start = startOf(summary.ledger, nowMs);
  if (summary.phase !== 'queued' || !start?.upcoming) return null;
  return (
    <div>
      <div className="sect-h">{L.schedule_title}</div>
      <div className="lockline">
        <CalendarClock className="ic w-3.5 h-3.5" aria-hidden />
        <span>
          <Rich template={L.schedule_body} values={{ when: <b>{formatUntil(start.ms, nowMs, language)}</b>, clock: formatClock(start.ms, language) }} />
        </span>
      </div>
    </div>
  );
}

const STATION_MARK: Record<StationStatus, { Icon: typeof Check; tone: string }> = {
  done: { Icon: Check, tone: toneVar('success') },
  active: { Icon: CircleDot, tone: toneVar('processing') },
  pending: { Icon: Circle, tone: toneVar('neutral') },
  skipped: { Icon: Minus, tone: toneVar('neutral') },
  failed: { Icon: X, tone: toneVar('error') },
};

function Chain({ summary, detail, s }: { summary: ContestSummary; detail: ContestDetail | null; s: ContestStrings }) {
  const { tx } = useTranslation();
  const L = s.ledger;
  const chain = detail?.chain ?? summary.ledger.chain;
  const judgesEnabled = detail?.judgesEnabled ?? summary.ledger.judgesEnabled;
  const stations = chainStations(chain, judgesEnabled, summary.phase);
  return (
    <div>
      <div className="sect-h">
        {L.chain_title}
        <span className="r">{chain.step === 'failed' ? L.chain_stopped_word : chain.step === 'ready' ? L.chain_finished : ''}</span>
      </div>
      <div className="chain" data-testid="ledger-chain">
        {stations.map((st) => {
          const { Icon, tone } = STATION_MARK[st.status];
          return (
            <div key={st.id} className={`stn ${st.status}`} style={cssVars({ '--t': tone })} data-status={st.status} data-testid={`ledger-station-${st.id}`}>
              <span className="mk">
                <Icon className="w-[11px] h-[11px]" aria-hidden />
              </span>
              {stationLabel(L, st.id)}
              <span className="sw">{stationStatusLabel(L, st.status)}</span>
            </div>
          );
        })}
      </div>
      {chain.step === 'failed' && (
        <>
          <div className="errbox" style={cssVars({ '--t': toneVar('error') })} data-testid="ledger-chain-reason">
            <b>{L.chain_stopped}.</b> {chain.reason ?? ''}
          </div>
          <div className="retry">
            {retrySteps({ judgesEnabled }).map((step) => (
              <AsyncButton
                key={step}
                variant="secondary"
                size="sm"
                className="cl-btn cl-sm"
                icon={<RotateCcw className="w-3 h-3" />}
                onClick={() => runContestStep(summary.projectId, summary.contestId, step).catch(toastCatch('contest:ledger-retry-step'))}
                data-testid={`ledger-retry-${step}`}
              >
                {tx(L.retry, { step: stepLabel(s, step) })}
              </AsyncButton>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Decision ──────────────────────────────────────────────────────────────

function Decision({ summary, detail, draft, s, onRefined }: {
  summary: ContestSummary;
  detail: ContestDetail;
  draft: ReviewDraft;
  s: ContestStrings;
  onRefined: (child: ContestSummary) => void;
}) {
  const { tx } = useTranslation();
  const L = s.ledger;
  const [confirming, setConfirming] = useState<'winner' | 'refine' | null>(null);
  const [runnerUp, setRunnerUp] = useState('');
  const review = draft.review;
  const phase = summary.phase;
  if (!detail.variants.length && phase !== 'review') return null;
  const lock = lockText(L, s, summary, tx);
  if (phase !== 'review' && phase !== 'shortlisted') {
    return (
      <div>
        <div className="sect-h">{L.decision_title}</div>
        <div className="lockline" data-testid="ledger-decision-locked">
          <Lock className="ic w-3.5 h-3.5" aria-hidden />
          <span>{lock}</span>
        </div>
      </div>
    );
  }
  if (!review) return null;
  const refineOpen = canDecide(phase, 'refine');
  const winnerOpen = canDecide(phase, 'winner');
  const ready = decisionReadiness(review, refineOpen ? summary.shortlist : []);
  const effectiveRunnerUp = ready.shortlist.includes(runnerUp) && runnerUp !== ready.winner ? runnerUp : '';
  const runnerOptions = [{ value: '', label: s.runner_up_none }, ...ready.shortlist.filter((k) => k !== ready.winner).map((k) => ({ value: k, label: tx(L.runner_up_option, { key: k }) }))];
  const deletions = refineDeletions(detail, review);

  const declare = async () => {
    if (!ready.winner) return;
    try {
      await draft.flush();
      const next = await decideContest(summary.projectId, summary.contestId, {
        kind: 'winner',
        winner: ready.winner,
        runnerUp: effectiveRunnerUp || null,
        note: winnerNote(review, ready.winner),
      });
      primeSummary(next);
      useToastStore.getState().addToast(s.decided_winner, 'success');
      setConfirming(null);
    } catch (err) {
      toastCatch('contest:ledger-decide-winner')(err);
    }
  };
  const refine = async () => {
    try {
      await draft.flush();
      const child = await decideContest(summary.projectId, summary.contestId, { kind: 'shortlist', keys: ready.refineKeys, note: review.field });
      primeSummary(child);
      useToastStore.getState().addToast(s.decided_refine, 'success');
      setConfirming(null);
      onRefined(child);
    } catch (err) {
      toastCatch('contest:ledger-decide-refine')(err);
    }
  };

  return (
    <div className="decide" data-testid="ledger-decision">
      <div className="sect-h" style={{ marginBottom: 0 }}>
        {L.decision_title}
        {ready.winner && <span className="r">{tx(L.decision_winner, { key: ready.winner })}</span>}
      </div>
      {phase === 'shortlisted' ? (
        <div className="lockline">
          <Lock className="ic w-3.5 h-3.5" aria-hidden />
          <span>{lock}</span>
        </div>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="hint">{s.runner_up_label}</span>
          <ThemedSelect
            filterable
            hideSearch
            aria-label={s.runner_up_label}
            options={runnerOptions}
            value={effectiveRunnerUp}
            onValueChange={setRunnerUp}
            disabled={!ready.canDeclare || runnerOptions.length < 2}
          />
        </label>
      )}
      <div className="row">
        <Button
          variant="secondary"
          className="cl-btn"
          icon={<GitBranch className="w-3.5 h-3.5" />}
          disabled={!(refineOpen && ready.canRefine)}
          onClick={() => setConfirming('refine')}
          data-testid="ledger-decide-refine"
        >
          {s.decide_refine}
          {ready.refineKeys.length > 0 && ` (${ready.refineKeys.length})`}
        </Button>
        {winnerOpen && (
          <Button
            variant="primary"
            className="cl-btn cl-primary"
            icon={<Trophy className="w-3.5 h-3.5" />}
            disabled={!ready.canDeclare}
            onClick={() => setConfirming('winner')}
            data-testid="ledger-decide-winner"
          >
            {s.decide_winner}
          </Button>
        )}
      </div>
      {phase === 'review' && !ready.canDeclare && (
        <div className="why">
          <AlertTriangle className="ic w-3.5 h-3.5" aria-hidden />
          <span>{s.decide_winner_needs}</span>
        </div>
      )}
      {phase === 'review' && !ready.canRefine && (
        <div className="why">
          <AlertTriangle className="ic w-3.5 h-3.5" aria-hidden />
          <span>{s.decide_refine_needs}</span>
        </div>
      )}
      {confirming === 'winner' && ready.winner && (
        <ConfirmDialog
          title={tx(s.confirm_winner_title, { key: ready.winner })}
          body={[s.confirm_winner_body, effectiveRunnerUp ? tx(s.confirm_winner_runner_up, { key: effectiveRunnerUp }) : ''].filter(Boolean).join(' ')}
          confirmLabel={s.decide_winner}
          onCancel={() => setConfirming(null)}
          onConfirm={declare}
        />
      )}
      {confirming === 'refine' && (
        <ConfirmDialog
          danger={deletions.length > 0}
          title={tx(s.confirm_refine_title, { count: ready.refineKeys.length })}
          body={[s.confirm_refine_body, deletions.length ? tx(s.confirm_refine_deletes, { dirs: deletions.join(', ') }) : s.confirm_refine_keeps].join(' ')}
          confirmLabel={s.decide_refine}
          onCancel={() => setConfirming(null)}
          onConfirm={refine}
        />
      )}
    </div>
  );
}

// ── Bench ─────────────────────────────────────────────────────────────────

function Bench({ summary, draft, card, onCard, onSort, onOpenVariant, cardRefs, detail, variants, s, wide, mainWidth }: ContestLevelProps & { variants: ContestVariant[]; s: ContestStrings }) {
  const { tx, language } = useTranslation();
  const L = s.ledger;
  const editable = isEditable(summary);
  const byTray = trays(draft.review, variants, summary);
  const lists = BENCH_ORDER.map((b) => byTray[b]);
  const layout = benchLayout(lists.map((l) => l.length), mainWidth, wide);
  const byKey = useMemo(() => new Map(variants.map((v) => [v.key, v])), [variants]);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropTray, setDropTray] = useState<BenchTray | null>(null);

  // FLIP: a card that changed trays glides from where it was.
  const prevRects = useRef(new Map<string, DOMRect>());
  const signature = lists.map((l) => l.join(',')).join('|');
  useLayoutEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, DOMRect>();
    cardRefs.current?.forEach((el, key) => {
      const r = el.getBoundingClientRect();
      next.set(key, r);
      const a = prevRects.current.get(key);
      if (reduce || !a) return;
      const dx = a.left - r.left;
      const dy = a.top - r.top;
      const sc = a.width / (r.width || 1);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sc - 1) < 0.01) return;
      el.animate?.([{ transform: `translate(${dx}px, ${dy}px) scale(${sc})`, transformOrigin: '0 0' }, { transform: 'none', transformOrigin: '0 0' }], { duration: 280, easing: 'cubic-bezier(.2,.75,.25,1)' });
    });
    prevRects.current = next;
  }, [signature, cardRefs]);

  return (
    <div className="bench" style={cssVars({ '--cw': `${layout.cardW}px` })} data-testid="ledger-bench">
      {BENCH_ORDER.map((tray, i) => {
        const keys = lists[i]!;
        const bucket = tray === 'unsorted' ? null : tray;
        const color = bucketColor(bucket);
        const label = bucket ? bucketLabel(s, bucket) : s.bucket_none;
        const kk = bucket ? BUCKET_KEY[bucket] : '0';
        const Icon = bucket ? BUCKET_ICON[bucket] : Layers;
        const dropProps = editable
          ? {
              onDragOver: (e: React.DragEvent) => {
                if (!dragKey) return;
                e.preventDefault();
                setDropTray(tray);
              },
              onDragLeave: (e: React.DragEvent) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTray(null);
              },
              onDrop: (e: React.DragEvent) => {
                if (!dragKey) return;
                e.preventDefault();
                onSort(dragKey, bucket);
                onCard(dragKey);
                setDragKey(null);
                setDropTray(null);
              },
            }
          : {};
        if (!keys.length) {
          return (
            <div key={tray} className={`bcol slim${dropTray === tray ? ' drop' : ''}`} style={cssVars({ '--b': color })} aria-label={tx(L.tray_empty, { tray: label })} data-testid={`ledger-tray-${tray}`} {...dropProps}>
              <div className="bh">
                <Icon className="ic w-3.5 h-3.5" aria-hidden />
                <span className="n">0</span>
                <Kbd>{kk}</Kbd>
                <span className="vlabel">{label}</span>
              </div>
            </div>
          );
        }
        return (
          <div key={tray} className={`bcol${dropTray === tray ? ' drop' : ''}`} style={cssVars({ '--b': color })} data-testid={`ledger-tray-${tray}`} {...dropProps}>
            <div className="bh">
              <Icon className="ic w-3.5 h-3.5" aria-hidden />
              {label}
              <span className="n">{keys.length}</span>
              <Kbd>{kk}</Kbd>
            </div>
            <div className="bgrid" style={cssVars({ '--cols': layout.cols[i]! })} role="list" aria-label={label}>
              {keys.map((k) => {
                const v = byKey.get(k)!;
                const vr = draft.review ? variantReview(draft.review, k) : null;
                const b = recordedBucket(draft.review, summary, k);
                const maker = detail?.seats.find((x) => x.seatId === v.seatId)?.spec ?? null;
                return (
                  <div
                    key={k}
                    ref={(el) => {
                      if (el) cardRefs.current?.set(k, el);
                      else cardRefs.current?.delete(k);
                    }}
                    role="listitem"
                    tabIndex={card === k ? 0 : -1}
                    className={`vcard${card === k ? ' focus' : ''}${dragKey === k ? ' dragging' : ''}`}
                    draggable={editable}
                    aria-label={tx(L.card_label, { key: k, name: variantName(v), tray: b ? bucketLabel(s, b) : s.bucket_none })}
                    data-testid={`ledger-card-${k}`}
                    onDragStart={(e) => {
                      setDragKey(k);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', k);
                    }}
                    onDragEnd={() => {
                      setDragKey(null);
                      setDropTray(null);
                    }}
                    onClick={(e) => {
                      if (card === k || e.detail >= 2) onOpenVariant(k, e.currentTarget);
                      else onCard(k);
                    }}
                  >
                    <div className="still">
                      <Still src={stillOf(v.screenshots)} label={k} />
                      {b && <i className="bbar" style={cssVars({ '--b': bucketColor(b) })} />}
                      {vr && vr.pins.length > 0 && (
                        <span className="pinct">
                          <Pin className="w-3 h-3" aria-hidden />
                          {vr.pins.length}
                        </span>
                      )}
                      <span className="size">{formatBytes(v.bytes, language)}</span>
                      {(vr?.note || v.hasNotes) && (
                        <span className="glp">
                          {vr?.note && (
                            <Tooltip content={tx(L.card_note_tip, { note: vr.note })}>
                              <NotebookPen className="w-3 h-3" aria-label={L.card_note_label} />
                            </Tooltip>
                          )}
                          {v.hasNotes && (
                            <Tooltip content={s.variant_has_notes}>
                              <FileText className="w-3 h-3" aria-label={s.variant_has_notes} />
                            </Tooltip>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="meta">
                      <div className="m1">
                        <span className="k">{k}</span> {variantName(v)}
                      </div>
                      <div className="m2">{maker && <Seat spec={maker} />}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyBench({ summary, nowMs, L }: { summary: ContestSummary; nowMs: number; L: LedgerStrings }) {
  const { tx, language } = useTranslation();
  let title: string;
  let body: string;
  switch (summary.phase) {
    case 'queued': {
      const start = startOf(summary.ledger, nowMs);
      title = L.empty_queued_title;
      body = tx(L.empty_queued_body, { clock: formatClock(start?.ms ?? nowMs, language) });
      break;
    }
    case 'failed': title = L.empty_failed_title; body = L.empty_failed_body; break;
    case 'review': title = L.empty_review_title; body = L.empty_review_body; break;
    case 'draft': title = L.empty_draft_title; body = L.empty_draft_body; break;
    default: title = L.empty_live_title; body = L.empty_live_body;
  }
  return (
    <div className="empty-state" data-testid="ledger-bench-empty">
      <Film className="ic w-4 h-4" aria-hidden />
      <div>
        <b>{title}</b>
        {body}
      </div>
    </div>
  );
}

// ── Desk: scores, the whole-field note, the brief ─────────────────────────

function Desk({ summary, detail, draft, s, wide }: { summary: ContestSummary; detail: ContestDetail; draft: ReviewDraft; s: ContestStrings; wide: boolean }) {
  const review = summary.phase === 'review';
  const hasV = detail.variants.length > 0;
  if (review && hasV && detail.scoreboard) {
    return (
      <div className="desk" style={{ gridTemplateColumns: `minmax(0,1fr) ${wide ? 360 : 250}px` }}>
        <Scores detail={detail} s={s} />
        <FieldNote draft={draft} s={s} />
      </div>
    );
  }
  if (review) {
    return (
      <div className="desk" style={{ gridTemplateColumns: `minmax(0,1fr) ${wide ? 380 : 280}px` }}>
        <Brief detail={detail} s={s} />
        <FieldNote draft={draft} s={s} />
      </div>
    );
  }
  return (
    <div className="desk" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
      <Brief detail={detail} s={s} />
    </div>
  );
}

function Scores({ detail, s }: { detail: ContestDetail; s: ContestStrings }) {
  const { tx } = useTranslation();
  const L = s.ledger;
  const sb = detail.scoreboard!;
  const rows = [...sb.rows].sort((a, b) => Number(a.broken) - Number(b.broken) || (b.mean ?? 0) - (a.mean ?? 0));
  const dimLabel = (d: (typeof SCORE_DIMS)[number]) => L.dim[d];
  return (
    <div className="panel" style={{ overflow: 'auto' }} data-testid="ledger-scores">
      <div className="sect-h">
        {L.scores_title}
        <span className="n">{tx(sb.judges.length === 1 ? L.scores_judges_one : L.scores_judges_other, { count: sb.judges.length })}</span>
        <span className="r">{L.scores_hint}</span>
      </div>
      <table className="heat">
        <thead>
          <tr>
            <th>{L.score_variant}</th>
            {SCORE_DIMS.map((d) => (
              <th key={d}>{dimLabel(d)}</th>
            ))}
            <th>{L.score_mean}</th>
            <th>{L.score_spread}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.broken ? 'broken' : ''}>
              <td className="hk">{r.key}</td>
              {SCORE_DIMS.map((d) => (
                <td key={d} style={cssVars({ '--h': `${heatPercent(r.dims[d])}%` })}>
                  {formatCount(r.dims[d])}
                </td>
              ))}
              <td className="hm" style={cssVars({ '--h': `${heatPercent(r.mean)}%` })}>
                {formatCount(r.mean, { precision: 1 })}
              </td>
              <td className="hb">
                {r.broken ? (
                  <span className="chip" style={cssVars({ '--c': 'var(--status-error)' })}>{L.score_broken}</span>
                ) : r.spread !== null && r.spread >= 3 ? (
                  <Tooltip content={tx(L.score_split_tip, { spread: r.spread })}>
                    <span className="chip" style={cssVars({ '--c': 'var(--status-warning)' })}>{tx(L.score_split, { spread: r.spread })}</span>
                  </Tooltip>
                ) : (
                  <span className="mu">{r.spread ?? '—'}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FieldNote({ draft, s, rows }: { draft: ReviewDraft; s: ContestStrings; rows?: number }) {
  const L = s.ledger;
  return (
    <div className="panel">
      <div className="sect-h">
        {L.field_note_title}
        <span className="r">
          <SaveState draft={draft} s={s} />
        </span>
      </div>
      <textarea
        className="ta"
        rows={rows}
        value={draft.review?.field ?? ''}
        placeholder={s.field_note_placeholder}
        aria-label={s.field_note_label}
        onChange={(e) => {
          const field = e.target.value;
          draft.apply((r) => ({ ...r, field }));
        }}
        data-testid="ledger-field-note"
      />
    </div>
  );
}

function Brief({ detail, s }: { detail: ContestDetail; s: ContestStrings }) {
  const { tx, language } = useTranslation();
  const L = s.ledger;
  const words = detail.brief.split(/\s+/).filter(Boolean).length;
  return (
    <div className="panel">
      <div className="sect-h">
        {L.brief_title}
        <span className="n">{tx(L.brief_words, { count: words.toLocaleString(language) })}</span>
        <span className="r">{L.brief_hint}</span>
      </div>
      <MarkdownRenderer content={detail.brief} className="brief" />
    </div>
  );
}
