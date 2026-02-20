import { useState, useEffect, useCallback } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { DollarSign, AlertTriangle, TrendingUp, Loader2, RefreshCw } from 'lucide-react';
import * as api from '@/api/tauriApi';

function formatUsd(value: number): string {
  if (value < 0.01) return '$0.00';
  return `$${value.toFixed(2)}`;
}

function budgetStatus(spend: number, budget: number | null): { label: string; color: string } {
  if (!budget || budget <= 0) return { label: 'No limit', color: 'text-muted-foreground/50' };
  const ratio = spend / budget;
  if (ratio >= 1) return { label: 'Exceeded', color: 'text-red-400' };
  if (ratio >= 0.8) return { label: 'Warning', color: 'text-amber-400' };
  return { label: 'OK', color: 'text-emerald-400' };
}

function budgetBadgeClass(spend: number, budget: number | null): string {
  if (!budget || budget <= 0) return 'bg-secondary/60 text-muted-foreground/50 border-primary/15';
  const ratio = spend / budget;
  if (ratio >= 1) return 'bg-red-500/15 text-red-400 border-red-500/20';
  if (ratio >= 0.8) return 'bg-amber-500/15 text-amber-400 border-amber-500/20';
  return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
}

function progressBarColor(spend: number, budget: number | null): string {
  if (!budget || budget <= 0) return 'bg-muted-foreground/20';
  const ratio = spend / budget;
  if (ratio >= 1) return 'bg-red-500/60';
  if (ratio >= 0.8) return 'bg-amber-500/60';
  return 'bg-emerald-500/60';
}

function budgetProgressDetail(spend: number, budget: number | null): { text: string; color: string } {
  if (!budget || budget <= 0) {
    return { text: 'No budget limit set', color: 'text-muted-foreground/40' };
  }

  const ratio = (spend / budget) * 100;
  const delta = budget - spend;

  if (delta >= 0) {
    return {
      text: `${Math.min(100, ratio).toFixed(0)}% used · ${formatUsd(delta)} left`,
      color: ratio >= 80 ? 'text-amber-400/80' : 'text-emerald-400/80',
    };
  }

  return {
    text: `${ratio.toFixed(0)}% used · ${formatUsd(Math.abs(delta))} over`,
    color: 'text-red-400/80',
  };
}

