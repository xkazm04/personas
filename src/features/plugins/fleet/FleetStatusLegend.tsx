import { HelpCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { CONSOLE_DOT, BUSINESS_DOT, type ConsoleAxis, type BusinessAxis } from './FleetStatusDots';

/**
 * Hover/focus legend decoding the two-axis status dots. The dot grid scans
 * fast but is opaque to a new operator — this disclosure spells out what each
 * colour on the console (process) and activity (Claude) axes means, reusing
 * the exact palette + labels from FleetStatusDots so they can never drift.
 *
 * Reveals on pointer hover and on keyboard focus (focus-within), so it's
 * reachable without a mouse. Purely presentational; closes when focus leaves.
 */

const CONSOLE_ORDER: ConsoleAxis[] = ['spawning', 'alive', 'exited'];
const BUSINESS_ORDER: BusinessAxis[] = ['working', 'awaiting_input', 'idle', 'stale'];

function LegendRow({ bg, label }: { bg: string; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${bg}`} aria-hidden="true" />
      <span className="text-[13px] text-foreground">{label}</span>
    </li>
  );
}

export function FleetStatusLegend() {
  const { t } = useTranslation();
  return (
    <div className="relative inline-flex group">
      <button
        type="button"
        data-testid="fleet-legend-trigger"
        aria-label={t.plugins.fleet.legend_show}
        className="flex items-center gap-1 rounded-interactive px-1.5 py-0.5 text-[13px] text-foreground transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
      >
        <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{t.plugins.fleet.legend_show}</span>
      </button>
      <div
        role="tooltip"
        data-testid="fleet-legend-popover"
        className="pointer-events-none absolute right-0 top-full z-20 mt-1 w-56 rounded-card border border-primary/15 bg-secondary/95 p-3 opacity-0 shadow-elevation-2 backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <div className="mb-2">
          <p className="typo-label mb-1 uppercase tracking-wider text-foreground">
            {t.plugins.fleet.legend_process}
          </p>
          <ul className="space-y-1">
            {CONSOLE_ORDER.map((k) => (
              <LegendRow key={k} bg={CONSOLE_DOT[k].bg} label={t.plugins.fleet[CONSOLE_DOT[k].labelKey]} />
            ))}
          </ul>
        </div>
        <div>
          <p className="typo-label mb-1 uppercase tracking-wider text-foreground">
            {t.plugins.fleet.legend_activity}
          </p>
          <ul className="space-y-1">
            {BUSINESS_ORDER.map((k) => {
              const cfg = BUSINESS_DOT[k];
              return cfg ? <LegendRow key={k} bg={cfg.bg} label={t.plugins.fleet[cfg.labelKey]} /> : null;
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
