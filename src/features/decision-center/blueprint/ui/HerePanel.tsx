import { useSheet } from '../controller/SheetContext';
import { useViewLevel } from '../state/viewStore';
import { Press } from './Press';
import { placeName } from './QueueList';

const LEVELS = [0, 1, 2, 3, 4] as const;

/**
 * The "Here" block (bp title block, in the workbench strip's ink): the level, the name of the place the camera is over, what waits there, and the
 * depth rail, the same five levels as the plan's level bar and just as clickable. It reads the engine's level through
 * the view store, so it can never show L3 while the plan shows the site (the prototype's host defect 4).
 */
export function HerePanel() {
  const s = useSheet();
  const { B, tx } = s.text;
  const lv = useViewLevel(s.view);
  const n = s.ui.sheet ? 4 : lv.n;
  const names = [B.level_site, B.level_wing, B.level_room, B.level_bay, B.level_feature];
  const waiting = s.queue.filter((p) => p.status === 'proposed').length;
  const approved = s.queue.length - waiting;
  const packItems = s.work.packFlow ? s.work.items.filter((p) => p.pack && p.status === 'done' && (!s.scope.feats || s.scope.feats.has(p.fid))).length : 0;
  const all = s.queueAll.filter((p) => p.status === 'proposed').length;
  const lensShort = s.plan.LENS[s.ui.lens]?.short ?? '';
  const place = placeName(s);
  return (
    <section className="bp-here" aria-label={B.here}>
      <div className="bp-kick">{tx(B.here_level, { level: tx(B.level_n, { n, name: names[n] ?? '' }) })}</div>
      <div className="bp-ht"><span className="bp-hn">{place}</span><span className="bp-hc">{waiting}</span></div>
      <p className="bp-hd2">
        {s.ui.lens === 'general' ? tx(B.here_line, { waiting, all, product: s.data.product.name }) : tx(B.here_line_lens, { waiting, all, lens: lensShort, product: s.data.product.name })}
        {approved > 0 ? ` · ${tx(B.here_approved, { count: approved })}` : ''}
        {packItems > 0 ? ` · ${tx(B.here_pack, { count: packItems })}` : ''}
      </p>
      <div className="bp-depth" role="toolbar" aria-label={B.depth}>
        {LEVELS.map((i) => (
          <Press key={i} tone={i < n ? 'bp-past' : undefined} current={i === n} onClick={() => s.nav.toLevel(i)} data-level={i}>
            {`L${i}`}
          </Press>
        ))}
      </div>
    </section>
  );
}
