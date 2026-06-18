import { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Globe, FolderOpen, User, Minus, AlertTriangle, Search, X } from 'lucide-react';
import { listPersonas, resolveEffectiveConfigBulk } from '@/api/agents/personas';
import type { Persona } from '@/lib/bindings/Persona';
import type { EffectiveModelConfig } from '@/lib/bindings/EffectiveModelConfig';
import type { ConfigSource } from '@/lib/bindings/ConfigSource';
import type { ConfigField } from '@/lib/bindings/ConfigField';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Effective model-config resolution table for every persona (global → workspace
 * → agent cascade). Lives under the All-Personas page as the "Configuration"
 * tab. Cells read "--" with a source badge when a tier doesn't supply that
 * field — that's the accurate state for personas that inherit the CLI default
 * (per-capability model tiering lives on use-cases, not persona-level config).
 */

const SOURCE_ICON: Record<ConfigSource, typeof Globe> = {
  agent: User,
  workspace: FolderOpen,
  global: Globe,
  default: Minus,
};

type SourceLabelKey = 'source_agent_label' | 'source_workspace_label' | 'source_global_label' | 'source_default_label';

const SOURCE_STYLE: Record<ConfigSource, { color: string; bg: string; labelKey: SourceLabelKey }> = {
  agent:     { color: 'text-violet-400',            bg: 'bg-violet-500/10',  labelKey: 'source_agent_label' },
  workspace: { color: 'text-blue-400',              bg: 'bg-blue-500/10',    labelKey: 'source_workspace_label' },
  global:    { color: 'text-emerald-400',           bg: 'bg-emerald-500/10', labelKey: 'source_global_label' },
  default:   { color: 'text-foreground',            bg: 'bg-secondary/30',   labelKey: 'source_default_label' },
};

function SourceBadge({ source, isOverridden }: { source: ConfigSource; isOverridden: boolean }) {
  const { t } = useTranslation();
  const s = t.settings.config;
  const style = SOURCE_STYLE[source];
  const Icon = SOURCE_ICON[source];
  return (
    <span className={`inline-flex items-center gap-0.5 px-1 py-px rounded text-[10px] font-medium uppercase tracking-wider ${style.color} ${style.bg}`}>
      <Icon className="w-2.5 h-2.5" />
      {s[style.labelKey]}
      {isOverridden && source === 'agent' && (
        <span className="w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" />
      )}
    </span>
  );
}

function CellValue({ field, mask }: { field: ConfigField; mask?: boolean }) {
  if (field.value == null) return <span className="text-foreground italic typo-caption">--</span>;
  const display = mask ? '••••••' : String(field.value);
  return (
    <span className="font-mono typo-code text-foreground truncate max-w-[120px]" title={mask ? undefined : display}>
      {display}
    </span>
  );
}

interface PersonaRow {
  persona: Persona;
  config: EffectiveModelConfig | null;
  loading: boolean;
  /** Non-null when `resolveEffectiveConfig` rejected for this persona.
   *  Distinct from `loading` so cells can render a visible failure
   *  state instead of a perpetual loading-skeleton pulse. */
  error: string | null;
}

type FieldLabelKey = 'field_model' | 'field_provider' | 'field_budget' | 'field_turns' | 'field_cache';

const FIELDS: { key: keyof EffectiveModelConfig; labelKey: FieldLabelKey; mask?: boolean }[] = [
  { key: 'model', labelKey: 'field_model' },
  { key: 'provider', labelKey: 'field_provider' },
  { key: 'maxBudgetUsd', labelKey: 'field_budget' },
  { key: 'maxTurns', labelKey: 'field_turns' },
  { key: 'promptCachePolicy', labelKey: 'field_cache' },
];