export default function BudgetSettingsPage() {
  const personas = usePersonaStore((s) => s.personas);
  const updatePersona = usePersonaStore((s) => s.updatePersona);
  const [monthlySpend, setMonthlySpend] = useState<Record<string, number>>({});
  const [editingBudgets, setEditingBudgets] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [savingBudgetId, setSavingBudgetId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedBudgetId, setSavedBudgetId] = useState<string | null>(null);

  const fetchSpend = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const data = await api.getAllMonthlySpend();
      const map: Record<string, number> = {};
      for (const [personaId, spend] of data) {
        map[personaId] = spend;
      }
      setMonthlySpend(map);
    } catch (err) {
      console.error('Failed to fetch monthly spend:', err);
      setFetchError('Failed to load monthly spend. Try again.');
      setMonthlySpend({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSpend();
  }, [fetchSpend]);

  const totalSpend = Object.values(monthlySpend).reduce((sum, v) => sum + v, 0);

  const handleBudgetChange = (personaId: string, value: string) => {
    setEditingBudgets((prev) => ({ ...prev, [personaId]: value }));
  };

  const handleBudgetSubmit = async (personaId: string) => {
    const raw = editingBudgets[personaId];
    if (raw === undefined) return;
    const parsed = parseFloat(raw);
    const budget = isNaN(parsed) || parsed <= 0 ? null : parsed;
    setSaveError(null);
    setSavingBudgetId(personaId);
    try {
      await updatePersona(personaId, { max_budget_usd: budget });
      setEditingBudgets((prev) => {
        const next = { ...prev };
        delete next[personaId];
        return next;
      });
      setSavedBudgetId(personaId);
      setTimeout(() => {
        setSavedBudgetId((current) => (current === personaId ? null : current));
      }, 1600);
    } catch (err) {
      console.error('Failed to update budget:', err);
      setSaveError('Failed to save budget. Please retry.');
    } finally {
      setSavingBudgetId(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-foreground/90">Budget & Cost Management</h1>
        <p className="text-sm text-muted-foreground/50 mt-1">
          Monitor spending across personas and set monthly budget limits.
        </p>
      </div>

      {fetchError && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5">
          <div className="flex items-center gap-2 text-sm text-red-300">
            <AlertTriangle className="w-4 h-4" />
            {fetchError}
          </div>
          <button
            onClick={fetchSpend}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/25 px-2.5 py-1 text-xs text-red-200 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Retry
          </button>
        </div>
      )}

      {/* Monthly Spend Summary */}
      <div className="rounded-xl border border-primary/15 bg-secondary/30 p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-primary/70" />
          </div>
          <div>
            <div className="text-[11px] font-mono text-muted-foreground/40 uppercase tracking-wider">Total Monthly Spend</div>
            <div className="text-2xl font-mono text-foreground/90">
              {loading ? '...' : formatUsd(totalSpend)}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground/40">
          Aggregated cost from all persona executions this calendar month.
        </p>
      </div>

      {/* Persona Budget List */}
      <div className="space-y-3">
        <div className="text-[11px] font-mono text-muted-foreground/40 uppercase tracking-wider">
          Persona Budgets ({personas.length})
        </div>

        {saveError && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <AlertTriangle className="w-3.5 h-3.5" />
            {saveError}
          </div>
        )}

        {loading && (
          <div className="rounded-xl border border-primary/15 bg-secondary/30 p-4 text-sm text-muted-foreground/60">
            Loading current monthly spend…
          </div>
        )}

        {personas.length === 0 && (
          <div className="text-center py-12">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/40 border border-primary/15 flex items-center justify-center">
              <DollarSign className="w-6 h-6 text-muted-foreground/30" />
            </div>
            <p className="text-sm text-muted-foreground/50">No personas configured</p>
          </div>
        )}

        {personas.map((persona) => {
          const spend = monthlySpend[persona.id] ?? 0;
          const budget = persona.max_budget_usd;
          const status = budgetStatus(spend, budget);
          const ratio = budget && budget > 0 ? Math.min(spend / budget, 1) : 0;
          const progress = budgetProgressDetail(spend, budget);
          const isEditing = editingBudgets[persona.id] !== undefined;
          const editValue = isEditing ? editingBudgets[persona.id] : (budget?.toString() ?? '');

          return (
            <div
              key={persona.id}
              className="rounded-xl border border-primary/15 bg-secondary/30 p-4 space-y-3"
            >
              {/* Row 1: Name + Status */}
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-sm border border-primary/15"
                  style={{ backgroundColor: persona.color ? `${persona.color}20` : undefined }}
                >
                  {persona.icon || persona.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground/90 truncate">{persona.name}</div>
                  <div className="text-[11px] font-mono text-muted-foreground/40">
                    Spend: {formatUsd(spend)}
                    {budget && budget > 0 ? ` / ${formatUsd(budget)}` : ''}
                  </div>
                  <div className={`text-[11px] font-mono mt-0.5 ${progress.color}`}>
                    {progress.text}
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${budgetBadgeClass(spend, budget)}`}>
                  {status.label === 'Warning' && <AlertTriangle className="w-3 h-3" />}
                  {status.label === 'Exceeded' && <AlertTriangle className="w-3 h-3" />}
                  {status.label}
                </span>
              </div>

              {/* Progress Bar */}
              {budget && budget > 0 && (
                <div className="h-2 rounded-full overflow-hidden bg-secondary/60 border border-primary/10">
                  <div
                    className={`h-full rounded-full transition-all ${progressBarColor(spend, budget)}`}
                    style={{ width: `${ratio * 100}%` }}
                  />
                </div>
              )}

              {/* Budget Input */}
              <div className="flex items-center gap-2">
                <div className="text-[11px] font-mono text-muted-foreground/40 flex-shrink-0">
                  <DollarSign className="w-3 h-3 inline" /> Budget:
                </div>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="No limit"
                  value={editValue}
                  onChange={(e) => handleBudgetChange(persona.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleBudgetSubmit(persona.id);
                  }}
                  className="flex-1 px-2 py-1 rounded-lg bg-background/50 border border-primary/15 text-sm font-mono text-foreground/90 placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/30 transition-colors"
                />
                {isEditing && (
                  <button
                    onClick={() => handleBudgetSubmit(persona.id)}
                    disabled={savingBudgetId === persona.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/15 border border-primary/25 text-xs font-medium text-primary hover:bg-primary/25 disabled:opacity-60 transition-colors"
                  >
                    {savingBudgetId === persona.id && <Loader2 className="w-3 h-3 animate-spin" />}
                    {savingBudgetId === persona.id ? 'Saving...' : 'Save'}
                  </button>
                )}
                {!isEditing && savedBudgetId === persona.id && (
                  <span className="px-2 py-1 text-[11px] rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-emerald-300">
                    Saved
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
