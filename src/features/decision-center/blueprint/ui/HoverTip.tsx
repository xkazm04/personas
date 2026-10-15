import { useSheet } from '../controller/SheetContext';
import { stageWord } from '../controller/useBlueprintText';
import type { TipStore } from '../state/tipStore';
import { useTip } from '../state/tipStore';

/** The hover card (bp Overlays): the feature under the pointer, its stage, the lens that flagged it, what waits on it. */
export function HoverTip({ store }: { store: TipStore }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const tip = useTip(store);
  if (!tip) return null;
  const T = tip.fid ? s.plan.L.TILE[tip.fid] : undefined;
  const cluster = tip.flag && tip.flag.fids.length > 1;
  const W = s.engine?.cam;
  const left = Math.max(8, Math.min(tip.px + 16, (W?.FW ?? 800) - 360)), top = Math.max(8, Math.min(tip.py + 16, (W?.FH ?? 600) - 120));
  if (cluster && tip.flag) {
    const names = [...new Set(tip.flag.lenses.map((l) => s.plan.LENS[l]?.short ?? l))].join(', ');
    return (
      <div className="bp-tip" style={{ left, top }} role="tooltip">
        {tx(B.tip_cluster, { count: tip.flag.fids.length })}
        <div className="bp-s">{names} {'·'} {B.tip_split}</div>
      </div>
    );
  }
  if (!T) return null;
  const f = T.f, waiting = (s.work.byFeature.get(f.id) ?? []).filter((p) => p.status === 'proposed').length;
  const fl = tip.flag ? f.lens[tip.flag.lens] : null;
  return (
    <div className="bp-tip" style={{ left, top }} role="tooltip">
      {f.name}
      <div className="bp-s">{f.stage ? stageWord(B, f.stage) : B.not_drawn} {'·'} {T.bay.cap.code} {T.bay.cap.name}</div>
      {fl && tip.flag && <div className="bp-s">{s.plan.LENS[tip.flag.lens]?.name}: {fl.why}</div>}
      {waiting > 0 && <div className="bp-w">{tx(B.tip_waiting, { count: waiting })}</div>}
    </div>
  );
}
