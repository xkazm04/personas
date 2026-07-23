// KPI simulation control (docs/plans/kpi-simulation-skill.md P1/P2) — the
// dispatch end of the long Dev-runner operation. One button: prepare the
// grounding snapshot → spawn a Fleet Claude Code session in the managed repo
// (key `kpi-sim:<project>`) with the self-contained doctrine prompt. While the
// session lives, a state-tinted terminal icon opens the shared terminal modal;
// when it exits, the results are auto-ingested (P2) — with a manual import
// fallback for runs finished while the app was closed.
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlaskConical, FolderInput, TerminalSquare } from 'lucide-react';

import { kpiSimIngest, kpiSimPrepare, type KpiSimIngestSummary } from '@/api/devTools/kpis';
import { listSessions } from '@/api/fleet/fleet';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { PASSPORT_FLEET_INK, PassportTerminalModal, dispatchRowToFleet } from '@/features/teams/sub_factory/passport/passportFleet';
import { buildKpiSimPrompt, kpiSimDispatchKey, type KpiSimMode } from './kpiSimPrompt';

export function KpiSimControl({ projectId, onIngested }: {
  projectId: string;
  /** Refresh KPIs + trends after a successful ingest. */
  onIngested?: () => void;
}) {
  const { t, tx } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const projects = useSystemStore((s) => s.projects);
  const project = projects.find((p) => p.id === projectId) ?? null;

  const [mode, setMode] = useState<KpiSimMode>('l1');
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<FleetSession | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  // Auto-ingest fires exactly once per observed running→gone transition.
  const wasLive = useRef(false);
  const ingesting = useRef(false);

  const key = kpiSimDispatchKey(projectId);

  const ingest = useCallback((auto: boolean) => {
    if (ingesting.current) return;
    ingesting.current = true;
    kpiSimIngest(projectId)
      .then((s: KpiSimIngestSummary) => {
        addToast(
          tx(t.kpis.sim_ingested_toast, {
            measurements: s.measurements_recorded,
            proposals: s.proposals_created,
            findings: s.findings_created,
          }),
          'success',
        );
        if (s.skipped.length > 0) addToast(tx(t.kpis.sim_skipped_toast, { count: s.skipped.length }), 'warning');
        onIngested?.();
      })
      .catch(auto
        // A finished session without a result file (aborted run) is normal on
        // the auto path — stay quiet; the manual import reports loudly.
        ? silentCatch('kpiSim:auto-ingest')
        : toastCatch('kpiSim:ingest'))
      .finally(() => { ingesting.current = false; });
  }, [projectId, addToast, tx, t, onIngested]);

  // Poll the fleet registry for this project's sim session (5s, same cadence
  // as the passport wall). Exited/vanished after being live → auto-ingest.
  useEffect(() => {
    let alive = true;
    wasLive.current = false;
    const poll = () => {
      listSessions()
        .then((snap) => {
          if (!alive) return;
          const s = snap.sessions.find((x) => x.name === key) ?? null;
          const liveNow = s !== null && s.state !== 'exited';
          if (wasLive.current && !liveNow) ingest(true);
          wasLive.current = liveNow;
          setSession(liveNow ? s : null);
        })
        .catch(silentCatch('kpiSim:poll'));
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [key, ingest]);

  const dispatch = async () => {
    if (!project) return;
    setBusy(true);
    try {
      const prep = await kpiSimPrepare(projectId);
      await dispatchRowToFleet(key, prep.root_path, buildKpiSimPrompt(project, mode));
      addToast(tx(t.kpis.sim_dispatched_toast, { count: prep.kpi_count }), 'success');
      wasLive.current = true;
    } catch (e) {
      toastCatch('kpiSim:dispatch')(e);
    } finally {
      setBusy(false);
    }
  };

  const ink = session ? (PASSPORT_FLEET_INK[String(session.state)] ?? 'rgba(148,163,184,.6)') : null;

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="kpi-sim-control">
      <button
        type="button"
        onClick={session ? () => setTerminalOpen(true) : dispatch}
        disabled={busy || !project}
        className="inline-flex items-center gap-1.5 typo-caption font-medium rounded-interactive border border-primary/25 bg-primary/10 text-primary px-2.5 py-1 hover:bg-primary/20 disabled:opacity-50 transition-colors focus-ring"
        data-testid="kpi-sim-button"
      >
        {session && ink ? (
          <TerminalSquare
            className={`w-3.5 h-3.5 ${session.state === 'running' || session.state === 'spawning' ? 'animate-pulse' : ''}`}
            style={{ color: ink }}
            aria-hidden
          />
        ) : (
          <FlaskConical className="w-3.5 h-3.5" aria-hidden />
        )}
        {session ? t.kpis.sim_running : t.kpis.sim_button}
      </button>

      {!session && (
        <span className="inline-flex items-center gap-1">
          <ModeChip active={mode === 'l1'} onClick={() => setMode('l1')} label={t.kpis.sim_mode_l1} title={t.kpis.sim_mode_l1_hint} />
          <ModeChip active={mode === 'l1l2'} onClick={() => setMode('l1l2')} label={t.kpis.sim_mode_l1l2} title={t.kpis.sim_mode_l1l2_hint} />
        </span>
      )}

      <button
        type="button"
        onClick={() => ingest(false)}
        title={t.kpis.sim_import_hint}
        className="inline-flex items-center gap-1 typo-caption text-foreground/70 hover:text-foreground rounded-interactive px-1.5 py-1 hover:bg-primary/5 transition-colors focus-ring"
        data-testid="kpi-sim-import"
      >
        <FolderInput className="w-3.5 h-3.5" aria-hidden />
        {t.kpis.sim_import}
      </button>

      {terminalOpen && session && (
        <PassportTerminalModal sessionId={session.id} session={session} onClose={() => setTerminalOpen(false)} />
      )}
    </div>
  );
}

function ModeChip({ active, onClick, label, title }: { active: boolean; onClick: () => void; label: string; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`typo-label rounded-interactive border px-2 py-0.5 transition-colors focus-ring ${
        active
          ? 'border-primary/50 bg-primary/15 text-foreground'
          : 'border-primary/15 bg-secondary/20 text-foreground/70 hover:bg-secondary/40'
      }`}
    >
      {label}
    </button>
  );
}