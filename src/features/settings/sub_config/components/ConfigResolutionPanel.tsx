import { useState, useEffect } from 'react';
import { Layers, RefreshCw, Globe, FolderOpen, User, Minus, AlertTriangle } from 'lucide-react';
import { listPersonas, resolveEffectiveConfig } from '@/api/agents/personas';
import type { Persona } from '@/lib/bindings/Persona';
import type { EffectiveModelConfig } from '@/lib/bindings/EffectiveModelConfig';
import type { ConfigSource } from '@/lib/bindings/ConfigSource';
import type { ConfigField } from '@/lib/bindings/ConfigField';
import { useTranslation } from '@/i18n/useTranslation';

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

function CellValue({ field, mask }: { field: ConfigField<string | number>; mask?: boolean }) {
  if (field.value == null) return <span className="text-foreground italic typo-caption">--</span>;
  const display = mask ? '\u2022\u2022\u2022\u2022\u2022\u2022' : String(field.value);
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

export default function ConfigResolutionPanel() {
  const [rows, setRows] = useState<PersonaRow[]>([]);
  const [globalLoading, setGlobalLoading] = useState(true);
  const { t } = useTranslation();
  const s = t.settings.config;

  const load = async () => {
    setGlobalLoading(true);
    try {
      const personas = await listPersonas();
      const initial: PersonaRow[] = personas.map((p) => ({ persona: p, config: null, loading: true, error: null }));
      setRows(initial);

      const results = await Promise.allSettled(
        personas.map((p) => resolveEffectiveConfig(p.id))
      );

      setRows(personas.map((p, i) => {
        const r = results[i];
        if (r && r.status === 'fulfilled') {
          return { persona: p, config: r.value, loading: false, error: null };
        }
        // `r.status === 'rejected'`: the persona's effective config could not
        // be resolved. Capture the reason so the cell can render an explicit
        // failure state — without this distinction the row pulses identically
        // to "still loading" and the user has no way to know the resolve
        // dropped silently.
        const reason = r && r.status === 'rejected' ? r.reason : new Error('Unknown error');
        const message = reason instanceof Error
          ? reason.message
          : (typeof reason === 'object' && reason !== null && 'error' in reason)
            ? String((reason as { error: string }).error)
            : String(reason);
        return { persona: p, config: null, loading: false, error: message };
      }));
    } catch {
      setRows([]);
    } finally {
      setGlobalLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 p-4 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary/60" />
          <h2 className="typo-heading font-semibold text-foreground/90">{s.title}</h2>
          <span className="text-[10px] text-foreground">
            {s.subtitle}
          </span>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={globalLoading}
          className="flex items-center gap-1 px-2 py-1 typo-caption text-foreground hover:text-foreground bg-secondary/30 hover:bg-secondary/50 rounded transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${globalLoading ? 'animate-spin' : ''}`} />
          {s.refresh}
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-[10px] text-foreground">
        <span className="flex items-center gap-1"><User className="w-2.5 h-2.5 text-violet-400" /> {s.agent_level}</span>
        <span className="flex items-center gap-1"><FolderOpen className="w-2.5 h-2.5 text-blue-400" /> {s.workspace_level}</span>
        <span className="flex items-center gap-1"><Globe className="w-2.5 h-2.5 text-emerald-400" /> {s.global_level}</span>
        <span className="flex items-center gap-1"><Minus className="w-2.5 h-2.5 text-foreground" /> {s.not_set}</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" /> {s.overrides_inherited}</span>
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
            {rows.map((row) => (
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
                  const field = row.config[f.key] as ConfigField<string | number>;
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
