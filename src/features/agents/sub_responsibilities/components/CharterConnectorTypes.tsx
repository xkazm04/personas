import { useMemo } from 'react';
import { Link2, Link2Off } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { connectorCategoryTags, connectorsInCategory } from '@/lib/credentials/builtinConnectors';
import type { CharterConnectorBinding } from '@/lib/personas/recipeV3';

/** `bound` = covered now; `unbound` = the catalog can cover it; `uncovered` = nothing can. */
export type TypeState = 'bound' | 'unbound' | 'uncovered';

export interface ResolvedRole {
  /** The role's name. Equals the type in the common case, where a type is its own role. */
  role: string;
  type: string;
  bound: string[];
  state: TypeState;
  /** True when this row came from a declared role rather than a bare type. */
  named: boolean;
}

const covers = (id: string, type: string) => {
  const bare = id.startsWith('builtin-') ? id.slice('builtin-'.length) : id;
  return connectorCategoryTags(id).includes(type) || connectorCategoryTags(bare).includes(type);
};

/**
 * Resolve what a charter needs against what it has AND against the catalog,
 * because those are three different questions with three different answers.
 *
 * Two input shapes, one output. `connectorBindings` (per role, from the 2026-09-06
 * roles amendment) wins when present, because a recipe can need two connectors of
 * the same type in different roles and a flat type list cannot say that. Without
 * it, each type is its own single role named by the type, which is every
 * pre-amendment charter and stays the common case.
 *
 * The three-state result is the honest one. Measured against the catalog on
 * 2026-09-06: a type can have MANY candidates (`analytics`), exactly ONE
 * (`support`), or NONE AT ALL (`legal` - the catalog carries no e-signature or
 * contract connector). Collapsing the last into "not bound" tells the operator to
 * bind something that does not exist.
 *
 * What this deliberately does NOT claim: that a bound connector can DO what the
 * charter needs. The catalog carries almost no capability data (measured: one
 * connector in 134 declares an inbound event), so a capability check here would be
 * a green light with nothing behind it. It stays unverified, and says so.
 */
export function resolveRoles(
  types: string[] | undefined,
  bindings: CharterConnectorBinding[] | undefined,
  connectors: string[],
): ResolvedRole[] {
  const rows = bindings?.length
    ? bindings.map((b) => ({
      role: b.role,
      type: b.connectorType,
      named: true,
      // A role resolved at adoption names its connector; the flat list is only
      // consulted for the unresolved ones, where it is the best evidence there is.
      bound: b.connector ? [b.connector] : connectors.filter((id) => covers(id, b.connectorType)),
    }))
    : (types ?? []).map((type) => ({
      role: type,
      type,
      named: false,
      bound: connectors.filter((id) => covers(id, type)),
    }));

  return rows.map((r) => ({
    ...r,
    state: r.bound.length > 0
      ? 'bound'
      : (connectorsInCategory(r.type).length > 0 ? 'unbound' : 'uncovered'),
  }));
}

interface CharterConnectorTypesProps {
  types?: string[];
  bindings?: CharterConnectorBinding[];
  /** The charter's flat bound-connector list, kept for readers that predate roles. */
  connectors: string[];
}

/** The Connectors block of a charter's Recipe card. Renders `null` when there is nothing real to say. */
export function CharterConnectorTypes({ types, bindings, connectors }: CharterConnectorTypesProps) {
  const { t } = useTranslation();
  const c = t.agents.responsibilities;
  const rows = useMemo(() => resolveRoles(types, bindings, connectors), [types, bindings, connectors]);

  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <span className="typo-label text-foreground">{c.recipe_connectors_label}</span>
      <ul className="flex flex-col gap-1.5 list-none m-0 p-0">
        {rows.map(({ role, type, bound, state, named }) => (
          <li
            key={role}
            className="flex items-center gap-2 flex-wrap"
            data-testid={`resp-connector-type-${type}`}
            data-role={role}
            data-state={state}
          >
            {named && <span className="typo-caption text-foreground">{role}</span>}
            <StatusBadge size="sm" accent="slate" className="font-mono">{type}</StatusBadge>
            {state === 'bound' && (
              <span className="inline-flex items-center gap-1.5 flex-wrap">
                <Link2 aria-hidden className="w-3 h-3 text-status-success shrink-0" />
                {bound.map((id) => (
                  <StatusBadge key={id} size="sm" variant="success">{id}</StatusBadge>
                ))}
              </span>
            )}
            {state === 'unbound' && (
              <span className="inline-flex items-center gap-1.5">
                <Link2Off aria-hidden className="w-3 h-3 text-status-neutral shrink-0" />
                <span className="typo-caption text-foreground">{c.recipe_connector_unbound}</span>
              </span>
            )}
            {state === 'uncovered' && (
              <span className="inline-flex items-center gap-1.5">
                <Link2Off aria-hidden className="w-3 h-3 text-status-warning shrink-0" />
                <span className="typo-caption text-status-warning">{c.recipe_connector_uncovered}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      {rows.some((r) => r.state === 'unbound') && (
        <p className="typo-caption text-foreground">{c.recipe_connector_unbound_hint}</p>
      )}
      {rows.some((r) => r.state === 'uncovered') && (
        <p className="typo-caption text-foreground">{c.recipe_connector_uncovered_hint}</p>
      )}
      {rows.some((r) => r.state === 'bound') && (
        <p className="typo-caption text-foreground">{c.recipe_connector_capability_unverified}</p>
      )}
    </section>
  );
}
