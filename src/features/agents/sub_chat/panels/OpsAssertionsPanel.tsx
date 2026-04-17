import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, CheckCircle2, XCircle, RotateCcw, ToggleLeft, ToggleRight } from 'lucide-react';
import { listOutputAssertions, updateOutputAssertion } from '@/api/agents/outputAssertions';
import { useTranslation } from '@/i18n/useTranslation';

interface AssertionRow {
  id: string;
  name: string;
  assertion_type: string;
  severity: string;
  enabled: boolean;
}

const SEVERITY_COLORS: Record<string, string> = {
  error: 'text-red-400 bg-red-500/10 border-red-500/25',
  warning: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
  info: 'text-blue-400 bg-blue-500/10 border-blue-500/25',
};

export default function OpsAssertionsPanel({ personaId }: { personaId: string }) {
  const { t, tx } = useTranslation();
  const [assertions, setAssertions] = useState<AssertionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAssertions = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listOutputAssertions(personaId);
      setAssertions(list.map((a) => ({
        id: a.id,
        name: a.name,
        assertion_type: a.assertionType,
        severity: a.severity,
        enabled: a.enabled,
      })));
    } catch {
      setAssertions([]);
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  useEffect(() => { fetchAssertions(); }, [fetchAssertions]);

  const handleToggle = useCallback(async (id: string, currentEnabled: boolean) => {
    // Optimistic update
    setAssertions((prev) => prev.map((a) => a.id === id ? { ...a, enabled: !currentEnabled } : a));
    try {
      await updateOutputAssertion({ id, enabled: !currentEnabled });
    } catch {
      // Revert on failure
      setAssertions((prev) => prev.map((a) => a.id === id ? { ...a, enabled: currentEnabled } : a));
    }
  }, []);

  const enabledCount = assertions.filter((a) => a.enabled).length;
  const totalCount = assertions.length;

  return (
    <div className="p-3 space-y-3" data-testid="ops-assertions-panel">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="typo-label text-foreground">{t.agents.ops.assertions}</h3>
        <button
          onClick={fetchAssertions}
          className="p-1 rounded-input text-foreground hover:text-muted-foreground/70 hover:bg-primary/5 transition-colors"
          title={t.common.refresh}
          aria-label={t.agents.ops_assertions.refresh_assertions}
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      </div>

      {/* Summary */}
      {totalCount > 0 && (
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-card bg-secondary/20">
          <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-xs text-foreground font-medium">
            {tx(t.agents.ops_assertions.active_count, { enabled: enabledCount, total: totalCount })}
          </span>
        </div>
      )}

      {/* Assertions list */}
      <div className="space-y-1">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : assertions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-4">
            <ShieldCheck className="w-6 h-6 text-foreground" />
            <p className="text-xs text-foreground text-center">{t.agents.ops_assertions.no_assertions}</p>
          </div>
        ) : (
          assertions.map((assertion) => {
            const sevStyle = SEVERITY_COLORS[assertion.severity] ?? SEVERITY_COLORS['info']!;
            return (
              <div
                key={assertion.id}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-card transition-colors ${
                  assertion.enabled ? 'bg-secondary/20' : 'bg-secondary/10 opacity-50'
                }`}
                data-testid={`ops-assertion-${assertion.id}`}
              >
                {assertion.enabled ? (
                  <CheckCircle2 className="w-3 h-3 flex-shrink-0 text-emerald-400" />
                ) : (
                  <XCircle className="w-3 h-3 flex-shrink-0 text-foreground" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{assertion.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-input border ${sevStyle}`}>
                      {assertion.severity}
                    </span>
                    <span className="text-[10px] text-foreground">{assertion.assertion_type}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleToggle(assertion.id, assertion.enabled)}
                  className="flex-shrink-0 p-0.5 rounded transition-colors hover:bg-primary/5"
                  title={assertion.enabled ? t.common.disabled : t.common.enabled}
                  aria-label={tx(assertion.enabled ? t.agents.ops_assertions.disable_assertion : t.agents.ops_assertions.enable_assertion, { name: assertion.name })}
                >
                  {assertion.enabled ? (
                    <ToggleRight className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <ToggleLeft className="w-5 h-5 text-foreground" />
                  )}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
