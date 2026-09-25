/**
 * Gate K prototype, Spine & Lens: the Overview section. Six tiles, each figure drawn as countable
 * units at the variant's quanta (1 square = 1 session, 100k tokens, 10 calls, 1 file, 5 turns).
 */
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Section, StatStrip, UnitStrip, apportion } from '@/features/shared/components/kit';
import { STATE_GLYPH, STATE_ORDER, TOKEN_PARTS, type SpineSession, type SpineTotals } from './activitySpineModel';
import type { SpineWords } from './useSpineWords';

export function ActivitySpineOverview({ sessions, totals, fleet, loading, w }: {
  sessions: readonly SpineSession[];
  totals: SpineTotals;
  fleet: readonly FleetSession[];
  loading: boolean;
  w: SpineWords;
}) {
  const turns = totals.userTurns + totals.agentTurns;
  const live = STATE_ORDER.filter((st) => st !== 'gone').map((st) => ({ st, n: fleet.filter((s) => s.state === st).length }));
  return (
    <Section
      id="s-fa-overview"
      eyebrow={w.eyebrow}
      title={w.t.sidebar.overview}
      meta={w.tx(sessions.length === 1 ? w.f.activity_subtitle_one : w.f.activity_subtitle_other, { count: sessions.length })}
    >
      <StatStrip
        state={loading ? 'loading' : undefined}
        tiles={[
          {
            label: w.sessions,
            value: sessions.length,
            draw: <UnitStrip size="m" label={w.sessions} segments={sessions.map((s) => ({ n: 1, ...STATE_GLYPH[s.state] }))} />,
          },
          {
            label: w.f.fleet_total_tokens,
            value: <Numeric value={totals.tokens.total} unit="compact" />,
            draw: (
              <UnitStrip
                size="s"
                rows={3}
                label={w.f.fleet_total_tokens}
                segments={apportion(TOKEN_PARTS.map((p) => ({ value: totals.tokens[p.k], tone: p.tone })), 100_000)}
              />
            ),
          },
          {
            label: w.toolCalls,
            value: totals.toolCalls,
            draw: <UnitStrip size="s" rows={2} label={w.toolCalls} segments={[{ n: totals.toolCalls / 10, tone: 'primary', glyph: 'soft' }]} />,
          },
          {
            label: <span className="k-cap inline-block">{w.files}</span>,
            value: totals.files,
            draw: <UnitStrip size="s" rows={2} label={w.files} segments={[{ n: totals.files, tone: 'highlight' }]} />,
          },
          {
            label: w.f.insights_turns,
            value: turns,
            draw: (
              <UnitStrip
                size="s"
                rows={3}
                label={w.f.insights_turns}
                segments={[{ n: totals.userTurns / 5, tone: 'human' }, { n: totals.agentTurns / 5, tone: 'agent' }]}
              />
            ),
          },
          {
            label: w.t.monitor.map_live,
            value: fleet.length,
            draw: <UnitStrip size="m" label={w.t.monitor.map_live} segments={live.map(({ st, n }) => ({ n, ...STATE_GLYPH[st] }))} />,
          },
        ]}
      />
    </Section>
  );
}
