import { useState } from 'react';
import {
  ChevronRight, ChevronDown, Heart, DollarSign, ShieldCheck, Eye, EyeOff,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { HeartbeatIndicator } from '../HeartbeatIndicator';
import { InsightBand } from './insights';
import { CompositeHealthBar, GradeDot, TrendBadge, MiniStat } from './primitives';
import { RowDetail } from './RowDetail';
import {
  GRADE_THEME, capitalize, type HeartbeatsVariantProps, type HeartbeatsModel,
} from './model';
import type { HealthGrade, PersonaHealthSignal } from '@/stores/slices/overview/personaHealthSlice';

// ---------------------------------------------------------------------------
// Vitals Ledger — a flat, full-width mission-control instrument table. One
// persona per row, a single thin composite heartbeat bar, inline tabular
// vitals, worst-first, healthy folded away behind a Show-all toggle. Expanding
// a row drills the composite score into its four diagnostic segments. Won the
// /prototype A/B over the card-grid baseline and a severity-lane variant.
// ---------------------------------------------------------------------------

const DIST_ORDER: HealthGrade[] = ['critical', 'degraded', 'unknown', 'healthy'];

const gradeTone = (g: HealthGrade) =>
  g === 'healthy' ? 'text-status-success' : g === 'degraded' ? 'text-status-warning' : g === 'critical' ? 'text-status-error' : 'text-zinc-400';

export function VitalsLedger({ model, loading, cascadeLinks, routingRecommendations }: HeartbeatsVariantProps) {
  const { t } = useTranslation();
  const h = t.overview.heartbeats;
  const [showHealthy, setShowHealthy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const rows = showHealthy ? model.sorted : model.unhealthy;
  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="space-y-5">
      {/* Command bar */}
      <div className="flex items-center gap-5 p-4 rounded-modal border border-primary/10 bg-secondary/10">
        <HeartbeatIndicator score={model.globalScore} grade={model.globalGrade} size="md" />
        <div className="min-w-0 shrink-0">
          <h2 className="typo-heading-lg text-foreground/90">
            {t.overview.health_dashboard.system_health}{' '}
            <span className={gradeTone(model.globalGrade)}>{capitalize(model.globalGrade)}</span>
          </h2>
          <p className="typo-caption text-foreground">
            <span className="tabular-nums">{model.counts.all}</span> {h.monitored}
          </p>
        </div>

        <div className="flex-1 min-w-0 hidden lg:flex flex-col gap-2">
          <DistributionStrip model={model} />
          <div className="flex items-center gap-3 flex-wrap">
            {DIST_ORDER.filter(g => model.counts[g] > 0).map(g => (
              <span key={g} className="inline-flex items-center gap-1.5 typo-caption text-foreground">
                <span className={`w-2 h-2 rounded-full ${GRADE_THEME[g].dot}`} />
                <span className="tabular-nums">{model.counts[g]}</span> {capitalize(g)}
              </span>
            ))}
          </div>
        </div>

        <button
          onClick={() => setShowHealthy(v => !v)}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card border border-primary/10 typo-caption text-foreground hover:bg-secondary/40 transition-colors"
        >
          {showHealthy ? <><EyeOff className="w-3.5 h-3.5" />{h.focus_issues}</> : <><Eye className="w-3.5 h-3.5" />{h.show_all}</>}
        </button>
      </div>

      {/* Ledger */}
      <div className="rounded-modal border border-primary/10 bg-secondary/5 shadow-elevation-2 overflow-hidden">
        <div className={`h-0.5 ${GRADE_THEME[model.globalGrade].bar} opacity-60`} />

        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          <Heart className="w-4 h-4 text-status-error" />
          <h3 className="typo-heading text-foreground">{t.overview.health_dashboard.persona_heartbeats}</h3>
          <span className="typo-caption text-foreground tabular-nums">{rows.length} / {model.counts.all}</span>
        </div>

        <div className="flex items-center gap-3 px-4 py-2 bg-secondary/20 border-y border-primary/10 typo-label text-foreground">
          <span className="w-44 sm:w-52 shrink-0">{h.col_persona}</span>
          <span className="flex-1 hidden sm:block">{h.heartbeat}</span>
          <span className="hidden md:block shrink-0 w-[200px] text-right">{h.col_vitals}</span>
          <span className="shrink-0 w-12 text-right">{h.col_score}</span>
          <span className="w-4 shrink-0" />
        </div>

        {model.counts.all === 0 ? (
          <div className="flex items-center justify-center py-12 text-foreground typo-body">
            {loading ? t.overview.health_dashboard.computing : t.overview.health_dashboard.no_match}
          </div>
        ) : rows.length === 0 ? (
          <AllClear onShowAll={() => setShowHealthy(true)} />
        ) : (
          <div className="divide-y divide-primary/5">
            {rows.map(s => (
              <LedgerRow key={s.personaId} signal={s} expanded={expanded.has(s.personaId)} onToggle={() => toggle(s.personaId)} />
            ))}
          </div>
        )}

        {model.healthy.length > 0 && rows.length > 0 && (
          <button
            onClick={() => setShowHealthy(v => !v)}
            className="w-full flex items-center gap-2 px-4 py-2.5 typo-caption text-foreground hover:bg-secondary/20 border-t border-primary/10 transition-colors"
          >
            {showHealthy
              ? <><EyeOff className="w-3.5 h-3.5" />{h.hide_healthy}</>
              : <><Eye className="w-3.5 h-3.5" /><span className="tabular-nums">{model.healthy.length}</span> {h.healthy_hidden} · {h.show_all}</>}
          </button>
        )}
      </div>

      {/* Insight band */}
      <InsightBand signals={model.sorted} cascadeLinks={cascadeLinks} recommendations={routingRecommendations} />
    </div>
  );
}

function LedgerRow({ signal, expanded, onToggle }: { signal: PersonaHealthSignal; expanded: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const h = t.overview.heartbeats;
  const th = GRADE_THEME[signal.grade];
  const successTone = signal.successRate >= 90 ? 'text-status-success' : signal.successRate >= 70 ? 'text-status-warning' : 'text-status-error';
  const burnTone = signal.budgetRatio > 0.8 ? 'text-status-error' : signal.budgetRatio > 0.5 ? 'text-status-warning' : 'text-foreground';

  return (
    <div className={`relative ${expanded ? th.soft : ''}`}>
      <span className={`absolute left-0 inset-y-0 w-0.5 ${th.bar} ${signal.grade === 'healthy' ? 'opacity-30' : 'opacity-70'}`} aria-hidden="true" />
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-secondary/20 transition-colors">
        <div className="flex items-center gap-2 w-44 sm:w-52 shrink-0 min-w-0">
          <GradeDot grade={signal.grade} />
          <PersonaIcon icon={signal.personaIcon} color={signal.personaColor} display="framed" frameSize="xs" />
          <div className="min-w-0">
            <p className="typo-data text-foreground/90 truncate">{signal.personaName}</p>
            <p className="typo-caption text-foreground truncate">
              {signal.totalExecutions > 0 ? `${signal.totalExecutions} ${h.runs_suffix}` : h.idle}
            </p>
          </div>
        </div>

        <div className="flex-1 min-w-0 hidden sm:block">
          <CompositeHealthBar score={signal.heartbeatScore} grade={signal.grade} />
        </div>

        <div className="hidden md:flex items-center justify-end gap-3 shrink-0 w-[200px]">
          <TrendBadge trend={signal.failureTrend} />
          <MiniStat icon={Heart} value={`${signal.successRate.toFixed(0)}%`} tone={successTone} />
          <MiniStat icon={DollarSign} value={`$${signal.dailyBurnRate.toFixed(2)}`} tone={burnTone} />
        </div>

        <span className={`shrink-0 w-12 text-right typo-data tabular-nums font-semibold ${th.text}`}>{signal.heartbeatScore}</span>
        {expanded ? <ChevronDown className="w-4 h-4 text-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-foreground shrink-0" />}
      </button>
      {expanded && <RowDetail signal={signal} />}
    </div>
  );
}

function DistributionStrip({ model }: { model: HeartbeatsModel }) {
  const total = model.counts.all || 1;
  return (
    <div className="flex items-center gap-px h-2 rounded-full overflow-hidden bg-secondary/30">
      {DIST_ORDER.map(g => model.counts[g] > 0 && (
        <div key={g} className={GRADE_THEME[g].bar} style={{ width: `${(model.counts[g] / total) * 100}%` }} title={`${capitalize(g)}: ${model.counts[g]}`} />
      ))}
    </div>
  );
}

function AllClear({ onShowAll }: { onShowAll: () => void }) {
  const { t } = useTranslation();
  const h = t.overview.heartbeats;
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center px-4">
      <div className="w-12 h-12 rounded-full bg-status-success/10 border border-status-success/20 flex items-center justify-center">
        <ShieldCheck className="w-6 h-6 text-status-success" />
      </div>
      <p className="typo-heading text-foreground/90">{h.all_clear_title}</p>
      <p className="typo-body text-foreground max-w-sm">{h.all_clear_detail}</p>
      <button onClick={onShowAll} className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card border border-primary/10 typo-caption text-foreground hover:bg-secondary/40 transition-colors">
        <Eye className="w-3.5 h-3.5" />{h.show_all}
      </button>
    </div>
  );
}
