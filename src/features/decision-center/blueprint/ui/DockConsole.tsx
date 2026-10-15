import { useSheet } from '../controller/SheetContext';
import type { ConsoleLine } from '../state/uiState';
import type { BpText } from '../controller/useBlueprintText';
import { isTriageReason, type TriageReason } from '../model/states';

type Tx = ReturnType<typeof useSheet>['text']['tx'];

const REASON_KEY = {
  'note-required': 'reason_note_required', 'in-release': 'reason_in_release', 'no-prior-status': 'reason_no_prior_status',
  rebuilt: 'reason_rebuilt', 'pack-closed': 'reason_pack_closed',
} as const satisfies Record<TriageReason, keyof BpText>;

/** A skipped row as the store gave it (id, status, reason verbatim), then the reason in words when it is a known one. */
function Skipped({ k, B, tx }: { k: { id: string; status: string; reason?: string }; B: BpText; tx: Tx }) {
  return (
    <div className="bp-skip" data-testid="blueprint-skipped" data-reason={k.reason}>
      {tx(B.console_skipped, { id: k.id, status: k.status })}{k.reason ? ` · ${k.reason}` : ''}
      {isTriageReason(k.reason) ? <span className="bp-why"> {'·'} {B[REASON_KEY[k.reason]]}</span> : null}
    </div>
  );
}

/** A triage answer (store.mjs `triage`), verbatim: the decision and who, the ids moved, each skipped row with its
 *  reason, and the packs the move triaged or reopened. */
function TriageEntry({ line, B, tx, old }: { line: Extract<ConsoleLine, { kind: 'triage' }>; B: BpText; tx: Tx; old?: boolean }) {
  const r = line.result;
  return (
    <div className={`bp-entry${old ? ' bp-old' : ''}`} data-testid="blueprint-triage-result">
      <div className={`bp-cmd typo-code${old ? ' bp-old' : ''}`}>
        {tx(B.console_decide, { decision: r.decision, by: r.by })}
        {r.triaged.length > 0 && <div>{tx(B.console_triaged, { ids: r.triaged.join(', ') })}</div>}
        {r.skipped.map((k) => <Skipped key={k.id} k={k} B={B} tx={tx} />)}
        {r.packs_triaged.length > 0 && <div>{tx(B.console_packs_triaged, { ids: r.packs_triaged.join(', ') })}</div>}
        {r.packs_reopened && r.packs_reopened.length > 0 && <div>{tx(B.console_packs_reopened, { ids: r.packs_reopened.join(', ') })}</div>}
      </div>
      {!old && line.note && <div className="bp-why typo-body">{tx(B.console_note, { note: line.note })}</div>}
    </div>
  );
}

/** One console entry, exactly as the store answered: ids decided, each skipped row with its status and reason, the command started. */
function Entry({ line, B, tx, old }: { line: ConsoleLine; B: BpText; tx: Tx; old?: boolean }) {
  if (line.kind === 'failed') {
    const verb = line.verb === 'decide' ? B.verb_decide : line.verb === 'triage' ? B.verb_triage : B.verb_build;
    return <div className={`bp-cmd bp-fail${old ? ' bp-old' : ''}`}>{tx(B.console_failed, { verb, message: line.message })}</div>;
  }
  if (line.kind === 'triage') return <TriageEntry line={line} B={B} tx={tx} old={old} />;
  if (line.kind === 'start') {
    return (
      <div className={`bp-entry${old ? ' bp-old' : ''}`}>
        <div className={`bp-cmd typo-code${old ? ' bp-old' : ''}`} data-testid="blueprint-command">{line.result.command}</div>
        <div className="bp-why typo-body">{tx(B.console_started, { lens: line.lens, label: line.result.label, pid: line.result.pid })}</div>
      </div>
    );
  }
  const r = line.result;
  return (
    <div className={`bp-entry${old ? ' bp-old' : ''}`} data-testid="blueprint-decide-result">
      <div className={`bp-cmd typo-code${old ? ' bp-old' : ''}`}>
        {tx(B.console_decide, { decision: r.decision, by: r.by })}
        {r.decided.length > 0 && <div>{tx(B.console_decided, { ids: r.decided.join(', ') })}</div>}
        {r.skipped.map((k) => <Skipped key={k.id} k={k} B={B} tx={tx} />)}
      </div>
      {!old && line.note && <div className="bp-why typo-body">{tx(B.console_note, { note: line.note })}</div>}
    </div>
  );
}

/**
 * The dock console: every write, printed under the queue (never over the plan) the way the store answered it. An
 * armed build shows the jobs it would start, one per lens; B or Enter starts them, Esc disarms. Earlier entries sit
 * behind a disclosure so nothing printed is lost.
 */
export function DockConsole() {
  const s = useSheet();
  const { B, tx } = s.text;
  const { armed, lines, busy } = s.ui;
  if (!armed && !lines.length) return null;
  if (armed) {
    const by = new Map<string, string[]>();
    for (const id of armed) { const p = s.work.byId.get(id); if (p) by.set(p.lens, [...(by.get(p.lens) ?? []), id]); }
    return (
      <section className="bp-dock bp-armed" aria-label={B.console} data-testid="blueprint-armed">
        <div className="bp-dk-top typo-eyebrow"><span>{B.armed_title}</span><span>{tx(B.armed_counts, { items: armed.length, jobs: by.size })}</span></div>
        {[...by].map(([lens, ids]) => <div key={lens} className="bp-cmd typo-code">{tx(B.armed_job, { lens: s.plan.LENS[lens]?.short ?? lens, ids: ids.join(', ') })}</div>)}
        <div className="bp-why typo-body">{B.armed_hint}</div>
      </section>
    );
  }
  const [last, ...older] = lines;
  return (
    <section className="bp-dock" aria-label={B.console} aria-busy={busy} data-testid="blueprint-dock">
      <div className="bp-dk-top typo-eyebrow"><span>{busy ? B.console_sending : B.console_title}</span><span>{tx(B.console_count, { count: lines.length })}</span></div>
      {last && <Entry line={last} B={B} tx={tx} />}
      {older.length > 0 && (
        <details className="bp-older">
          <summary className="typo-eyebrow">{tx(B.console_earlier, { count: older.length })}</summary>
          {older.slice(0, 7).map((l) => <Entry key={l.key} line={l} B={B} tx={tx} old />)}
        </details>
      )}
    </section>
  );
}
