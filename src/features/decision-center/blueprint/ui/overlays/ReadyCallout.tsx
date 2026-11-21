// PORTED from bp apps/web/src/components/Overlays.tsx @ 93f30b0 (Callout, the readiness branch; bp.css #callout.ga):
// readiness for what G read. The scope's kind and name, the summary line (model/ready readinessLine, long form), then
// the rows bp lists: steps to clear with their coverage, blocked lenses with why, cross-lens conflicts, unproven
// features with the lens's last reading and its age. Each row opens its feature on that lens. Close is G (or Esc).
// EDIT (port): the verdict is the sheet's (`sync.readiness`, controller/useSyncModels); the words are t.*
// (controller/readyWords). bp's milestone rows (done, partly open, blocked by, done but unsafe, the swarm) are out:
// Personas has no milestone scope (WP2). Shown on the plan only, never over an open feature page.
import '../../styles/overlays.css';
import { useSheet } from '../../controller/SheetContext';
import { conflictText, coverWord, readyBlockText, readyLineText, stepText } from '../../controller/readyWords';
import { readinessLine } from '../../model/ready';
import type { ReadyScope } from '../../model/readyScope';
import { fmtDay } from '../timeline/dates';
import { Press } from '../Press';

const CAP = 8;

interface Row { key: string; fid: string; lens?: string; tail: string }

export function ReadyCallout() {
  const s = useSheet(), text = s.text, { B, tx, language } = text, r = s.sync.readiness;
  if (!r || s.ui.sheet || s.ui.page !== 'plan') return null;
  const { scope, result: R } = r, P = s.plan, name = (id: string) => P.LENS[id]?.name ?? id;
  const steps: Row[] = [], blocked: Row[] = [], conflicts: Row[] = [], old: Row[] = [];
  for (const fr of R.features) {
    for (const l of fr.lenses) {
      if (l.kind === 'steps') l.steps.forEach((st, i) => { const x = P.LENS[l.lens]?.F[st.step.field]; steps.push({ key: fr.id + l.lens + i, fid: fr.id, lens: l.lens, tail: name(l.lens) + ': ' + stepText(text, x, st.step) + ' · ' + coverWord(text, x, st.cover) }); });
      else if (l.kind === 'blocked') blocked.push({ key: fr.id + l.lens, fid: fr.id, lens: l.lens, tail: readyBlockText(text, name(l.lens), l.why) });
    }
    fr.conflicts.forEach((c, i) => conflicts.push({ key: fr.id + i, fid: fr.id, tail: conflictText(text, P.LENS, c) }));
    if (fr.kind === 'unproven') {
      const ls = fr.lenses.flatMap((l) => (l.kind === 'unproven' ? [l.newest ? tx(B.sync_ready_read, { lens: name(l.lens), date: fmtDay(language, l.newest), days: l.ageDays ?? 0 }) : tx(B.sync_ready_never, { lens: name(l.lens) })] : []));
      old.push({ key: fr.id, fid: fr.id, tail: ls.join(', ') });
    }
  }
  const open = (row: Row) => s.nav.openSheet(row.fid, row.lens);
  const list = (head: string, rows: Row[]) => (rows.length ? (
    <>
      <div className="sub">{head}</div>
      {rows.slice(0, CAP).map((row) => (
        <Press key={row.key} tone="lnk" onClick={() => open(row)}>{P.L.TILE[row.fid]?.f.name ?? row.fid} <span className="dim">{'·'} {row.tail}</span></Press>
      ))}
      {rows.length > CAP ? <div className="row"><span>{tx(B.sync_ready_more, { count: rows.length - CAP })}</span></div> : null}
    </>
  ) : null);
  return (
    <div className="bp-callout ga" role="region" aria-label={B.sync_ready_label} data-testid="blueprint-ready-callout">
      <Press tone="x" onClick={s.sync.toggleReady}>{B.sync_ready_close}</Press>
      <h4>{tx(B.sync_ready_head, { scope: scopeWord(text.B, scope) })}</h4>
      <div className="big">{scopeLabel(text, scope)}</div>
      <p className="ready-line">{readyLineText(text, readinessLine(R, true))}</p>
      {list(tx(B.sync_ready_steps, { count: steps.length }), steps)}
      {list(B.sync_ready_blocked, blocked)}
      {list(B.sync_ready_conflicts, conflicts)}
      {list(tx(B.sync_ready_unproven, { days: R.maxAgeDays }), old)}
    </div>
  );
}

function scopeWord(B: ReturnType<typeof useSheet>['text']['B'], sc: ReadyScope): string {
  return { selection: B.sync_scope_selection, feature: B.sync_scope_feature, room: B.sync_scope_room, wing: B.sync_scope_wing, site: B.sync_scope_site }[sc.kind];
}

/** What the callout names (bp's `label`): the feature or place, "Wing B · Money", "3 selected", the building. */
function scopeLabel({ B, tx }: ReturnType<typeof useSheet>['text'], sc: ReadyScope): string {
  const l = sc.label;
  if (sc.kind === 'selection' && l.n > 1) return tx(B.sync_ready_selected, { count: l.n });
  if (sc.kind === 'wing' || sc.kind === 'room') return tx(sc.kind === 'wing' ? B.sync_ready_wing_name : B.sync_ready_room_name, { name: l.name, letter: l.letter ?? '' });
  return l.name;
}
