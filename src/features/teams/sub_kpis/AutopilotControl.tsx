/**
 * AutopilotControl — the cockpit's single per-project autonomy switch
 * (docs/plans/kpi-driven-orchestration.md, direction D2). One legible 4-level
 * control over a project's KPI → goal → team loop, replacing a hunt through a
 * dozen global `autonomous_*` setting keys:
 *
 *   Off      — nothing runs automatically
 *   Measure  — measures this project's KPIs on schedule
 *   Suggest  — + derives goals when a KPI goes off-track (you hand them off)
 *   Full     — + ships those goals through the team automatically
 *
 * Self-contained (loads + persists its own state via the autopilot API) so any
 * surface — Teams › KPIs here, the Factory later — can drop it in with just a
 * `projectId`. The mode→capability matrix it advertises is enforced in
 * `engine/autopilot.rs`; keep the copy below in sync with that matrix.
 */
import { useEffect, useState } from 'react';
import { Power, Activity, Lightbulb, Rocket, type LucideIcon } from 'lucide-react';

import { getAutopilotMode, setAutopilotMode, type AutopilotMode } from '@/api/devTools/autopilot';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import { toastCatch } from '@/lib/silentCatch';

interface ModeMeta {
  mode: AutopilotMode;
  icon: LucideIcon;
  label: (t: Translations) => string;
  desc: (t: Translations) => string;
  accent: string;
}

const MODES: ModeMeta[] = [
  { mode: 'off', icon: Power, label: (t) => t.kpis.autopilot_off, desc: (t) => t.kpis.autopilot_off_desc, accent: 'var(--muted-foreground)' },
  { mode: 'measure', icon: Activity, label: (t) => t.kpis.autopilot_measure, desc: (t) => t.kpis.autopilot_measure_desc, accent: 'var(--primary)' },
  { mode: 'suggest', icon: Lightbulb, label: (t) => t.kpis.autopilot_suggest, desc: (t) => t.kpis.autopilot_suggest_desc, accent: 'var(--status-warning)' },
  { mode: 'full', icon: Rocket, label: (t) => t.kpis.autopilot_full, desc: (t) => t.kpis.autopilot_full_desc, accent: 'var(--status-success)' },
];

export function AutopilotControl({ projectId, className }: { projectId: string; className?: string }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<AutopilotMode>('off');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    getAutopilotMode(projectId)
      .then((m) => { if (!cancelled) setMode(m ?? 'off'); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const select = async (next: AutopilotMode) => {
    if (next === mode || busy) return;
    const prev = mode;
    setMode(next);
    setBusy(true);
    try {
      await setAutopilotMode(projectId, next);
    } catch (e) {
      setMode(prev);
      toastCatch('Failed to set autopilot mode')(e);
    } finally {
      setBusy(false);
    }
  };

  const active = MODES.find((m) => m.mode === mode) ?? MODES[0]!;

  return (
    <div className={className}>
      <span className="block typo-label text-foreground/60 mb-1.5">{t.kpis.autopilot_label}</span>
      <div role="radiogroup" aria-label={t.kpis.autopilot_label} className="inline-flex rounded-interactive border border-primary/15 bg-secondary/20 p-0.5">
        {MODES.map((m) => {
          const Icon = m.icon;
          const isActive = m.mode === mode;
          return (
            <button
              key={m.mode}
              type="button"
              role="radio"
              aria-checked={isActive}
              disabled={busy}
              onClick={() => select(m.mode)}
              title={m.desc(t)}
              className={`inline-flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 typo-caption transition-colors disabled:opacity-60 ${
                isActive ? 'bg-background shadow-elevation-1' : 'text-foreground/55 hover:text-foreground/80'
              }`}
              style={isActive ? { color: m.accent } : undefined}
            >
              <Icon className="w-3.5 h-3.5" /> {m.label(t)}
            </button>
          );
        })}
      </div>
      <p className="typo-caption text-foreground/60 mt-1.5 max-w-md">{active.desc(t)}</p>
    </div>
  );
}
