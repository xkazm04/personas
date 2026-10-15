import { useEffect, useRef } from 'react';
import { useSheet } from '../controller/SheetContext';
import { stageWord } from '../controller/useBlueprintText';
import type { Feature } from '../standard/load';
import type { WorkItem } from '../model/work';
import { QueueItem } from './QueueItem';

function BayTag({ f, right }: { f: Feature; right: string }) {
  const s = useSheet();
  const T = s.plan.L.TILE[f.id];
  return (
    <div className="bp-btag typo-code">
      <span className="bp-c">{T?.bay.cap.code ?? ''}</span><span className="bp-n typo-body">{f.name}</span><span className="bp-c">{right}</span>
    </div>
  );
}

/**
 * The queue itself: waiting and approved work in the current scope, grouped by feature under a bay tag (the plan's
 * own label), plus, for a store that builds packs, the built items waiting in their pack. The current row is kept in
 * view as the walk moves.
 */
export function QueueList() {
  const s = useSheet();
  const { B, tx } = s.text;
  const list = useRef<HTMLDivElement>(null);
  const packs = s.work.packFlow ? s.work.items.filter((p) => p.pack && p.status === 'done' && (!s.scope.feats || s.scope.feats.has(p.fid))) : [];
  const groups: { f: Feature; ps: WorkItem[] }[] = [];
  for (const p of s.queue) {
    const g = groups[groups.length - 1];
    if (g && g.f === p.f) g.ps.push(p); else groups.push({ f: p.f, ps: [p] });
  }
  useEffect(() => { list.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' }); }, [s.ui.itemId]);
  const waiting = s.queue.filter((p) => p.status === 'proposed').length;
  return (
    <div className="bp-list" ref={list} id="bp-queue-list">
      {packs.length > 0 && (
        <>
          <div className="bp-grp"><span className="typo-eyebrow">{tx(B.pack, { id: packs[0]?.pack ?? '' })}</span><span className="typo-eyebrow">{tx(B.pack_built, { count: packs.length })}</span></div>
          {packs.map((p) => <div key={p.id}><BayTag f={p.f} right={p.f.stage ? stageWord(B, p.f.stage) : ''} /><QueueItem p={p} /></div>)}
          <div className="bp-grp"><span className="typo-eyebrow">{B.waiting}</span><span className="typo-eyebrow">{waiting}</span></div>
        </>
      )}
      {groups.length === 0 && <p className="bp-empty typo-body">{tx(B.queue_empty, { place: placeName(s) })}</p>}
      {groups.map((g) => (
        <div key={g.f.id}>
          <BayTag f={g.f} right={g.f.stage ? stageWord(B, g.f.stage).toUpperCase() : ''} />
          {g.ps.map((p) => <QueueItem key={p.id} p={p} />)}
        </div>
      ))}
    </div>
  );
}

/** The name of the place a scope is over, for the queue's sentences. */
export function placeName(s: ReturnType<typeof useSheet>): string {
  const { B } = s.text;
  const L = s.plan.L;
  if (s.scope.kind === 'feature') return L.TILE[s.scope.id]?.f.name ?? '';
  if (s.scope.kind === 'bay') return L.BAY[s.scope.id]?.cap.name ?? '';
  if (s.scope.kind === 'room') return L.ROOM[s.scope.id]?.d.name ?? '';
  if (s.scope.kind === 'wing') { const W = L.WING[s.scope.id]; return W ? `${W.def.letter} ${W.def.name}` : ''; }
  return B.whole_site;
}
