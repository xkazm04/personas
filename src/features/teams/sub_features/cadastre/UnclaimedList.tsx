// The `u` mode of the register: the ground no feature claims, grouped by
// district, largest first. `j` `k` walk it and light each parcel on the map.
//
// The winner offered "Draft" on each context, which created a one-parcel
// feature in memory. The product has no door that creates a feature from this
// page, so each row offers the one that exists: open it in the Context Map,
// where features are declared. Nothing is invented here.
import type { ContextCell, TFeatures } from '../featuresModel';

export function unclaimedDomId(id: string): string {
  return `cad-o-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

export interface UnclaimedListProps {
  cells: ContextCell[];
  groupName: (id: string) => string;
  focus: string | null;
  onFocus: (id: string) => void;
  onHover: (id: string | null) => void;
  onOpenContext: () => void;
  query: string;
  t: TFeatures;
  tx: (template: string, vars: Record<string, string | number>) => string;
}

export function UnclaimedList({ cells, groupName, focus, onFocus, onHover, onOpenContext, query, t, tx }: UnclaimedListProps) {
  if (cells.length === 0) return <div className="empty">{tx(t.cadastre_no_unclaimed_match, { query })}</div>;
  const byGroup = new Map<string, ContextCell[]>();
  for (const c of cells) {
    const g = c.context.groupId ?? '';
    const list = byGroup.get(g);
    if (list) list.push(c);
    else byGroup.set(g, [c]);
  }
  const groups = [...byGroup.entries()].sort((a, b) => b[1].length - a[1].length || groupName(a[0]).localeCompare(groupName(b[0])));
  return (
    <>
      {groups.map(([g, list]) => [
        <div key={`g-${g}`} className="grp g-open" role="presentation" data-role="cad-group">
          {groupName(g)}
          <span className="n">{list.length}</span>
        </div>,
        ...list.map((c) => (
          <div
            key={c.context.id}
            id={unclaimedDomId(c.context.id)}
            className={`og-i${focus === c.context.id ? ' is-focus' : ''}`}
            role="option"
            aria-selected={focus === c.context.id}
            data-testid="cad-unclaimed"
            data-ctx={c.context.id}
            onClick={() => onFocus(c.context.id)}
            onMouseEnter={() => onHover(c.context.id)}
            onMouseLeave={() => onHover(null)}
          >
            <i className="sw f-open" aria-hidden="true" />
            <span className="cn">{c.context.name}</span>
            <button type="button" className="btn sm" onClick={(e) => { e.stopPropagation(); onOpenContext(); }}>
              {t.open_in_context_map}
            </button>
          </div>
        )),
      ])}
    </>
  );
}