// Module-level result cache, scoped to one session. Re-mounting this panel
// re-uses cached results within CACHE_TTL_MS. A Refresh click bypasses the
// cache (clearConfigCache).
const configCache = new Map<string, { config: EffectiveModelConfig | null; error: string | null; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function clearConfigCache(): void {
  configCache.clear();
}

function isFresh(entry: { ts: number } | undefined): entry is { ts: number; config: EffectiveModelConfig | null; error: string | null } {
  return entry !== undefined && (Date.now() - entry.ts) < CACHE_TTL_MS;
}

export function PersonaConfigPanel() {
  const [rows, setRows] = useState<PersonaRow[]>([]);
  const [globalLoading, setGlobalLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [overridesOnly, setOverridesOnly] = useState(false);
  const { t, tx } = useTranslation();
  const s = t.settings.config;

  const visibleRows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return rows.filter((row) => {
      if (needle && !row.persona.name.toLowerCase().includes(needle)) return false;
      if (overridesOnly) {
        // "Override" = at least one field on this persona's effective config is
        // sourced from the agent tier (rather than workspace/global/default).
        // Loading rows are excluded — we don't yet know what they'll resolve to,
        // and silently hiding them while their data arrives is more confusing
        // than just letting them pop in. Same logic for error rows.
        if (!row.config || row.loading || row.error) return false;
        const hasAgentOverride = FIELDS.some((f) => {
          const field = row.config?.[f.key] as ConfigField | undefined;
          return field?.source === 'agent';
        });
        if (!hasAgentOverride) return false;
      }
      return true;
    });
  }, [rows, filter, overridesOnly]);

  const filtersActive = filter.trim().length > 0 || overridesOnly;

  const load = async (forceRefresh = false) => {
    setGlobalLoading(true);
    try {
      if (forceRefresh) clearConfigCache();
      const personas = await listPersonas();
      const initial: PersonaRow[] = personas.map((p) => {
        const cached = configCache.get(p.id);
        if (isFresh(cached)) {
          return { persona: p, config: cached.config, loading: false, error: cached.error };
        }
        return { persona: p, config: null, loading: true, error: null };
      });
      setRows(initial);

      // Only resolve personas whose cache is stale or missing.
      const stale = personas.filter((p) => !isFresh(configCache.get(p.id)));
      if (stale.length === 0) {
        setGlobalLoading(false);
        return;
      }

      // One IPC for every stale persona. The backend fetches personas,
      // groups and global settings once and resolves in memory — replacing
      // the per-persona fan-out that cost ~10s with ~142 personas.
      const now = Date.now();
      try {
        const configs = await resolveEffectiveConfigBulk(stale.map((p) => p.id));
        const byId = new Map(configs.map((c) => [c.personaId, c]));
        stale.forEach((p) => {
          const config = byId.get(p.id) ?? null;
          // A persona absent from the bulk result couldn't be resolved;
          // `error: null` lets the cell fall back to the generic
          // "config could not be resolved" tooltip rather than a raw string.
          configCache.set(p.id, { config, error: null, ts: now });
        });
      } catch (reason) {
        // The whole bulk call failed — surface the message on every row
        // that was waiting on it.
        const message = reason instanceof Error
          ? reason.message
          : (typeof reason === 'object' && reason !== null && 'error' in reason)
            ? String((reason as { error: string }).error)
            : String(reason);
        stale.forEach((p) => {
          configCache.set(p.id, { config: null, error: message, ts: now });
        });
      }

      setRows(personas.map((p) => {
        const cached = configCache.get(p.id);
        return {
          persona: p,
          config: cached?.config ?? null,
          loading: false,
          error: cached?.error ?? null,
        };
      }));
    } catch {
      setRows([]);
    } finally {
      setGlobalLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      {/* Subtitle + refresh */}
      <div className="flex items-start justify-between gap-3">
        <p className="typo-caption text-foreground max-w-2xl">{s.subtitle}</p>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={globalLoading}
          className="flex items-center gap-1 px-2 py-1 typo-caption text-foreground hover:text-foreground bg-secondary/30 hover:bg-secondary/50 rounded transition-colors disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-3 h-3 ${globalLoading ? 'animate-spin' : ''}`} />
          {s.refresh}
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-[10px] text-foreground flex-wrap">
        <span className="flex items-center gap-1"><User className="w-2.5 h-2.5 text-violet-400" /> {s.agent_level}</span>
        <span className="flex items-center gap-1"><FolderOpen className="w-2.5 h-2.5 text-blue-400" /> {s.workspace_level}</span>
        <span className="flex items-center gap-1"><Globe className="w-2.5 h-2.5 text-emerald-400" /> {s.global_level}</span>
        <span className="flex items-center gap-1"><Minus className="w-2.5 h-2.5 text-foreground" /> {s.not_set}</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" /> {s.overrides_inherited}</span>
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground pointer-events-none" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={s.search_placeholder}
            aria-label={s.search_placeholder}
            className="w-full pl-7 pr-7 py-1 typo-caption rounded-input bg-secondary/30 border border-primary/10 text-foreground placeholder:text-foreground/50 focus:outline-none focus:border-primary/40"
          />
          {filter.length > 0 && (
            <button
              type="button"
              onClick={() => setFilter('')}
              aria-label={s.clear_filter_aria}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded text-foreground hover:text-primary hover:bg-secondary/40"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <label
          className="flex items-center gap-1.5 typo-caption text-foreground cursor-pointer select-none"
          title={s.overrides_only_tooltip}
        >
          <input
            type="checkbox"
            checked={overridesOnly}
            onChange={(e) => setOverridesOnly(e.target.checked)}
            className="w-3 h-3 rounded border-primary/20 bg-secondary/30 text-primary focus:ring-1 focus:ring-primary/40"
          />
          {s.overrides_only_label}
        </label>
        {filtersActive && rows.length > 0 && (
          <span className="typo-caption text-foreground ml-auto">
            {tx(s.showing_count, { shown: visibleRows.length, total: rows.length })}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="border border-primary/10 rounded-card overflow-hidden bg-secondary/10">
        <table className="w-full typo-caption">
          <thead>
            <tr className="border-b border-primary/10 bg-secondary/20">
              <th className="text-left px-3 py-2 font-medium text-foreground">{s.agent}</th>
              <th className="text-left px-3 py-2 font-medium text-foreground">{s.workspace_level}</th>
              {FIELDS.map((f) => (
                <th key={f.key} className="text-left px-3 py-2 font-medium text-foreground">{s[f.labelKey]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {globalLoading && rows.length === 0 && (
              <tr>
                <td colSpan={2 + FIELDS.length} className="px-3 py-6 text-center text-foreground">
                  {s.loading_agents}
                </td>
              </tr>
            )}
            {!globalLoading && rows.length === 0 && (
              <tr>
                <td colSpan={2 + FIELDS.length} className="px-3 py-6 text-center text-foreground">
                  {s.no_agents}
                </td>
              </tr>
            )}
            {!globalLoading && rows.length > 0 && visibleRows.length === 0 && (
              <tr>
                <td colSpan={2 + FIELDS.length} className="px-3 py-6 text-center text-foreground">
                  {s.filtered_empty}
                </td>
              </tr>
            )}
            {visibleRows.map((row) => (
              <tr key={row.persona.id} className="border-b border-primary/5 hover:bg-secondary/20 transition-colors">
                <td className="px-3 py-2 font-medium text-foreground whitespace-nowrap">
                  {row.persona.name}
                </td>
                <td className="px-3 py-2 text-foreground whitespace-nowrap">
                  {row.config?.workspaceName ?? '--'}
                </td>
                {FIELDS.map((f) => {
                  if (row.loading) {
                    return <td key={f.key} className="px-3 py-2"><div className="h-3 w-16 bg-secondary/40 rounded animate-pulse" /></td>;
                  }
                  if (row.error || !row.config) {
                    // First column of the failed row gets the labelled error;
                    // subsequent columns render an em-dash so the user can see
                    // the row is real but its config couldn't be resolved.
                    if (f.key === FIELDS[0]!.key) {
                      return (
                        <td key={f.key} className="px-3 py-2" title={row.error ?? s.config_could_not_be_resolved}>
                          <span className="inline-flex items-center gap-1 text-amber-400 typo-caption">
                            <AlertTriangle className="w-3 h-3" />
                            {s.failed_to_resolve}
                          </span>
                        </td>
                      );
                    }
                    return <td key={f.key} className="px-3 py-2"><span className="text-foreground italic typo-caption">--</span></td>;
                  }
                  const field = row.config[f.key] as ConfigField;
                  return (
                    <td key={f.key} className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <CellValue field={field} mask={f.mask} />
                        <SourceBadge source={field.source} isOverridden={field.isOverridden} />
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
