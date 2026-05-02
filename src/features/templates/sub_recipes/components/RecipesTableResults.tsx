import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown, Sparkles } from 'lucide-react';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { useTranslation } from '@/i18n/useTranslation';
import { EligibilityChip } from './EligibilityChip';
import type { Recipe, Eligibility } from '../types';

interface ResultsProps {
  recipes: Recipe[];
  eligibilityMap: Map<string, Eligibility>;
  onOpenDetail: (recipeId: string) => void;
}

type SortKey = 'name' | 'category' | 'bindings' | 'version' | 'eligibility';
type SortDir = 'asc' | 'desc';

const ELIGIBILITY_RANK: Record<Eligibility['state'], number> = {
  eligible: 0,
  'adoptable-with-setup': 1,
  incompatible: 2,
};

/**
 * Variant A — Table.
 *
 * Mental model: spreadsheet of recipes. Maximal readability across columns
 * at the cost of card-style visual richness. One line per recipe; fields
 * truncate with ellipsis; sticky header keeps column context as you scroll.
 *
 * Sort by any column header (name / category / bindings count / version /
 * eligibility). Active column shows up/down chevron; inactive columns
 * show a subtle two-arrow hint on hover.
 *
 * Action affordance: an "Adopt" button reveals on row hover at the right.
 * Clicking the button adopts; clicking the row opens detail. Both stop
 * at the right place.
 */
export function RecipesTableResults({ recipes, eligibilityMap, onOpenDetail }: ResultsProps) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'name', dir: 'asc' });

  const sorted = useMemo(() => {
    const list = [...recipes];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sort.key) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'category':
          cmp = a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
          break;
        case 'bindings':
          cmp = a.bindings.length - b.bindings.length;
          if (cmp === 0) cmp = a.name.localeCompare(b.name);
          break;
        case 'version':
          cmp = a.version.localeCompare(b.version);
          if (cmp === 0) cmp = a.name.localeCompare(b.name);
          break;
        case 'eligibility': {
          const ea = eligibilityMap.get(a.id);
          const eb = eligibilityMap.get(b.id);
          cmp = (ea ? ELIGIBILITY_RANK[ea.state] : 99) - (eb ? ELIGIBILITY_RANK[eb.state] : 99);
          if (cmp === 0) cmp = a.name.localeCompare(b.name);
          break;
        }
      }
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [recipes, sort, eligibilityMap]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'eligibility' ? 'asc' : 'asc' });
  };

  return (
    <div className="rounded-card border border-card-border bg-secondary/15 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-secondary/85 backdrop-blur-sm">
            <tr className="border-b border-card-border/60">
              <Th className="w-10 pl-3" />
              <Th sortable active={sort.key === 'name'} dir={sort.dir} onClick={() => toggleSort('name')}>
                {t.recipes_catalog.col_recipe}
              </Th>
              <Th
                sortable
                active={sort.key === 'category'}
                dir={sort.dir}
                onClick={() => toggleSort('category')}
                className="w-32"
              >
                {t.recipes_catalog.col_category}
              </Th>
              <Th
                sortable
                active={sort.key === 'bindings'}
                dir={sort.dir}
                onClick={() => toggleSort('bindings')}
                className="w-24 text-right"
              >
                {t.recipes_catalog.col_bindings}
              </Th>
              <Th
                sortable
                active={sort.key === 'version'}
                dir={sort.dir}
                onClick={() => toggleSort('version')}
                className="w-20 text-right"
              >
                {t.recipes_catalog.col_version}
              </Th>
              <Th
                sortable
                active={sort.key === 'eligibility'}
                dir={sort.dir}
                onClick={() => toggleSort('eligibility')}
                className="w-32"
              >
                {t.recipes_catalog.col_eligibility}
              </Th>
              <Th className="w-24 pr-3" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <RecipeRow
                key={r.id}
                recipe={r}
                eligibility={eligibilityMap.get(r.id) ?? { state: 'eligible' }}
                onOpenDetail={() => onOpenDetail(r.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface ThProps {
  children?: React.ReactNode;
  className?: string;
  sortable?: boolean;
  active?: boolean;
  dir?: SortDir;
  onClick?: () => void;
}

function Th({ children, className = '', sortable, active, dir, onClick }: ThProps) {
  const base = 'group h-9 px-2 text-left typo-label uppercase tracking-wider text-foreground/65 font-medium select-none';
  if (!sortable) {
    return <th className={`${base} ${className}`}>{children}</th>;
  }
  return (
    <th className={`${base} ${className}`}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
          active ? 'text-foreground' : 'hover:text-foreground'
        }`}
      >
        {children}
        {active ? (
          dir === 'asc'
            ? <ChevronUp className="w-3 h-3" />
            : <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronsUpDown className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
        )}
      </button>
    </th>
  );
}

interface RecipeRowProps {
  recipe: Recipe;
  eligibility: Eligibility;
  onOpenDetail: () => void;
}

function RecipeRow({ recipe, eligibility, onOpenDetail }: RecipeRowProps) {
  const { t } = useTranslation();
  const iconKey = recipe.iconConnector ?? recipe.requiredConnectors[0] ?? null;
  const iconMeta = iconKey ? getConnectorMeta(iconKey) : null;
  const incompatible = eligibility.state === 'incompatible';

  return (
    <tr
      onClick={onOpenDetail}
      className={`group h-10 border-b border-card-border/30 last:border-b-0 transition-colors cursor-pointer ${
        incompatible ? 'opacity-65 hover:bg-secondary/30' : 'hover:bg-secondary/40'
      }`}
    >
      {/* Connector icon */}
      <td className="pl-3 align-middle">
        {iconMeta && (
          <span
            className="inline-flex items-center justify-center rounded shrink-0"
            style={{
              width: 26, height: 26,
              background: `${iconMeta.color}1f`,
              border: `1px solid ${iconMeta.color}4d`,
            }}
            title={iconMeta.label}
          >
            <ConnectorIcon meta={iconMeta} size="w-3.5 h-3.5" />
          </span>
        )}
      </td>

      {/* Name — summary moved to row tooltip / detail view */}
      <td className="px-2 align-middle" title={recipe.summary}>
        <div className="typo-caption font-medium text-foreground truncate min-w-0 max-w-[420px]">
          {recipe.name}
        </div>
      </td>

      {/* Category */}
      <td className="px-2 align-middle">
        <span className="typo-label uppercase tracking-wider text-foreground/75 truncate">
          {recipe.category.replace(/-/g, ' ')}
        </span>
      </td>

      {/* Bindings count */}
      <td className="px-2 align-middle text-right">
        <span className="typo-data font-mono text-foreground/85">
          {recipe.bindings.length}
        </span>
      </td>

      {/* Version */}
      <td className="px-2 align-middle text-right">
        <span className="typo-caption font-mono text-foreground/55">
          v{recipe.version}
        </span>
      </td>

      {/* Eligibility */}
      <td className="px-2 align-middle">
        <EligibilityChip eligibility={eligibility} />
      </td>

      {/* Adopt button — hover-revealed */}
      <td className="pr-3 align-middle text-right">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenDetail(); }}
          disabled={incompatible}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-interactive border typo-label uppercase tracking-wider transition-all cursor-pointer ${
            incompatible
              ? 'border-card-border bg-secondary/40 text-foreground/45 opacity-0'
              : 'border-primary/35 bg-primary/12 text-primary opacity-0 group-hover:opacity-100 hover:bg-primary/22'
          }`}
        >
          <Sparkles className="w-3 h-3" />
          {t.recipes_catalog.adopt_button}
        </button>
      </td>
    </tr>
  );
}
