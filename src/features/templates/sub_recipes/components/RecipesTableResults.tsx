import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ArrowUpCircle, Check, Sparkles } from 'lucide-react';
import { ConnectorIcon, getConnectorMeta } from '@/lib/connectors/connectorMeta';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useEndReached } from '@/hooks/utility/interaction/useEndReached';
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
  /** Recipe ids the selected persona has already adopted (provenance via
   *  DesignUseCase.source_recipe_id) — rows get an "Adopted" chip. */
  adoptedRecipeIds: ReadonlySet<string>;
  /** Adopted recipe ids whose catalog version moved ahead of the pinned
   *  adoption version — the "Adopted" chip becomes an "Update" chip. */
  staleRecipeIds: ReadonlySet<string>;
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
 * Rows revealed per page. The catalog is held in memory by `pipelineStore`, so
 * a "page" here bounds what reaches the DOM, not what reaches the process: at
 * 1000+ recipes the row tree — six cells each, several of them icon/tooltip
 * subtrees — is the cost that matters, and mounting it all on first paint is
 * what makes the table janky. Successive pages append as the user scrolls
 * (`useEndReached`), so the DOM grows only as far as someone actually looks.
 */
const PAGE_SIZE = 20;

/** Stable fallback so a row with no eligibility entry keeps a stable prop
 *  identity across renders — a fresh `{ state: 'eligible' }` literal per render
 *  would defeat `memo` on every such row. */
const DEFAULT_ELIGIBILITY: Eligibility = { state: 'eligible' };

/**
 * Variant A — Table.
 *
 * Mental model: spreadsheet of recipes. Maximal readability across columns
 * at the cost of card-style visual richness. One line per recipe; fields
 * truncate with ellipsis; sticky header keeps column context as you scroll.
 *
 * Sort by any column header (name / category / bindings count / version /
 * eligibility). Active column shows an up/down arrow; inactive columns show a
 * subtle two-way arrow on hover. Header chrome (tokens, typography, the arrow
 * set, `aria-sort`) mirrors `shared/components/display/UnifiedTable` so the
 * catalog reads as the same system as every other list surface in the app.
 *
 * Action affordance: an "Adopt" button reveals on row hover at the right.
 * Clicking the button adopts; clicking the row opens detail. Both stop
 * at the right place.
 *
 * ── Scrolling ──────────────────────────────────────────────────────────────
 * This component owns its vertical scroller. That is load-bearing, not
 * cosmetic: `position: sticky` resolves against the nearest scrollport, so
 * while the scroller lived in the parent and the table sat inside an
 * `overflow-hidden` card, the "sticky" header was pinned to a box that never
 * scrolled and silently did nothing. The scroller also anchors `useEndReached`.
 */
