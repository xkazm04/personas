/**
 * Explore level 2 — the chosen direction: a sub-domain pre-filter + a dense,
 * sortable, type-to-filter table of a domain's templates AND recipes. Solves the
 * "impossible to orient" volume problem: narrow by focus (category), scan a
 * compact table, sort by any column. PROTOTYPE: hardcoded English.
 */
import { useMemo, useState } from 'react';
import { FileStack, Blocks, Search, ChevronUp, ChevronDown } from 'lucide-react';
import { categoryLabel } from '../exploreDomains';
import { recipesForTemplate, type ExploreItem, type ExploreRecipe } from '../useExploreCatalog';

interface Row {
  kind: 'template' | 'recipe';
  id: string; name: string; category: string;
  tools: number; recipes: number;
  item?: ExploreItem; recipe?: ExploreRecipe;
}
type SortCol = 'name' | 'kind' | 'category' | 'tools' | 'recipes';

interface Props {
  templates: ExploreItem[];
  recipes: ExploreRecipe[];
  accent: string;
  onSelect?: (i: ExploreItem) => void;
  onSelectRecipe?: (r: ExploreRecipe) => void;
}

export function DomainTable({ templates, recipes, accent, onSelect, onSelectRecipe }: Props) {
  const [cat, setCat] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ col: SortCol; dir: 1 | -1 }>({ col: 'recipes', dir: -1 });

  const allRows = useMemo<Row[]>(() => [
    ...templates.map((t): Row => ({ kind: 'template', id: t.id, name: t.name, category: t.category, tools: t.serviceFlow.length, recipes: recipesForTemplate(t.id).length, item: t })),
    ...recipes.map((r): Row => ({ kind: 'recipe', id: r.id, name: r.name, category: r.category, tools: r.toolCount, recipes: 0, recipe: r })),
  ], [templates, recipes]);

  const cats = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of allRows) m[r.category] = (m[r.category] ?? 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [allRows]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = allRows.filter((r) => (!cat || r.category === cat) && (!q || r.name.toLowerCase().includes(q)));
    const { col, dir } = sort;
    return filtered.sort((a, b) => {
      const av = a[col], bv = b[col];
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return cmp * dir;
    });
  }, [allRows, cat, query, sort]);

  const toggleSort = (col: SortCol) =>
    setSort((s) => (s.col === col ? { col, dir: (s.dir * -1) as 1 | -1 } : { col, dir: col === 'name' || col === 'category' ? 1 : -1 }));

  const clickRow = (r: Row) => (r.kind === 'template' ? r.item && onSelect?.(r.item) : r.recipe && onSelectRecipe?.(r.recipe));

  return (
    <div className="space-y-3">
      {/* Sub-domain pre-filter + search */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip label="All" count={allRows.length} active={cat === null} accent={accent} onClick={() => setCat(null)} />
        {cats.map(([c, n]) => (
          <FilterChip key={c} label={categoryLabel(c)} count={n} active={cat === c} accent={accent} onClick={() => setCat(c)} />
        ))}
        <div className="ml-auto relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground opacity-50" />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name…"
            className="pl-8 pr-3 py-1.5 rounded-input bg-background/50 border border-primary/10 typo-body text-foreground w-52 focus:outline-none focus:border-primary/30"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-modal border border-primary/10">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-primary/10">
              <Th col="name" label="Name" sort={sort} onSort={toggleSort} className="text-left" />
              <Th col="kind" label="Type" sort={sort} onSort={toggleSort} />
              <Th col="category" label="Focus" sort={sort} onSort={toggleSort} className="text-left" />
              <Th col="tools" label="Tools" sort={sort} onSort={toggleSort} />
              <Th col="recipes" label="Capabilities" sort={sort} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.kind}-${r.id}`} onClick={() => clickRow(r)}
                className="border-b border-primary/5 last:border-0 hover:bg-secondary/20 cursor-pointer">
                <td className="px-3 py-2 typo-body template-name-themed">{r.name}</td>
                <td className="px-3 py-2 text-center">
                  <span className="inline-flex items-center gap-1 typo-caption text-foreground opacity-70">
                    {r.kind === 'template' ? <FileStack className="w-3 h-3" /> : <Blocks className="w-3 h-3" />}
                    {r.kind === 'template' ? 'Template' : 'Recipe'}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="typo-caption px-1.5 py-0.5 rounded-input" style={{ color: accent, backgroundColor: `${accent}18` }}>{categoryLabel(r.category)}</span>
                </td>
                <td className="px-3 py-2 text-center typo-data text-foreground opacity-80">{r.tools || '–'}</td>
                <td className="px-3 py-2 text-center typo-data text-foreground opacity-80">{r.kind === 'template' ? (r.recipes || '–') : '–'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center typo-body text-foreground opacity-60">No matches.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="typo-caption text-foreground opacity-55">{rows.length} of {allRows.length} shown</div>
    </div>
  );
}

function FilterChip({ label, count, active, accent, onClick }: {
  label: string; count: number; active: boolean; accent: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-input typo-caption transition-colors ${active ? '' : 'text-foreground opacity-70 hover:opacity-100'}`}
      style={active ? { backgroundColor: `${accent}22`, color: accent } : undefined}>
      {label}<span className="opacity-60">{count}</span>
    </button>
  );
}

function Th({ col, label, sort, onSort, className = 'text-center' }: {
  col: SortCol; label: string; sort: { col: SortCol; dir: 1 | -1 }; onSort: (c: SortCol) => void; className?: string;
}) {
  const on = sort.col === col;
  return (
    <th className={`px-3 py-2 ${className}`}>
      <button onClick={() => onSort(col)} className={`inline-flex items-center gap-1 typo-label ${on ? 'text-foreground' : 'text-foreground opacity-55 hover:opacity-80'}`}>
        {label}
        {on && (sort.dir === 1 ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </button>
    </th>
  );
}
