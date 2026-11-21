// PORTED from bp apps/web/src/components/sheet/LensPanel.tsx @ 93f30b0 (ClearSteps, CoverChip): "What clears it" under
// a lens tab's health. Every matching rule worse than the default as one verified step (field: now -> target, and the
// health it clears), from the manifest's own rules (standard/clear clearPath), and the margin to the next worse health
// when the reading is not already the worst. Under an override it is what the rules alone ask for. At now only.
// EDIT (port): the words are t.* (controller/readyWords). Each step a proposal covers carries its chip
// (standard/cover coverStep: clears / short by X / makes it worse, or "measured X after: cleared" for a built item);
// an uncovered step has no chip (bp prints "no proposal": the WP3 brief keeps the list quiet). The proposals are the
// sheet's scan (`data.scan.proposals`); bp's phone `limit` is not brought (the page has no phone form).
import { useSheet } from '../../controller/SheetContext';
import { blockText, clearsText, coverChip, stepText, worseText } from '../../controller/readyWords';
import { baseId } from '../../model/timeview';
import { clearPath } from '../../standard/clear';
import { coverStep } from '../../standard/cover';
import type { Feature, LensDef } from '../../standard/load';

export function ClearSteps({ f, d }: { f: Feature; d: LensDef }) {
  const s = useSheet(), text = s.text, { B } = text, fl = f.lens[d.id];
  if (!fl || !(fl.h === 'good' || fl.h === 'watch' || fl.h === 'bad')) return null;
  const cp = clearPath(d.manifest, fl.v), proposals = s.data.scan.proposals, at = { feature: baseId(f.id), lens: d.id };
  const wf = !fl.ov && fl.h !== 'bad' && cp.worse ? d.F[cp.worse.field] : undefined;
  if (!cp.steps.length && !cp.blocked && !wf) return null;
  return (
    <div className="pg-clrs" data-testid="blueprint-clear-steps">
      {cp.steps.length || cp.blocked ? <h4>{fl.ov ? B.sync_clr_head_ov : B.sync_clr_head}</h4> : null}
      {cp.steps.length ? (
        <ol className="pg-clr">
          {cp.steps.map((st, i) => {
            const x = d.F[st.field], chip = coverChip(text, x, coverStep(st, proposals, fl.v, d.manifest, at));
            return (
              <li key={i}>
                {stepText(text, x, st)}<em className={st.rule}>{clearsText(text, st.rule)}</em>
                {chip ? <span className={'cov ' + chip.tone} data-testid="blueprint-cover-chip">{chip.text}</span> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      {cp.blocked ? <p className="blk">{blockText(text, cp.blocked)}</p> : null}
      {wf && cp.worse ? <p className="wrs">{worseText(text, wf, cp.worse)}</p> : null}
    </div>
  );
}
