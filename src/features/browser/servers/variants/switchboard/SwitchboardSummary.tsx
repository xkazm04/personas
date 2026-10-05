/**
 * The Switchboard's head: four big numbers (running, outside Personas, failed,
 * ports in use) on the kit's StatStrip, each with its quantity drawn as one unit
 * per server, so the fleet reads before a single row is scanned.
 */
import { StatStrip, UnitStrip, type StatTile, type UnitSegment } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import { toneOf, type SwitchboardSummary as Summary } from './switchboardModel';

export function SwitchboardSummary({ summary, loading }: { summary: Summary; loading: boolean }) {
  const { t, tx } = useTranslation();
  const sb = t.browser.servers.switchboard;
  const of = tx(sb.stat_of, { total: summary.total });
  const rest = (n: number): UnitSegment => ({ n: summary.total - n, tone: 'neutral', glyph: 'empty' });

  const tiles: StatTile[] = [
    {
      label: sb.stat_running,
      value: summary.running,
      unit: of,
      draw: (
        <UnitStrip
          label={tx(sb.stat_running_draw, { count: summary.running, total: summary.total })}
          segments={[
            { n: summary.running, tone: 'primary', glyph: 'live' },
            { n: summary.starting, tone: 'primary', glyph: 'soft' },
            rest(summary.running + summary.starting),
          ]}
        />
      ),
      state: summary.running > 0 ? 'live' : 'default',
    },
    {
      label: sb.stat_external,
      value: summary.external,
      draw: (
        <UnitStrip label={sb.stat_external} segments={[{ n: summary.external, tone: 'info' }]} />
      ),
    },
    {
      label: sb.stat_failed,
      value: summary.failed,
      draw: <UnitStrip label={sb.stat_failed} segments={[{ n: summary.failed, tone: 'error' }]} />,
    },
    {
      label: sb.stat_ports,
      value: summary.portHolders.length,
      // The ports ride the figure's line: they ARE the quantity, read as numbers.
      unit: (
        <span className="sb-ports" aria-label={sb.stat_ports}>
          {summary.portHolders.map((server) => (
            <span key={server.projectId} className={`typo-code sb-portchip sbt-${toneOf(server.state)}`}>
              {server.devPort}
            </span>
          ))}
        </span>
      ),
    },
  ];

  return (
    <div className="sb-summary">
      <StatStrip tiles={tiles} state={loading ? 'loading' : undefined} />
      <p className="typo-caption sb-keys">{sb.keys_hint}</p>
    </div>
  );
}
