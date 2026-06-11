// KPI card — BASELINE variant (the P5 card as shipped, extracted for the
// /prototype A/B round). Shared chrome helpers (pace sentence, track tint,
// one-shot celebration) are exported for the directional variants.
import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Cable, PartyPopper } from 'lucide-react';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { paceDescriptor, type KpiTrack } from './kpiMath';
import { categoryMeta } from './kpiMeta';
import { describeMeasurement } from './describeMeasurement';

export interface KpiCardProps {
  kpi: DevKpi;
  onOpen: (id: string) => void;
  onConnect: () => void;
}

export const TRACK_TINT: Record<KpiTrack, string> = {
  met: 'border-success/40',
  'on-track': 'border-primary/15',
  'off-track': 'border-destructive/50',
  unmeasured: 'border-primary/10',
};

/** Theme color for a pace state — the ramp every variant shares. */
export const TRACK_COLOR: Record<KpiTrack, string> = {
  met: 'var(--success)',
  'on-track': 'var(--primary)',
  'off-track': 'var(--destructive)',
  unmeasured: 'var(--muted-foreground, var(--primary))',
};

const CELEBRATED_KEY = 'personas.kpis.celebrated';

export function celebratedSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CELEBRATED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function markCelebrated(id: string) {
  try {
    const s = celebratedSet();
    s.add(id);
    localStorage.setItem(CELEBRATED_KEY, JSON.stringify([...s].slice(-100)));
  } catch (err) {
    silentCatch('kpi.celebrate.persist')(err);
  }
}

export function paceSentence(
  kpi: DevKpi,
  t: ReturnType<typeof useTranslation>['t'],
  tx: ReturnType<typeof useTranslation>['tx'],
): string {
  const d = paceDescriptor(kpi);
  const unit = kpi.unit || '';
  switch (d.track) {
    case 'met':
      return tx(t.kpis.pace_met, { value: kpi.current_value ?? 0, unit });
    case 'unmeasured':
      return t.kpis.pace_unmeasured;
    case 'off-track':
      return d.daysLeft != null
        ? tx(t.kpis.pace_off_dated, {
            current: kpi.current_value ?? 0,
            target: kpi.target_value ?? 0,
            unit,
            days: Math.max(0, d.daysLeft),
          })
        : tx(t.kpis.pace_off, {
            current: kpi.current_value ?? 0,
            target: kpi.target_value ?? 0,
            unit,
          });
    default:
      return d.progressPct != null && d.daysLeft != null
        ? tx(t.kpis.pace_on_dated, {
            pct: d.progressPct,
            target: kpi.target_value ?? 0,
            unit,
            days: Math.max(0, d.daysLeft),
          })
        : tx(t.kpis.pace_on, { target: kpi.target_value ?? 0, unit });
  }
}

/** Footer row shared by all variants: freshness, paused chip, connect CTA. */
export function KpiCardFooter({ kpi, onConnect }: { kpi: DevKpi; onConnect: () => void }) {
  const { t, tx } = useTranslation();
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {kpi.last_measured_at && (
        <span className="typo-caption text-foreground">
          <RelativeTime timestamp={kpi.last_measured_at} />
        </span>
      )}
      {kpi.status === 'paused' && (
        <span className="typo-caption text-foreground">{t.kpis.paused_chip}</span>
      )}
      {kpi.needed_connector && (
        <Tooltip content={tx(t.kpis.connect_tooltip, { service: kpi.needed_connector })}>
          <span
            role="link"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onConnect();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation();
                onConnect();
              }
            }}
            className="inline-flex items-center gap-1 typo-caption text-primary hover:underline cursor-pointer"
            data-testid={`kpi-connect-${kpi.id}`}
          >
            <Cable className="w-3 h-3" />
            {tx(t.kpis.connect_cta, { service: kpi.needed_connector })}
          </span>
        </Tooltip>
      )}
    </div>
  );
}

export function KpiCardBaseline({ kpi, onOpen, onConnect }: KpiCardProps) {
  const { t, tx } = useTranslation();
  const d = paceDescriptor(kpi);
  const cat = categoryMeta(kpi.category);
  const CatIcon = cat.icon;
  const justMet = d.track === 'met' && !celebratedSet().has(kpi.id);

  useEffect(() => {
    if (justMet) markCelebrated(kpi.id);
  }, [justMet, kpi.id]);

  return (
    <motion.button
      type="button"
      onClick={() => onOpen(kpi.id)}
      data-testid={`kpi-card-${kpi.id}`}
      initial={justMet ? { scale: 0.96 } : false}
      animate={justMet ? { scale: [0.96, 1.03, 1] } : {}}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className={`text-left rounded-card border bg-secondary/20 hover:bg-secondary/40 transition-colors p-4 space-y-2 ${TRACK_TINT[d.track]} ${kpi.status === 'paused' ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="typo-heading text-foreground">{kpi.name}</span>
        <Tooltip content={cat.label(t)}>
          <CatIcon className="w-4 h-4 text-foreground flex-shrink-0" aria-label={cat.label(t)} />
        </Tooltip>
      </div>

      <div className="flex items-baseline gap-2">
        {justMet && <PartyPopper className="w-4 h-4 text-success" aria-hidden />}
        <span className="typo-title text-foreground tabular-nums">
          {kpi.current_value != null ? <Numeric value={kpi.current_value} /> : '—'}
        </span>
        {kpi.target_value != null && (
          <span className="typo-body text-foreground tabular-nums">
            / <Numeric value={kpi.target_value} /> {kpi.unit}
          </span>
        )}
      </div>

      {d.progressPct != null && (
        <div className="h-1 rounded-full bg-secondary/60 overflow-hidden">
          <div
            className={`h-full rounded-full ${d.track === 'off-track' ? 'bg-destructive/70' : d.track === 'met' ? 'bg-success/70' : 'bg-primary/70'}`}
            style={{ width: `${Math.max(d.progressPct, 2)}%` }}
          />
        </div>
      )}

      <p className="typo-caption text-foreground">{paceSentence(kpi, t, tx)}</p>
      <p className="typo-caption text-foreground opacity-80">{describeMeasurement(kpi, t, tx)}</p>

      <KpiCardFooter kpi={kpi} onConnect={onConnect} />
    </motion.button>
  );
}
