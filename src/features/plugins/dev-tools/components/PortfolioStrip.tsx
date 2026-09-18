import { useEffect, useState } from 'react';
import { Activity, Radar, ShieldAlert } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useDevToolsActions } from '../hooks/useDevToolsActions';
import { foldPortfolioStrip, type PortfolioStripModel } from '../portfolioStrip';

/**
 * Three tiles answering the cross-project question the Dev Tools overview could
 * not: how healthy is the fleet, which technologies only one project carries,
 * and which projects are sitting on a loud risk.
 *
 * Read-only on purpose. The card that asked for this wanted each tile to link
 * "into the matching inner page", and there is no radar or risk-matrix page in
 * `DevToolsTab` — inventing two routes is a different, larger change. The
 * detail therefore lives in each tile's tooltip, which answers the same
 * question without a destination that does not exist.
 */
const DASH = '—';

export function PortfolioStrip() {
  const { t, tx } = useTranslation();
  const dt = t.plugins.dev_tools;
  const { getPortfolioHealth, getTechRadar, getRiskMatrix } = useDevToolsActions();
  const [model, setModel] = useState<PortfolioStripModel | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [health, radar, risk] = await Promise.all([
          getPortfolioHealth(),
          getTechRadar(),
          getRiskMatrix(),
        ]);
        if (!cancelled) setModel(foldPortfolioStrip(health, radar, risk));
      } catch (e) {
        silentCatch('dev-tools/PortfolioStrip')(e);
      }
    })();
    return () => { cancelled = true; };
  }, [getPortfolioHealth, getTechRadar, getRiskMatrix]);

  // No ghost: this is a small strip above a page that renders its own loading
  // choreography, and a single-project (or cold) portfolio has no cross-project
  // answer to give at all.
  if (!model || model.empty) return null;

  return (
    <div
      className="flex flex-wrap items-stretch gap-2 mb-3"
      data-testid="dev-tools-portfolio-strip"
    >
      <Tile
        icon={<Activity className="w-3.5 h-3.5 text-emerald-400" />}
        label={dt.portfolio_health_label}
        testId="portfolio-tile-health"
        tooltip={
          model.health === null
            ? dt.portfolio_health_unmeasured
            : tx(dt.portfolio_projects, { count: model.activeProjects })
        }
        value={
          model.health === null
            ? <span className="opacity-40">{DASH}</span>
            : <Numeric value={model.health} precision={0} />
        }
      />
      <Tile
        icon={<Radar className="w-3.5 h-3.5 text-sky-400" />}
        label={dt.portfolio_radar_label}
        testId="portfolio-tile-radar"
        tooltip={
          model.radarAssess.length === 0
            ? dt.portfolio_radar_none
            : model.radarAssess.slice(0, 8).map((r) => r.technology).join(', ')
        }
        value={<Numeric value={model.radarAssess.length} />}
      />
      <Tile
        icon={<ShieldAlert className="w-3.5 h-3.5 text-amber-400" />}
        label={dt.portfolio_risk_label}
        testId="portfolio-tile-risk"
        tooltip={
          model.highRisk.length === 0
            ? dt.portfolio_risk_none
            : model.highRisk.slice(0, 6).map((r) => `${r.project_name}: ${r.description}`).join(' · ')
        }
        value={<Numeric value={model.highRisk.length} />}
      />
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  tooltip,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tooltip: string;
  testId: string;
}) {
  return (
    <Tooltip content={tooltip} placement="bottom">
      <div
        className="flex items-center gap-2 rounded-card border border-primary/10 bg-secondary/25 px-3 py-1.5"
        data-testid={testId}
      >
        {icon}
        <span className="typo-caption text-foreground">{label}</span>
        <span className="typo-body tabular-nums text-foreground">{value}</span>
      </div>
    </Tooltip>
  );
}
