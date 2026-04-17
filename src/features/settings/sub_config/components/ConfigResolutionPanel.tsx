import { useState, useEffect } from 'react';
import { Layers, RefreshCw, Globe, FolderOpen, User, Minus } from 'lucide-react';
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

const SOURCE_STYLE: Record<ConfigSource, { color: string; bg: string; label: string }> = {
  agent:     { color: 'text-violet-400',            bg: 'bg-violet-500/10', label: 'Agent' },
  workspace: { color: 'text-blue-400',              bg: 'bg-blue-500/10',   label: 'Workspace' },
  global:    { color: 'text-emerald-400',           bg: 'bg-emerald-500/10', label: 'Global' },
  default:   { color: 'text-foreground',   bg: 'bg-secondary/30',  label: '--' },
};

function SourceBadge({ source, isOverridden }: { source: ConfigSource; isOverridden: boolean }) {
  const style = SOURCE_STYLE[source];
  const Icon = SOURCE_ICON[source];
  return (
    <span className={`inline-flex items-center gap-0.5 px-1 py-px rounded text-[10px] font-medium uppercase tracking-wider ${style.color} ${style.bg}`}>
      <Icon className="w-2.5 h-2.5" />
      {style.label}
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
}

const FIELDS: { key: keyof EffectiveModelConfig; label: string; mask?: boolean }[] = [
  { key: 'model', label: 'Model' },
  { key: 'provider', label: 'Provider' },
  { key: 'maxBudgetUsd', label: 'Budget' },
  { key: 'maxTurns', label: 'Turns' },
  { key: 'promptCachePolicy', label: 'Cache' },
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
      const initial: PersonaRow[] = personas.map((p) => ({ persona: p, config: null, loading: true }));
      setRows(initial);

      const results = await Promise.allSettled(
        personas.map((p) => resolveEffectiveConfig(p.id))
      );

      setRows(personas.map((p, i) => {
        const r = results[i];
        return {
          persona: p,
          config: r && r.status === 'fulfilled' ? r.value : null,
          loading: false,
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
                <th key={f.key} className="text-left px-3 py-2 font-medium text-foreground">{f.label}</th>
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
                  if (row.loading || !row.config) {
                    return <td key={f.key} className="px-3 py-2"><div className="h-3 w-16 bg-secondary/40 rounded animate-pulse" /></td>;
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
