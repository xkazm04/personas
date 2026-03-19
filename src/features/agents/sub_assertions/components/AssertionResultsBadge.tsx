import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, ShieldX, ChevronDown, ChevronRight } from "lucide-react";

import type { ExecutionAssertionSummary } from "@/lib/bindings/ExecutionAssertionSummary";
import * as api from "@/api/agents/outputAssertions";
import { silentCatch } from "@/lib/silentCatch";

interface Props {
  executionId: string;
}

export function AssertionResultsBadge({ executionId }: Props) {
  const [summary, setSummary] = useState<ExecutionAssertionSummary | null>(
    null,
  );
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    api
      .getAssertionResultsForExecution(executionId)
      .then((s) => {
        if (s.total > 0) setSummary(s);
      })
      .catch(silentCatch("assertions:results"));
  }, [executionId]);

  if (!summary || summary.total === 0) return null;

  const allPassed = summary.failed === 0;
  const StatusIcon = allPassed ? ShieldCheck : summary.failed > summary.passed ? ShieldX : ShieldAlert;
  const statusColor = allPassed
    ? "text-emerald-400"
    : summary.failed > summary.passed
      ? "text-red-400"
      : "text-amber-400";

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-slate-500" />
        ) : (
          <ChevronRight className="h-3 w-3 text-slate-500" />
        )}
        <StatusIcon className={`h-4 w-4 ${statusColor}`} />
        <span className="text-xs text-slate-300">
          Assertions: {summary.passed}/{summary.total} passed
        </span>
        {summary.failed > 0 && (
          <span className="ml-auto rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-400">
            {summary.failed} failed
          </span>
        )}
      </button>
      {expanded && (
        <div className="border-t border-slate-700/50 px-3 py-2 space-y-1">
          {summary.results.map((r) => (
            <div
              key={r.id}
              className={`flex items-start gap-2 rounded px-2 py-1 text-xs ${r.passed ? "bg-emerald-500/5" : "bg-red-500/5"}`}
            >
              <span
                className={`mt-0.5 shrink-0 ${r.passed ? "text-emerald-400" : "text-red-400"}`}
              >
                {r.passed ? "✓" : "✗"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-slate-300">{r.explanation}</p>
                {r.matchedValue && (
                  <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
                    Matched: {r.matchedValue}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-[10px] text-slate-600">
                {r.evaluationMs}ms
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
