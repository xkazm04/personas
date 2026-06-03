import { useMemo, useState, useEffect } from 'react';
import { GitCompare, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { compositeScore, scoreColor } from '@/lib/eval/evalFramework';
import { useTranslation } from '@/i18n/useTranslation';

interface RunCompareCardProps {
  personaId: string;
}

type Mode = 'arena' | 'ab' | 'eval' | 'matrix';
const MODE_ABBR: Record<Mode, string> = { arena: 'AR', ab: 'AB', eval: 'EV', matrix: 'MX' };
const MAX_RUNS = 12;

interface ScoredRow {
  toolAccuracyScore: number | null;
  outputQualityScore: number | null;
  protocolCompliance: number | null;
}
type RunRow = { id: string; personaId: string; status: string; createdAt: string };
interface RunItem { id: string; mode: Mode; label: string; date: string; ta: number; oq: number; pc: number; composite: number; }

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** Run-level dimension averages over scored rows (null = unscored, excluded). */
function dims(results: ScoredRow[]): Omit<RunItem, 'id' | 'mode' | 'label' | 'date'> | null {
  const mean = (pick: (r: ScoredRow) => number | null) => {
    let s = 0, n = 0;
    for (const r of results) { const v = pick(r); if (v != null) { s += v; n++; } }
    return n > 0 ? s / n : null;
  };
  const ta = mean((r) => r.toolAccuracyScore);
  const oq = mean((r) => r.outputQualityScore);
  const pc = mean((r) => r.protocolCompliance);
  if (ta == null && oq == null && pc == null) return null;
  return { ta: Math.round(ta ?? 0), oq: Math.round(oq ?? 0), pc: Math.round(pc ?? 0), composite: compositeScore(ta ?? 0, oq ?? 0, pc ?? 0) };
}

export function RunCompareCard({ personaId }: RunCompareCardProps) {
  const { t } = useTranslation();
  const arenaRuns = useAgentStore((s) => s.arenaRuns);
  const abRuns = useAgentStore((s) => s.abRuns);
  const evalRuns = useAgentStore((s) => s.evalRuns);
  const matrixRuns = useAgentStore((s) => s.matrixRuns);
  const arenaResultsMap = useAgentStore((s) => s.arenaResultsMap);
  const abResultsMap = useAgentStore((s) => s.abResultsMap);
  const evalResultsMap = useAgentStore((s) => s.evalResultsMap);
  const matrixResultsMap = useAgentStore((s) => s.matrixResultsMap);

  const runItems = useMemo(() => {
    const items: RunItem[] = [];
    const collect = (runs: RunRow[], map: Record<string, ScoredRow[]>, mode: Mode) => {
      for (const run of runs) {
        if (run.personaId !== personaId || run.status !== 'completed') continue;
        const res = map[run.id];
        if (!res?.length) continue;
        const d = dims(res);
        if (!d) continue;
        items.push({ id: run.id, mode, label: `${MODE_ABBR[mode]} ${shortDate(run.createdAt)}`, date: run.createdAt, ...d });
      }
    };
    collect(arenaRuns, arenaResultsMap, 'arena');
    collect(abRuns, abResultsMap, 'ab');
    collect(evalRuns, evalResultsMap, 'eval');
    collect(matrixRuns, matrixResultsMap, 'matrix');
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return items.slice(0, MAX_RUNS);
  }, [personaId, arenaRuns, abRuns, evalRuns, matrixRuns, arenaResultsMap, abResultsMap, evalResultsMap, matrixResultsMap]);

  const [aId, setAId] = useState<string | null>(null);
  const [bId, setBId] = useState<string | null>(null);

  // Seed with the two most recent runs so the card is useful on first paint.
  useEffect(() => {
    if (aId == null && bId == null && runItems.length >= 2) {
      setBId(runItems[0]!.id);
      setAId(runItems[1]!.id);
    }
  }, [runItems, aId, bId]);

  const pick = (id: string) => {
    if (aId === id) return setAId(null);
    if (bId === id) return setBId(null);
    if (aId == null) return setAId(id);
    if (bId == null) return setBId(id);
    setAId(id);
  };

  if (runItems.length < 2) return null;

  const aItem = runItems.find((r) => r.id === aId) ?? null;
  const bItem = runItems.find((r) => r.id === bId) ?? null;

  const rows = aItem && bItem ? [
    { label: t.agents.lab.composite, a: aItem.composite, b: bItem.composite, strong: true },
    { label: t.agents.lab.tool_usage, a: aItem.ta, b: bItem.ta, strong: false },
    { label: t.agents.lab.output_quality, a: aItem.oq, b: bItem.oq, strong: false },
    { label: t.agents.lab.protocol, a: aItem.pc, b: bItem.pc, strong: false },
  ] : [];

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/20 p-3 space-y-2" data-testid="run-compare-card">
      <div className="flex items-center gap-2">
        <GitCompare className="w-3.5 h-3.5 text-primary/70" />
        <span className="typo-caption font-medium text-foreground capitalize">{t.agents.lab.compare_runs}</span>
      </div>

      {/* Run picker strip — click to assign A then B; click a selected run to clear it. */}
      <div className="flex flex-wrap gap-1">
        {runItems.map((r) => {
          const slot = r.id === aId ? 'A' : r.id === bId ? 'B' : null;
          return (
            <button
              key={r.id}
              onClick={() => pick(r.id)}
              data-testid={`run-compare-chip-${r.id}`}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-input typo-caption font-mono transition-colors ${
                slot ? 'bg-primary/15 text-primary' : 'text-foreground hover:bg-secondary/40'
              }`}
            >
              {slot && <span className="font-bold">{slot}</span>}
              {r.label}
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <p className="typo-caption text-foreground py-2 text-center">{t.agents.lab.select_two_compare}</p>
      ) : (
        <table className="w-full typo-caption">
          <thead>
            <tr className="text-foreground">
              <th className="text-left font-medium py-1" />
              <th className="text-right font-mono font-medium px-2">A·{aItem!.label}</th>
              <th className="text-right font-mono font-medium px-2">B·{bItem!.label}</th>
              <th className="text-right font-medium w-12">&Delta;</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const delta = row.b - row.a;
              return (
                <tr key={row.label} className="border-t border-primary/[0.06]">
                  <td className={`py-1 capitalize ${row.strong ? 'text-foreground font-medium' : 'text-foreground'}`}>{row.label}</td>
                  <td className={`text-right px-2 tabular-nums ${scoreColor(row.a)}`}>{row.a}</td>
                  <td className={`text-right px-2 tabular-nums ${scoreColor(row.b)}`}>{row.b}</td>
                  <td className={`text-right tabular-nums font-medium ${delta > 0 ? 'text-status-success' : delta < 0 ? 'text-status-error' : 'text-foreground'}`}>
                    <span className="inline-flex items-center gap-0.5 justify-end">
                      {delta > 0 ? <TrendingUp className="w-3 h-3" /> : delta < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                      {delta > 0 ? `+${delta}` : delta}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
