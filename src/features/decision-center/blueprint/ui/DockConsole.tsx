import { useSheet } from '../controller/SheetContext';
import type { ConsoleLine } from '../state/uiState';
import type { BpText } from '../controller/useBlueprintText';

type Tx = ReturnType<typeof useSheet>['text']['tx'];

/** One console entry, exactly as the store answered: ids decided, each skipped row with its status and reason, the command started. */
function Entry({ line, B, tx, old }: { line: ConsoleLine; B: BpText; tx: Tx; old?: boolean }) {
  if (line.kind === 'failed') {
    return <div className={`bp-cmd bp-fail${old ? ' bp-old' : ''}`}>{tx(B.console_failed, { verb: line.verb === 'decide' ? B.verb_decide : B.verb_build, message: line.message })}</div>;
  }
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
        {r.skipped.map((k) => <div key={k.id} className="bp-skip">{tx(B.console_skipped, { id: k.id, status: k.status })}{k.reason ? ` · ${k.reason}` : ''}</div>)}
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
