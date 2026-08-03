// Recommended deep scans — Tier 2 of the sweep loop. Sweeps escalate a hot
// lens×context by writing an `escalation` outbox line; ingest turns NEW ones
// into `scan_sweep` findings with a `scan:escalation:` dedup key. Fresh
// escalations auto-dispatch on ingest (fleetSlice, bounded); this panel lists
// every OPEN escalation for manual (re)dispatch and hosts the auto toggle.
import { useEffect, useState } from 'react';
import { Crosshair, Play } from 'lucide-react';

import { listContexts, listIdeas, type DevIdea } from '@/api/devTools/devTools';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { isAutoDeepScanEnabled, setAutoDeepScanEnabled } from '@/lib/scanSweep';
import { silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';

import { presetByAgentKey } from '../../constants/presetSkills';

const ESCALATION_KEY_PREFIX = 'scan:escalation:';

interface RecoRow {
  idea: DevIdea;
  lens: string;
  contextName: string | null;
}

export function DeepScanRecommendations({ projectId, busy, onDispatch }: {
  projectId: string;
  busy: boolean;
  /** Fleet-dispatch a single-lens deep scan (`/scan-<lens> <context>`). */
  onDispatch: (skill: string, args: string) => void;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const [rows, setRows] = useState<RecoRow[]>([]);
  const [dispatched, setDispatched] = useState<Set<string>>(new Set());
  const [autoOn, setAutoOn] = useState(isAutoDeepScanEnabled);

  useEffect(() => {
    let alive = true;
    Promise.all([
      listIdeas(projectId, 'pending', undefined, 'scan_sweep', 100),
      listContexts(projectId).catch((e) => { silentCatch('deepScanReco contexts')(e); return []; }),
    ]).then(([ideas, contexts]) => {
      if (!alive) return;
      const nameById = new Map(contexts.map((c) => [c.id, c.name]));
      const built = ideas
        .filter((i) => i.dedup_key?.startsWith(ESCALATION_KEY_PREFIX))
        .map((i) => ({
          idea: i,
          lens: i.dedup_key!.split(':')[2] ?? '',
          contextName: i.context_id ? (nameById.get(i.context_id) ?? null) : null,
        }))
        .filter((r) => presetByAgentKey(r.lens) !== null);
      setRows(built);
    });
    return () => { alive = false; };
  }, [projectId]);

  if (rows.length === 0) return null;

  return (
    <section className="rounded-card border border-primary/12 bg-secondary/[0.12]" data-testid="deep-scan-recommendations">
      <div className="flex items-center gap-2 px-3 py-2 bg-primary/[0.04] border-b border-primary/10 rounded-t-card">
        <Crosshair className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
        <span className="typo-body font-semibold text-foreground">{d.skills_deep_reco_title}</span>
        <span className="ml-auto flex items-center gap-2 flex-shrink-0">
          <Tooltip content={d.skills_auto_deep_hint} placement="top">
            <span className="typo-label text-foreground/55">{d.skills_auto_deep_label}</span>
          </Tooltip>
          <AccessibleToggle
            checked={autoOn}
            onChange={() => { setAutoOn(!autoOn); setAutoDeepScanEnabled(!autoOn); }}
            label={d.skills_auto_deep_label}
            size="sm"
            data-testid="auto-deep-scan-toggle"
          />
        </span>
      </div>
      <ul className="px-3 py-1 max-h-48 overflow-y-auto">
        {rows.map(({ idea, lens, contextName }) => {
          const visual = presetByAgentKey(lens);
          const done = dispatched.has(idea.id);
          return (
            <li key={idea.id} className="flex items-center gap-2.5 py-1.5 border-b border-foreground/[0.08] last:border-b-0">
              {visual && (
                <span
                  className="inline-flex items-center justify-center w-4.5 h-4.5 rounded-interactive border flex-shrink-0"
                  style={{ color: visual.color, borderColor: `${visual.color}40`, backgroundColor: `${visual.color}14` }}
                >
                  <visual.icon className="w-2.5 h-2.5" aria-hidden strokeWidth={1.75} />
                </span>
              )}
              <span className="typo-caption font-medium text-foreground flex-shrink-0">{visual?.label ?? lens}</span>
              <span className="typo-label text-foreground/45 truncate flex-1 min-w-0">
                {contextName ?? '—'}{idea.description ? ` · ${idea.description}` : ''}
              </span>
              <button
                type="button"
                onClick={() => {
                  onDispatch(`scan-${lens}`, contextName ?? '');
                  setDispatched((prev) => new Set(prev).add(idea.id));
                }}
                disabled={busy || done}
                title={d.skills_deep_reco_run}
                aria-label={d.skills_deep_reco_run}
                className="p-1 rounded-interactive text-primary hover:bg-primary/10 border border-primary/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                data-testid={`deep-scan-run-${idea.id}`}
              >
                {done
                  ? <span className="typo-label text-status-info px-0.5">{d.skills_pipeline_dispatched}</span>
                  : <Play className="w-3.5 h-3.5" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