export function RecipesTableResults({ recipes, eligibilityMap, highlight, personaSelected, adoptedRecipeIds, staleRecipeIds, onOpenDetail }: ResultsProps) {
  const { t, tx } = useTranslation();
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'name', dir: 'asc' });
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const scrollRef = useRef<HTMLDivElement>(null);

  // One collator for the whole sort instead of `String.prototype.localeCompare`
  // per comparison — the latter re-resolves locale data on every call, which is
  // the dominant cost of an n·log n sort once n reaches four digits. `numeric`
  // also fixes version ordering: lexically "v10.0.0" sorts before "v9.0.0".
  const collator = useMemo(() => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }), []);

  const sorted = useMemo(() => {
    const byName = (a: Recipe, b: Recipe) => collator.compare(a.name, b.name);
    const list = [...recipes];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sort.key) {
        case 'name':
          cmp = byName(a, b);
          break;
        case 'category':
          cmp = collator.compare(a.category, b.category) || byName(a, b);
          break;
        case 'connectors':
          cmp = a.requiredConnectors.length - b.requiredConnectors.length || byName(a, b);
          break;
        case 'version':
          cmp = collator.compare(a.version, b.version) || byName(a, b);
          break;
        case 'eligibility': {
          const ea = eligibilityMap.get(a.id);
          const eb = eligibilityMap.get(b.id);
          cmp = (ea ? ELIGIBILITY_RANK[ea.state] : 99) - (eb ? ELIGIBILITY_RANK[eb.state] : 99);
          if (cmp === 0) cmp = byName(a, b);
          break;
        }
      }
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [recipes, sort, eligibilityMap, collator]);

  // Any change to what is being listed (a filter narrowed the set, a different
  // column now orders it) makes the current window meaningless — start over at
  // page 1 rather than leaving the user 200 rows deep in a list they just
  // replaced. Keyed on identity + length, both cheap.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    // Assign rather than `scrollTo` — same effect, and it doesn't depend on a
    // method jsdom leaves unimplemented, so this stays testable.
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [recipes, sort]);

  const hasMore = visibleCount < sorted.length;
  // `visibleCount` is in the dep list deliberately: a NEW callback identity each
  // page makes `useEndReached` re-attach, and re-attaching re-runs its
  // bottom-check. That is what lets a container too tall for one page keep
  // pulling pages until it actually overflows — with a stable identity it would
  // fire once and then sit there un-scrollable with rows still unshown.
  // Termination is `hasMore`: at the end the callback becomes `undefined`, which
  // the hook treats as "stop watching", so a fully-revealed table costs nothing.
  const loadMore = useCallback(() => {
    setVisibleCount(Math.min(visibleCount + PAGE_SIZE, sorted.length));
  }, [visibleCount, sorted.length]);
  useEndReached(scrollRef, hasMore ? loadMore : undefined);

  const visible = useMemo(() => sorted.slice(0, visibleCount), [sorted, visibleCount]);

  const toggleSort = useCallback((key: SortKey) => {
    setSort((prev) => (prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' }));
  }, []);

  return (
    <div
      className="rounded-card border border-primary/10 bg-secondary/15 overflow-hidden flex flex-col min-h-0 h-full"
      data-testid="recipes-table"
    >
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto scrollbar-thin">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm">
            <tr className="border-b border-primary/10">
              <Th className="w-10 pl-3" srLabel={t.recipes_catalog.col_icon} />
              <Th sortKey="name" sort={sort} onSort={toggleSort}>
                {t.recipes_catalog.col_recipe}
              </Th>
              <Th sortKey="category" sort={sort} onSort={toggleSort} className="w-36">
                {t.recipes_catalog.col_category}
              </Th>
              <Th sortKey="connectors" sort={sort} onSort={toggleSort} className="w-28">
                {t.recipes_catalog.col_connectors}
              </Th>
              <Th sortKey="version" sort={sort} onSort={toggleSort} className="w-20" align="right">
                {t.recipes_catalog.col_version}
              </Th>
              <Th sortKey="eligibility" sort={sort} onSort={toggleSort} className="w-32">
                {t.recipes_catalog.col_eligibility}
              </Th>
              <Th className="w-24 pr-3" srLabel={t.recipes_catalog.col_actions} />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <RecipeRow
                key={r.id}
                recipe={r}
                eligibility={eligibilityMap.get(r.id) ?? DEFAULT_ELIGIBILITY}
                highlight={highlight}
                personaSelected={personaSelected}
                adopted={adoptedRecipeIds.has(r.id)}
                stale={staleRecipeIds.has(r.id)}
                onOpenDetail={onOpenDetail}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Count footer. Doubles as the infinite-scroll status: `aria-live` means
          a screen-reader user hears the list grow instead of silently landing
          on more rows than were announced. */}
      <div
        className="flex-shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 border-t border-primary/10 bg-background/60"
        data-testid="recipes-table-footer"
      >
        <span className="typo-label text-foreground tabular-nums" aria-live="polite">
          {tx(t.recipes_catalog.showing_count, { shown: visible.length, total: sorted.length })}
        </span>
        {hasMore && (
          <span className="typo-label text-foreground">{t.recipes_catalog.load_more_status}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header cell
// ---------------------------------------------------------------------------

interface ThProps {
  children?: React.ReactNode;
  className?: string;
  align?: 'left' | 'right';
  /** Accessible name for a column whose header is visually empty (icon, actions). */
  srLabel?: string;
  /** Present on sortable columns only. */
  sortKey?: SortKey;
  sort?: { key: SortKey; dir: SortDir };
  onSort?: (key: SortKey) => void;
}

/**
 * Column header.
 *
 * Typography note: the weight lives in `typo-label` alone. A `font-medium`
 * utility used to sit beside it here, which does nothing — `typo-*` tokens ship
 * as UNLAYERED css and every tier declares its own `font-weight`, so a layered
 * Tailwind weight utility is discarded by the cascade. The header was
 * advertising a weight it never rendered.
 */
function Th({ children, className = '', align = 'left', srLabel, sortKey, sort, onSort }: ThProps) {
  const { t, tx } = useTranslation();
  const base = `group h-9 px-2 typo-label text-foreground select-none ${align === 'right' ? 'text-right' : 'text-left'}`;

  if (!sortKey || !sort || !onSort) {
    return (
      <th scope="col" className={`${base} ${className}`}>
        {srLabel ? <span className="sr-only">{srLabel}</span> : children}
      </th>
    );
  }

  const active = sort.key === sortKey;
  const label = typeof children === 'string' ? children : sortKey;
  return (
    <th
      scope="col"
      className={`${base} ${className}`}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={tx(t.recipes_catalog.sort_by, { label })}
        className={`inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
          align === 'right' ? 'justify-end w-full' : ''
        } ${active ? 'text-foreground' : 'text-foreground hover:text-primary'}`}
      >
        {children}
        {active ? (
          sort.dir === 'asc'
            ? <ArrowUp className="w-3 h-3 text-primary" />
            : <ArrowDown className="w-3 h-3 text-primary" />
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
        )}
      </button>
    </th>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface RecipeRowProps {
  recipe: Recipe;
  eligibility: Eligibility;
  highlight?: string;
  personaSelected: boolean;
  adopted: boolean;
  stale: boolean;
  onOpenDetail: (recipeId: string) => void;
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

/**
 * One catalog row.
 *
 * `memo` is what keeps a long list cheap: paging in the next 20 rows, or any
 * parent re-render (hover state, a filter chip count ticking over), would
 * otherwise re-render every row already on screen. Every prop is a primitive,
 * a stable set, or — for `onOpenDetail` — a callback the parent owns and does
 * not rebuild per row, which is why the row takes the recipe id and calls up
 * rather than receiving a pre-bound closure.
 */
const RecipeRow = memo(function RecipeRow({ recipe, eligibility, highlight, personaSelected, adopted, stale, onOpenDetail }: RecipeRowProps) {
  const { t } = useTranslation();
  const iconKey = recipe.iconConnector ?? recipe.requiredConnectors[0] ?? null;
  const iconMeta = iconKey ? getConnectorMeta(iconKey) : null;
  const incompatible = personaSelected && eligibility.state === 'incompatible';
  const shownConnectors = recipe.requiredConnectors.slice(0, 3);
  const overflowConnectors = recipe.requiredConnectors.slice(3);

  return (
    <tr
      onClick={() => onOpenDetail(recipe.id)}
      data-testid={`recipe-row-${recipe.slug}`}
      className={`group h-10 border-b border-primary/10 last:border-b-0 transition-colors cursor-pointer ${
        incompatible ? 'opacity-65 hover:bg-primary/[0.08]' : 'hover:bg-primary/[0.12]'
      }`}
    >
      {/* Connector icon */}
      <td className="pl-3 align-middle">
        {iconMeta && (
          <Tooltip content={iconMeta.label}>
            <span
              className="inline-flex items-center justify-center rounded shrink-0"
              style={{
                width: 26, height: 26,
                background: `${iconMeta.color}1f`,
                border: `1px solid ${iconMeta.color}4d`,
              }}
            >
              <ConnectorIcon meta={iconMeta} size="w-3.5 h-3.5" />
            </span>
          </Tooltip>
        )}
      </td>

      {/* Name — summary moved to row tooltip / detail view */}
      <td className="px-2 align-middle">
        <div className="flex items-center gap-1.5 min-w-0 max-w-[420px]">
          <Tooltip content={recipe.summary}>
            <span className="typo-caption text-foreground truncate min-w-0">
              <HighlightedName text={recipe.name} query={highlight} />
            </span>
          </Tooltip>
          {adopted && stale ? (
            <Tooltip content={t.recipes_catalog.update_badge_tooltip}>
              <span className="inline-flex items-center gap-0.5 shrink-0 typo-label px-1 py-0.5 rounded border border-status-warning/40 bg-status-warning/10 text-status-warning">
                <ArrowUpCircle className="w-2.5 h-2.5" />
                {t.recipes_catalog.update_badge}
              </span>
            </Tooltip>
          ) : adopted ? (
            <Tooltip content={t.recipes_catalog.adopted_badge_tooltip}>
              <span className="inline-flex items-center gap-0.5 shrink-0 typo-label px-1 py-0.5 rounded border border-status-success/35 bg-status-success/10 text-status-success">
                <Check className="w-2.5 h-2.5" />
                {t.recipes_catalog.adopted_badge}
              </span>
            </Tooltip>
          ) : null}
        </div>
      </td>

      {/* Category */}
      <td className="px-2 align-middle">
        <span className="inline-flex typo-label px-1.5 py-0.5 rounded border border-primary/10 bg-secondary/40 text-foreground whitespace-nowrap">
          {categoryLabel(t, recipe.category)}
        </span>
      </td>

      {/* Required connectors — icon strip, replaces the always-zero bindings count */}
      <td className="px-2 align-middle">
        <span className="inline-flex items-center gap-1">
          {shownConnectors.map((slug) => {
            const m = getConnectorMeta(slug);
            return (
              <Tooltip key={slug} content={m.label}>
                <span
                  className="inline-flex items-center justify-center w-5 h-5 rounded border bg-secondary/40 shrink-0"
                  style={{ borderColor: `${m.color}4d` }}
                >
                  <ConnectorIcon meta={m} size="w-3 h-3" />
                </span>
              </Tooltip>
            );
          })}
          {overflowConnectors.length > 0 && (
            <Tooltip content={overflowConnectors.map((slug) => getConnectorMeta(slug).label).join(', ')}>
              <span className="typo-label font-mono text-foreground">
                +{overflowConnectors.length}
              </span>
            </Tooltip>
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
          onClick={(e) => { e.stopPropagation(); onOpenDetail(recipe.id); }}
          disabled={incompatible}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-interactive border typo-label transition-all cursor-pointer ${
            incompatible
              ? 'border-primary/10 bg-secondary/40 text-foreground opacity-0'
              : 'border-primary/35 bg-primary/12 text-primary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-primary/22'
          }`}
        >
          <Sparkles className="w-3 h-3" />
          {t.recipes_catalog.adopt_button}
        </button>
      </td>
    </tr>
  );
});
