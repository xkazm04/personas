import { useState, useEffect, useRef, useCallback } from 'react';
import { Zap, ChevronDown } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { managementFetch } from '@/api/system/managementApiAuth';
import { silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { Slider } from '@/features/shared/components/forms/Slider';
import { ModelToggleGrid } from '../../shared';

const WEEKLY_CRON = '0 2 * * 0';
const DAILY_CRON = '0 2 * * *';

type Frequency = 'daily' | 'weekly';

/** The cron's 5th field (day-of-week): '*' means every day → daily, otherwise weekly. */
function cronToFrequency(cron: string): Frequency {
  return cron.trim().split(/\s+/)[4] === '*' ? 'daily' : 'weekly';
}

interface AutoOptimizeState {
  enabled: boolean;
  cron: string;
  minScore: number;
  models: Set<string>;
}

/**
 * Configuration popover for a persona's scheduled auto-optimization. Surfaces
 * the schedule / score-threshold / model knobs the management API has always
 * accepted but the old binary pill kept hidden (it hard-coded weekly·sonnet·80).
 */
export function AutoOptimizeConfig() {
  const { t } = useTranslation();
  const persona = useAgentStore((s) => s.selectedPersona);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [cfg, setCfg] = useState<AutoOptimizeState>({
    enabled: false, cron: WEEKLY_CRON, minScore: 80, models: new Set(['sonnet']),
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | null>(null);

  // Load the persisted config when the selected persona changes.
  useEffect(() => {
    if (!persona) return;
    let cancelled = false;
    setLoaded(false);
    (async () => {
      try {
        const resp = await managementFetch(`/api/settings/auto-optimize/${persona.id}`);
        if (resp.ok && !cancelled) {
          const c = (await resp.json())?.data;
          if (c) setCfg({
            enabled: !!c.enabled,
            cron: typeof c.cron === 'string' ? c.cron : WEEKLY_CRON,
            minScore: typeof c.min_score === 'number' ? c.min_score : 80,
            models: new Set(Array.isArray(c.models) && c.models.length ? c.models : ['sonnet']),
          });
        }
      } catch (err) {
        silentCatch('features/agents/sub_lab/components/shared/AutoOptimizeConfig:load')(err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [persona]);

  // Debounced persist — coalesces rapid slider / model edits into one POST.
  const save = useCallback((next: AutoOptimizeState) => {
    if (!persona) return;
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      managementFetch(`/api/settings/auto-optimize/${persona.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: next.enabled, cron: next.cron,
          min_score: next.minScore, models: [...next.models],
        }),
      }).catch(silentCatch('features/agents/sub_lab/components/shared/AutoOptimizeConfig:save'));
    }, 450);
  }, [persona]);

  const update = useCallback((patch: Partial<AutoOptimizeState>) => {
    setCfg((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, [save]);

  const toggleModel = (id: string) => {
    const next = new Set(cfg.models);
    if (next.has(id)) next.delete(id); else next.add(id);
    update({ models: next });
  };

  // Dismiss on outside-click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!persona) return null;

  const frequency = cronToFrequency(cfg.cron);

  return (
    <div className="relative" ref={containerRef}>
      <button
        data-testid="auto-optimize-toggle"
        onClick={() => setOpen((o) => !o)}
        disabled={!loaded}
        aria-expanded={open}
        title={cfg.enabled ? t.agents.lab.auto_optimize_enabled : t.agents.lab.auto_optimize_disabled}
        className={`flex items-center gap-1.5 px-2.5 py-1 typo-caption font-medium rounded-card border transition-colors disabled:opacity-50 ${
          cfg.enabled
            ? 'bg-status-success/15 text-status-success border-status-success/30'
            : 'text-foreground hover:bg-secondary/30 border-primary/10 hover:border-primary/20'
        }`}
      >
        <Zap className={`w-3 h-3 ${cfg.enabled ? 'text-status-success' : ''}`} />
        {t.agents.lab.auto_optimize}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          data-testid="auto-optimize-config"
          className="absolute right-0 top-full mt-1.5 z-50 w-72 rounded-modal border border-primary/20 bg-secondary/95 backdrop-blur-sm shadow-elevation-3 p-3 space-y-3"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="typo-body font-medium text-foreground">{t.agents.lab.auto_optimize}</p>
            <AccessibleToggle
              checked={cfg.enabled}
              onChange={() => update({ enabled: !cfg.enabled })}
              label={t.agents.lab.auto_optimize}
              size="sm"
              data-testid="auto-optimize-enable"
            />
          </div>
          <p className="typo-caption text-foreground">{t.agents.lab.auto_optimize_hint}</p>

          {/* Schedule */}
          <div className="space-y-1.5">
            <label className="typo-caption font-medium text-foreground uppercase tracking-wider">{t.agents.lab.auto_optimize_schedule}</label>
            <div className="inline-flex items-center gap-0.5 p-0.5 rounded-card bg-secondary/30 border border-primary/[0.06] w-full">
              {([['weekly', WEEKLY_CRON], ['daily', DAILY_CRON]] as const).map(([freq, cron]) => (
                <button
                  key={freq}
                  onClick={() => update({ cron })}
                  disabled={!cfg.enabled}
                  data-testid={`auto-optimize-freq-${freq}`}
                  className={`flex-1 px-2 py-1 rounded-input typo-caption font-medium transition-colors disabled:opacity-40 ${
                    frequency === freq ? 'bg-primary/12 text-primary' : 'text-foreground hover:text-foreground/95'
                  }`}
                >
                  {freq === 'weekly' ? t.agents.lab.auto_optimize_weekly : t.agents.lab.auto_optimize_daily}
                </button>
              ))}
            </div>
          </div>

          {/* Min score threshold */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="typo-caption font-medium text-foreground uppercase tracking-wider">{t.agents.lab.auto_optimize_min_score_label}</label>
              <span className="typo-caption text-primary font-medium tabular-nums">{cfg.minScore}</span>
            </div>
            <Slider
              value={cfg.minScore}
              onChange={(v) => update({ minScore: v })}
              min={0}
              max={100}
              step={5}
              disabled={!cfg.enabled}
              ariaLabel={t.agents.lab.auto_optimize_min_score_label}
            />
          </div>

          {/* Models */}
          <div className={cfg.enabled ? '' : 'opacity-40 pointer-events-none'}>
            <ModelToggleGrid selectedModels={cfg.models} toggleModel={toggleModel} testIdPrefix="auto-optimize" />
          </div>
        </div>
      )}
    </div>
  );
}
