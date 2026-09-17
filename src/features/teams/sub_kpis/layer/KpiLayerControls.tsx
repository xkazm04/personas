// The per-project cockpit that travels with the layer: the autopilot switch,
// the simulation dispatch, its adoption queue, and the observation-channel
// switch that decides WHICH measurements the charts below read. Production is
// authoritative — pace, status and autopilot never read the simulated channels.
import { AutopilotControl } from '../AutopilotControl';
import { KpiSimControl } from '../KpiSimControl';
import { KpiSimSuggestions } from '../KpiSimSuggestions';
import { useTranslation } from '@/i18n/useTranslation';

export type KpiEnv = 'production' | 'test' | 'local';
export const KPI_ENVS: KpiEnv[] = ['production', 'test', 'local'];

export function KpiLayerControls({
  projectId,
  env,
  onEnvChange,
  onRefresh,
}: {
  projectId: string;
  env: KpiEnv;
  onEnvChange: (env: KpiEnv) => void;
  /** A fresh ingest / applied suggestion must refresh the charts. */
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-card border border-primary/15 bg-secondary/10 px-4 py-3 space-y-3">
      <AutopilotControl projectId={projectId} />
      <KpiSimControl projectId={projectId} onIngested={onRefresh} />
      <KpiSimSuggestions projectId={projectId} onApplied={onRefresh} />

      <div className="flex items-center gap-1.5 flex-wrap" data-testid="kpi-layer-env-switcher">
        {/* muted-ok: structural micro-label naming the chip group, not prose */}
        <span className="typo-label text-muted-foreground">{t.kpis.env_filter_label}</span>
        {KPI_ENVS.map((e) => (
          <button
            key={e}
            type="button"
            aria-pressed={env === e}
            onClick={() => onEnvChange(e)}
            className={`rounded-pill px-2.5 py-1 typo-label focus-ring border ${
              env === e
                ? 'bg-primary/15 border-primary/30 text-foreground'
                : 'bg-secondary/30 border-border/50 text-muted-foreground hover:bg-secondary/50'
            }`}
          >
            {t.kpis.env_labels[e]}
          </button>
        ))}
        {env !== 'production' && (
          <span className="typo-caption" data-testid="kpi-layer-env-caption">
            {t.kpis.env_sim_caption}
          </span>
        )}
      </div>
    </div>
  );
}
