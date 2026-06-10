import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown, Sparkles } from 'lucide-react';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { categoryLabel } from '../libs/categoryLabels';
import { EligibilityChip } from './EligibilityChip';
import type { Recipe, Eligibility } from '../types';

interface ResultsProps {
  recipes: Recipe[];
  eligibilityMap: Map<string, Eligibility>;
  /** Active search query — matching substrings in the name column light up. */
  highlight?: string;
  /** Eligibility is a per-persona verdict; without a selected persona the
   *  chips would claim READY/LOCKED against nothing — render neutral. */
  personaSelected: boolean;
  onOpenDetail: (recipeId: string) => void;
}

type SortKey = 'name' | 'category' | 'connectors' | 'version' | 'eligibility';
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
export function RecipesTableResults({ recipes, eligibilityMap, highlight, personaSelected, onOpenDetail }: ResultsProps) {
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
        case 'connectors':
          cmp = a.requiredConnectors.length - b.requiredConnectors.length;
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
    <div className="rounded-card border border-card-border bg-secondary/15 overflow-hidden" data-testid="recipes-table">
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
                className="w-36"
              >
                {t.recipes_catalog.col_category}
              </Th>
              <Th
                sortable
                active={sort.key === 'connectors'}
                dir={sort.dir}
                onClick={() => toggleSort('connectors')}
                className="w-28"
              >
                {t.recipes_catalog.col_connectors}
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
                highlight={highlight}
                personaSelected={personaSelected}
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
  const base = 'group h-9 px-2 text-left typo-label uppercase tracking-wider text-foreground font-medium select-none';
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
  highlight?: string;
  personaSelected: boolean;
  onOpenDetail: () => void;
}

/** Case-insensitive first-match emphasis for the active search query. */
function HighlightedName({ text, query }: { text: string; query?: string }) {
  const q = query?.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-primary/25 text-foreground rounded-interactive px-0.5 -mx-0.5">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function RecipeRow({ recipe, eligibility, highlight, personaSelected, onOpenDetail }: RecipeRowProps) {
  const { t } = useTranslation();
  const iconKey = recipe.iconConnector ?? recipe.requiredConnectors[0] ?? null;
  const iconMeta = iconKey ? getConnectorMeta(iconKey) : null;
  const incompatible = personaSelected && eligibility.state === 'incompatible';

  return (
    <tr
      onClick={onOpenDetail}
      data-testid={`recipe-row-${recipe.slug}`}
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
          <HighlightedName text={recipe.name} query={highlight} />
        </div>
      </td>

      {/* Category */}
      <td className="px-2 align-middle">
        <span className="inline-flex typo-label uppercase tracking-wider px-1.5 py-0.5 rounded border border-card-border/60 bg-secondary/40 text-foreground whitespace-nowrap">
          {categoryLabel(t, recipe.category)}
        </span>
      </td>

      {/* Required connectors — icon strip, replaces the always-zero bindings count */}
      <td className="px-2 align-middle">
        <span className="inline-flex items-center gap-1">
          {recipe.requiredConnectors.slice(0, 3).map((slug) => {
            const m = getConnectorMeta(slug);
            return (
              <span
                key={slug}
                className="inline-flex items-center justify-center w-5 h-5 rounded border bg-secondary/40 shrink-0"
                style={{ borderColor: `${m.color}4d` }}
                title={m.label}
              >
                <ConnectorIcon meta={m} size="w-3 h-3" />
              </span>
            );
          })}
          {recipe.requiredConnectors.length > 3 && (
            <span className="typo-label font-mono text-foreground">
              +{recipe.requiredConnectors.length - 3}
            </span>
          )}
        </span>
      </td>

      {/* Version */}
      <td className="px-2 align-middle text-right">
        <span className="typo-caption font-mono text-foreground">
          v{recipe.version}
        </span>
      </td>

      {/* Eligibility — neutral dash until a persona gives the verdict meaning */}
      <td className="px-2 align-middle">
        {personaSelected ? (
          <EligibilityChip eligibility={eligibility} />
        ) : (
          <Tooltip content={t.recipes_catalog.eligibility_no_persona}>
            <span className="typo-caption text-foreground" aria-label={t.recipes_catalog.eligibility_no_persona}>
              —
            </span>
          </Tooltip>
        )}
      </td>

      {/* Adopt button — hover-revealed */}
      <td className="pr-3 align-middle text-right">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenDetail(); }}
          disabled={incompatible}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-interactive border typo-label uppercase tracking-wider transition-all cursor-pointer ${
            incompatible
              ? 'border-card-border bg-secondary/40 text-foreground opacity-0'
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
