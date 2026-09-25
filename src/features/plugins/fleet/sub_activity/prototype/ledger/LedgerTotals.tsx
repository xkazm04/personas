/**
 * Section 1 of the Ledger port: five stat tiles over the window, each figure
 * with its drawing (the variant's strip). Live now counts registry sessions as
 * countable units in the app's attention order; tokens, tool calls and turns
 * draw split bars; files draw one unit per file, primary for a working session.
 */
import { StatStrip, StatTile, Units, SplitBar, ledgerCompact, type LedgerUnit } from '@/features/shared/components/kit-proto/ledger';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { STATE_ORDER, stateLabel, stateTone, toolTotals, type LedgerSession } from './ledgerModel';

const sum = (list: LedgerSession[], f: (s: LedgerSession) => number) => list.reduce((a, s) => a + f(s), 0);

export function LedgerTotals({ all, sessions, loading }: { all: LedgerSession[]; sessions: FleetSession[]; loading: boolean }) {
  const { t, tx } = useTranslation();
  const f = t.plugins.fleet;

  const liveUnits: LedgerUnit[] = [];
  const liveParts: string[] = [];
  for (const st of STATE_ORDER) {
    const n = sessions.filter((s) => s.state === st).length;
    if (!n) continue;
    liveParts.push(`${n} ${stateLabel(f, st).toLowerCase()}`);
    for (let i = 0; i < n; i++) liveUnits.push({ tone: stateTone(st) ?? 'neutral', hollow: st === 'hibernated' });
  }

  const tk = {
    input: sum(all, (s) => s.tokens.input), output: sum(all, (s) => s.tokens.output),
    cw: sum(all, (s) => s.tokens.cacheCreation), cr: sum(all, (s) => s.tokens.cacheRead),
  };
  const total = tk.input + tk.output + tk.cw + tk.cr;
  const tools = toolTotals(all);
  const calls = tools.reduce((a, x) => a + x.count, 0);
  const fileUnits: LedgerUnit[] = all.flatMap((s) => Array.from({ length: s.files }, () => ({ tone: s.state === 'running' ? 'primary' as const : 'neutral' as const })));
  const withFiles = all.filter((s) => s.files > 0).length;
  const prompts = sum(all, (s) => s.prompts);
  const replies = sum(all, (s) => s.replies);

  return (
    <StatStrip>
      <StatTile
        loading={loading}
        label={f.activity_tile_live}
        figure={<Numeric value={sessions.length} unit="count" />}
        draw={<Units tall units={liveUnits} label={liveParts.join(', ')} />}
        sub={tx(all.length === 1 ? f.activity_subtitle_one : f.activity_subtitle_other, { count: all.length })}
      />
      <StatTile
        loading={loading}
        label={f.activity_tile_total_tokens}
        figure={<Numeric>{ledgerCompact(total)}</Numeric>}
        draw={<SplitBar label={[f.insights_input, f.insights_output, f.insights_cache_write, f.insights_cache_read].join(', ')} parts={[
          { value: tk.input, tone: 'neutral' }, { value: tk.output, tone: 'primary' },
          { value: tk.cw, pale: true }, { value: tk.cr, pale: true, tone: 'primary' },
        ]} />}
        sub={tx(f.fleet_cache_hit, { percent: total ? Math.round((tk.cr / total) * 100) : 0 })}
      />
      <StatTile
        loading={loading}
        label={f.activity_tile_tool_calls}
        figure={<Numeric value={calls} unit="count" />}
        draw={<SplitBar label={t.common.tools} parts={tools.map((x, i) => ({ value: x.count, tone: i < 3 ? 'primary' : undefined, pale: i >= 3 }))} />}
        sub={tools[0] ? <>{tools[0].name} <Numeric value={tools[0].count} unit="count" /></> : null}
      />
      <StatTile
        loading={loading}
        label={f.activity_col_files}
        figure={<Numeric value={fileUnits.length} unit="count" />}
        draw={<Units units={fileUnits} label={f.activity_col_files} />}
        sub={tx(withFiles === 1 ? f.sessions_one : f.sessions_other, { count: withFiles })}
      />
      <StatTile
        loading={loading}
        label={f.insights_turns}
        figure={<Numeric value={prompts + replies} unit="count" />}
        draw={<SplitBar label={`${f.insights_prompts}, ${f.insights_turns}`} parts={[{ value: prompts, tone: 'primary' }, { value: replies, pale: true }]} />}
        sub={<><Numeric value={prompts} unit="count" /> {f.insights_prompts.toLowerCase()}</>}
      />
    </StatStrip>
  );
}
