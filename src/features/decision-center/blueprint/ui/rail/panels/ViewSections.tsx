// The View workbench's lower sections (bp src/components/rail/wide/view.tsx, the window's reading and Health): what
// changed in the window, newest first, each flying to its feature; and the plan's health figures from the store.
// EDIT (port): bp's agent figures (working, waiting, blocked, failed, paused) come from its swarm; here they are the
// store's own: runs going, findings waiting, approved and not built.
import { useSheet } from '../../../controller/SheetContext';
import { stageWord } from '../../../controller/useBlueprintText';
import type { Feature, Stage } from '../../../standard/load';
import { HealthSpecimen, PinSpecimen, StageSwatch } from '../../legend/Specimens';
import { DeltaMark } from '../../legend/Symbols';
import { Press } from '../../Press';
import { Fig } from './shell';

export function ViewChanged({ rows }: { rows: readonly { f: Feature; r: { stage: Stage; date: string } }[] }) {
  const s = useSheet();
  const { B, tx } = s.text;
  if (!rows.length) return <p className="none">{B.view_none_changed}</p>;
  return (
    <ul className="wb-chg" aria-label={B.view_changed}>
      {rows.map(({ f, r }) => {
        const T = s.plan.L.TILE[f.id];
        return (
          <li key={f.id}>
            <Press onClick={() => s.nav.flyToFeature(f.id)}>
              <StageSwatch st={r.stage} w={22} h={14} />
              <span className="tx"><small>{T ? T.wing.def.name + ' · ' + T.room.d.name : f.domain}</small>{f.name}</span>
              <span><time dateTime={r.date}>{r.date}</time><small className="wb-meta">{' · '}{tx(B.view_became, { stage: stageWord(B, r.stage) })}</small></span>
            </Press>
          </li>
        );
      })}
    </ul>
  );
}

export function ViewHealth({ changed }: { changed: number }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const fs = s.plan.S.features;
  const bad = fs.filter((f) => f.health === 'bad').length, watch = fs.filter((f) => f.health === 'watch').length;
  const waiting = s.work.items.filter((p) => p.status === 'proposed').length, approved = s.work.items.filter((p) => p.status === 'approved').length;
  return (
    <div className="wb-figs big">
      <Fig n={bad} label={<><HealthSpecimen k="cloud" /> {B.view_h_trouble}</>} tone={bad ? 'red' : undefined} />
      <Fig n={watch} label={<><HealthSpecimen k="tick" /> {B.view_h_watch}</>} tone={watch ? 'amber' : undefined} />
      <Fig n={changed} label={<><DeltaMark /> {tx(B.view_h_changed, { days: s.ui.viewDays })}</>} />
      <Fig n={waiting} label={<><PinSpecimen state="med" /> {B.view_h_waiting}</>} tone={waiting ? 'amber' : undefined} />
      <Fig n={approved} label={<><PinSpecimen state="ok" /> {B.view_h_approved}</>} tone={approved ? 'mint' : undefined} />
      <Fig n={s.work.activeRuns} label={B.view_h_runs} tone={s.work.activeRuns ? 'mint' : undefined} />
    </div>
  );
}
