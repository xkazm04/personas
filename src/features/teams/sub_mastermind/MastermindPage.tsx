// Mastermind — multi-project development canvas (Projects → Development).
// Live data: readiness passports (usePassportData) as islands, cross-project
// relations as edges, Factory KPI rollups as the KPI dimension, and open Fleet
// CLI sessions as clickable dock nodes per island. The Hex Mosaic is the final
// view mode (Grid Board and Inverse Grid prototypes retired).
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { GitFork, LifeBuoy } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { runScan } from '@/api/devTools/devTools';
import { projectWallSummary } from '@/api/devTools/milestones';
import { spawnSession } from '@/api/fleet/fleet';
import { listCredentials } from '@/api/vault/credentials';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { navigateToProcess } from '@/features/fleet/monitor/navigateToProcess';
import { useContextScanBackground } from '@/features/plugins/dev-tools/hooks/useContextScanBackground';
import { ProjectModal } from '@/features/plugins/dev-tools/sub_projects/ProjectModal';
import { FactoryDataProvider, useFactoryData } from '@/features/teams/sub_factory/factoryData';
import { buildCoverRoadmap } from '@/features/teams/sub_factory/passport/CoverRoadmap';
import { collectKpiAttention, groupKpis, kpiStatus } from '@/features/teams/sub_factory/factoryModel';
import { ImproveProvider } from '@/features/teams/sub_factory/passport/improve/ImproveContext';
import { DeployPopover } from '@/features/teams/sub_factory/passport/improve/DeployPopover';
import { ImprovePopover } from '@/features/teams/sub_factory/passport/improve/ImprovePopover';
import { useImproveEngine } from '@/features/teams/sub_factory/passport/improve/useImproveEngine';
import { usePassportData } from '@/features/teams/sub_factory/passport/usePassportData';
import { useAutoRescanOnFleetExit } from '@/features/teams/sub_factory/passport/useAutoRescanOnFleetExit';
import type { AppPassport } from '@/features/teams/sub_factory/passport/passportModel';
import { SkillsWorkbench } from '@/features/teams/sub_factory/passport/improve/SkillsWorkbench';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { EventName } from '@/lib/eventRegistry';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';

import { useTranslation } from '@/i18n/useTranslation';

import { isOngoing } from '@/features/teams/sub_goals/goalStatus';

import { CanvasToolbar } from './lib/CanvasToolbar';
import { DataHealthBar } from './lib/DataHealthBar';
import { DemoNotice } from './lib/DemoNotice';
import { deriveScene, type FamilyHealth, type KpiRollup } from './lib/deriveScene';
import { dimAction } from './lib/dimActions';
import { DispatchFleetModal } from './lib/DispatchFleetModal';
import { FleetPreviewPanel } from './lib/FleetPreviewPanel';
import { CategoryPopover } from './lib/CategoryPopover';
import type { CategoryNode } from './lib/dimCategories';
import { DimListPopover } from './lib/DimListPopover';
import { DIM_INK } from './lib/ink';
import { MastermindGoalsModal } from './lib/goals/MastermindGoalsModal';
import { KpiListPopover, type KpiListItem } from './lib/KpiListPopover';
import { IdeaScanPopover, type ScanParams } from './lib/IdeaScanPopover';
import { hydrateLayout, isLayoutHydrated, loadHidden, saveHidden } from './lib/layoutStore';
import { useAthenaPanels, useLayoutHidden, useLayoutPositions } from './lib/useLayout';
import { AthenaPanel } from './lib/AthenaPanel';
import { clearCanvasFocus, focusCanvasProject, useFocusedProjectSlug } from './lib/focusStore';
import { publishCanvasScene } from './lib/scenePublish';
import { openFactory, openSkillsManager } from './lib/navigate';
import { computeAttention } from './lib/liveState';
import { useSceneStore, type FamilyStatus } from './lib/sceneStore';
import { loadPositions, savePositions } from './lib/positions';
import { PersonaListPopover, type PersonaRow } from './lib/PersonaListPopover';
import { ProjectListSidebar } from './lib/ProjectListSidebar';
import { ProjectSidebar } from './lib/ProjectSidebar';
import type { CanvasMode, DimNode, FleetNode, IslandShip } from './lib/types';
import { MastermindHexMosaic } from './variants/MastermindHexMosaic';

/** Stable empty fallbacks — a fresh [] per island would defeat the identity cache. */
const EMPTY_FLEET: FleetNode[] = [];
const EMPTY_NAMES: string[] = [];
/** Stable empty KPI list — a fresh `[]` per render would remount the goals modal. */
const EMPTY_KPIS: KpiListItem[] = [];

/** Islands allowed to ADOPT changed content per pass (see hydration waves). */
const HYDRATE_WAVE = 6;

/** Normalize a path for cwd↔root matching (Windows separators, case, slash). */
const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');

/** The declared names behind a `stack-list` dimension. Read from the passport
 *  rather than split back out of the cell's joined `detail` string. */
function stackItems(passport: AppPassport | undefined, key: string): string[] {
  if (!passport) return EMPTY_NAMES;
  if (key === 'datalinks') return passport.stack.dataLinks ?? EMPTY_NAMES;
  if (key === 'support') return passport.stack.supportChannels ?? EMPTY_NAMES;
  return EMPTY_NAMES;
}

/** Header icon + ink per stack-list dimension — the same glyph its cell paints. */
const STACK_META = {
  datalinks: { icon: GitFork, titleKey: 'datalinks_title' },
  support: { icon: LifeBuoy, titleKey: 'support_title' },
} as const;

export default function MastermindPage() {
  // Factory data context feeds the KPI dimension (same rollup the Passport
  // wall's warning badges use — the two surfaces must agree on "off track").
  return (
    <FactoryDataProvider>
      <MastermindInner />
    </FactoryDataProvider>
  );
}

function MastermindInner() {
  const { t, tx } = useTranslation();
  const { passports, rawByProject, loading, error, reload, rescan, rescanning, rescanProject } = usePassportData();
  // R22 — a finished `passport:*` dispatch (island dim action, fleet dock)
  // auto-verifies via scoped rescan, same loop closure as the Factory wall.
  useAutoRescanOnFleetExit(rescanProject);
  const { projects: factoryProjects, error: factoryError, reload: factoryReload } = useFactoryData();
  const improve = useImproveEngine(rawByProject, reload);
  // Scene store — the single batched spine: cross-project relations (meta) +
  // idea scans, each fetched with ≤1 IPC and invalidated by event, not polled.
  // Each family carries a fetch STATUS so failures surface honestly.
  const meta = useSceneStore((s) => s.meta);
  const scans = useSceneStore((s) => s.scans);
  const sentry = useSceneStore((s) => s.sentry);
  const storeGoals = useSceneStore((s) => s.goals);
  const llmSpend = useSceneStore((s) => s.llmSpend);
  const metaStatus = useSceneStore((s) => s.metaStatus);
  const scansStatus = useSceneStore((s) => s.scansStatus);
  const sentryStatus = useSceneStore((s) => s.sentryStatus);
  const goalsStatus = useSceneStore((s) => s.goalsStatus);
  const llmSpendStatus = useSceneStore((s) => s.llmSpendStatus);
  const loadMeta = useSceneStore((s) => s.loadMeta);
  const loadScans = useSceneStore((s) => s.loadScans);
  const loadSentry = useSceneStore((s) => s.loadSentry);
  const loadGoals = useSceneStore((s) => s.loadGoals);
  const loadLlmSpend = useSceneStore((s) => s.loadLlmSpend);
  const invalidateScans = useSceneStore((s) => s.invalidateScans);
  const retryFailed = useSceneStore((s) => s.retryFailed);
  const [credentials, setCredentials] = useState<PersonaCredential[]>([]);
  const [mode, setMode] = useState<CanvasMode>('edit');
  // Durable layout hydrates once per session from the DB (async IPC). Until it
  // resolves the canvas is held back so CanvasShell's sync `useState(loadGroups)`
  // initializers read the hydrated doc, not an empty one. `isLayoutHydrated()`
  // is already true on remounts, so this only gates the first-ever mount.
  const [layoutReady, setLayoutReady] = useState(isLayoutHydrated);
  // Positions come straight from the layout store (subscribed, not snapshotted)
  // so an out-of-band write paints without a remount and the next drag commit
  // builds on it instead of over it.
  const overrides = useLayoutPositions();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  // Slug whose "Dispatch Fleet…" instruction modal is open (null = closed).
  const [dispatchSlug, setDispatchSlug] = useState<string | null>(null);
  // Slug whose "Run a skill" modal is open (green Skills cell click; null = closed).
  const [skillRunSlug, setSkillRunSlug] = useState<string | null>(null);
  const [improvePopup, setImprovePopup] = useState<{ slug: string; rowKey: string; standards: boolean; anchor: DOMRect } | null>(null);
  const [scanPopup, setScanPopup] = useState<{ slug: string; x: number; y: number } | null>(null);
  // Projects with an idea scan WE dispatched still in flight. Per-project (a
  // scan for one project must not disable the popover for another), and each
  // entry carries a safety timeout so a missed terminal event can never wedge
  // the Ideas dimension until remount.
  const [busySlugs, setBusySlugs] = useState<ReadonlySet<string>>(new Set());
  const scanTimers = useRef(new Map<string, number>());
  const clearScanBusy = useCallback((slug: string) => {
    const timer = scanTimers.current.get(slug);
    if (timer !== undefined) { window.clearTimeout(timer); scanTimers.current.delete(slug); }
    setBusySlugs((prev) => {
      if (!prev.has(slug)) return prev;
      const next = new Set(prev);
      next.delete(slug);
      return next;
    });
  }, []);
  useEffect(() => {
    const timers = scanTimers.current;
    return () => { for (const id of timers.values()) window.clearTimeout(id); timers.clear(); };
  }, []);
  const [demoDismissed, setDemoDismissed] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const hiddenSlugs = useLayoutHidden();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [personaMenu, setPersonaMenu] = useState<{ slug: string; x: number; y: number } | null>(null);
  // Goals is a MODAL now (not an anchored popover) — the click point no longer
  // matters, only which project was clicked.
  const [goalSlug, setGoalSlug] = useState<string | null>(null);
  const [kpiPopup, setKpiPopup] = useState<{ slug: string; x: number; y: number } | null>(null);
  const [stackPopup, setStackPopup] = useState<{ slug: string; key: 'datalinks' | 'support'; x: number; y: number } | null>(null);
  const [dispatchGroup, setDispatchGroup] = useState<{ slugs: string[]; label: string } | null>(null);
  const [categoryPopup, setCategoryPopup] = useState<{ slug: string; category: CategoryNode; x: number; y: number } | null>(null);
  const { startBackgroundScan } = useContextScanBackground();
  // In-progress personas — same sources + persona→team→project join the
  // Monitor's project columns use (active processes attributed to personas).
  const agentPersonas = useAgentStore(useShallow((s) => s.personas));
  const fetchPersonaSummaries = useAgentStore((s) => s.fetchPersonaSummaries);
  const activeProcesses = useOverviewStore((s) => s.activeProcesses);
  useEffect(() => { void fetchPersonaSummaries(); }, [fetchPersonaSummaries]);
  const addToast = useToastStore((s) => s.addToast);
  const storeCreateProject = useSystemStore((s) => s.createProject);
  const storeUpdateProject = useSystemStore((s) => s.updateProject);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);

  // Fleet sessions: the live FLEET_SESSION_* listeners now register once at the
  // store level, so the canvas reflects state changes in <1s with NO poll —
  // just one snapshot fetch on mount to seed the store, then events keep it live.
  const sessions = useSystemStore(useShallow((s) => s.fleetSessions));
  const fleetRefresh = useSystemStore((s) => s.fleetRefresh);
  const fleetStartSessionListeners = useSystemStore((s) => s.fleetStartSessionListeners);
  const fleetSessionsError = useSystemStore((s) => s.fleetSessionsError);
  const projects = useSystemStore(useShallow((s) => s.projects));

  useEffect(() => {
    fleetStartSessionListeners();
    void fleetRefresh();
  }, [fleetRefresh, fleetStartSessionListeners]);

  // Batched scene spine: one relations + one scans + one goals fetch on mount.
  useEffect(() => {
    void loadMeta();
    void loadScans();
    void loadGoals();
  }, [loadMeta, loadScans, loadGoals]);

  // Ship-milestone chips: ONE batched wall-summary IPC for every real project,
  // reduced to the banner's next/shipped/late shape via the same roadmap
  // builder the passport wall uses (the two surfaces must agree on "next").
  const [shipByProject, setShipByProject] = useState<Map<string, IslandShip>>(new Map());
  useEffect(() => {
    const ids = passports.map((p) => p.identity.slug).filter((s) => !s.startsWith('demo-'));
    if (ids.length === 0) return;
    let live = true;
    projectWallSummary(ids)
      .then((rows) => {
        if (!live) return;
        const m = new Map<string, IslandShip>();
        for (const r of rows) {
          const vm = buildCoverRoadmap(r.milestones);
          if (vm.steps.length === 0) continue;
          m.set(r.projectId, {
            next: vm.next?.name ?? null,
            shipped: vm.shipped,
            total: vm.steps.length,
            late: vm.forecast?.late ?? false,
          });
        }
        setShipByProject(m);
      })
      .catch(silentCatch('mastermind projectWallSummary'));
    return () => { live = false; };
  }, [passports]);

  // Vault credentials — needed to resolve each project's bound monitoring
  // connector (Sentry) for live error counts. One fetch; refreshed with reload.
  useEffect(() => {
    let live = true;
    listCredentials().then((c) => { if (live) setCredentials(c); }).catch(silentCatch('mastermind listCredentials'));
    return () => { live = false; };
  }, []);

  // Live monitoring + LLM spend: fetch real error counts / 30d trace spend for
  // projects with the respective bound credentials. Both throttled in the
  // store (no new polling) — re-run when projects or credentials change.
  useEffect(() => {
    if (projects.length === 0) return;
    void loadSentry(projects, credentials);
    void loadLlmSpend(projects, credentials);
  }, [projects, credentials, loadSentry, loadLlmSpend]);

  // One-time layout hydration: read the durable doc from the DB, then re-seed
  // the state that was initialized from the (empty) pre-hydration doc and drop
  // the canvas gate. Runs at most once per session (guarded by layoutReady).
  useEffect(() => {
    if (layoutReady) return;
    let live = true;
    void hydrateLayout().then(() => {
      if (!live) return;
      // Hydration notifies every store subscriber, so positions/hidden re-read
      // themselves; this only drops the canvas gate.
      setLayoutReady(true);
    });
    return () => { live = false; };
  }, [layoutReady]);

  // A scan finishing anywhere (here or in the Idea Scanner page) refreshes the
  // freshness data. When WE dispatched it we know the project, so invalidate
  // only that project's rollup (scoped IPC); otherwise fall back to one batched
  // reload (still ≤1 IPC — the whole family is a single list call).
  const onScanStatus = useCallback((event: { payload: { status: string } }) => {
    const { status } = event.payload;
    if (status === 'completed' || status === 'completed_with_warning' || status === 'failed') {
      const pending = [...scanTimers.current.keys()];
      if (pending.length > 0) {
        for (const slug of pending) { void invalidateScans(slug); clearScanBusy(slug); }
      } else void loadScans();
    }
  }, [invalidateScans, loadScans, clearScanBusy]);
  useTauriEvent<{ job_id: string; status: string; error?: string }>(EventName.IDEA_SCAN_STATUS, onScanStatus);

  // Keyboard: E/G/C switch modes, Esc closes panels (the shell handles its own
  // Esc for half-drawn links/editors). Ignored while typing.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      if (e.key === 'Escape') { setOpenSlug(null); setPreviewId(null); }
      else if (e.key === 'e' || e.key === 'E') setMode('edit');
      else if (e.key === 'g' || e.key === 'G') setMode('group');
      else if (e.key === 'c' || e.key === 'C') setMode('connect');
      else if (e.key === 'n' || e.key === 'N') setMode('note');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const kpiByProject = useMemo(() => {
    const m = new Map<string, KpiRollup>();
    for (const p of factoryProjects) {
      m.set(p.id, { total: p.groups.reduce((s, g) => s + groupKpis(g).length, 0), off: collectKpiAttention(p).length });
    }
    return m;
  }, [factoryProjects]);

  // The KPI cell's colour says "something is off"; the popover has to say WHICH.
  // The rollup above keeps only counts (that's all the cell's derive needs), so
  // the list is projected separately from the same Factory projects — every KPI
  // reduced to the row shape KpiListPopover renders, worst-status first.
  const kpiListByProject = useMemo(() => {
    const m = new Map<string, KpiListItem[]>();
    for (const p of factoryProjects) {
      m.set(p.id, p.groups.flatMap(groupKpis).map((k) => ({
        id: k.id, name: k.name, status: kpiStatus(k),
        current: k.current, target: k.target, unit: k.unit,
      })));
    }
    return m;
  }, [factoryProjects]);

  // Session → project by longest cwd/root_path prefix match (a session has no
  // project_id; cwd doubles as the project key per FleetSession).
  const fleetByProject = useMemo(() => {
    const roots = projects.map((p) => ({ id: p.id, root: norm(p.root_path) })).filter((r) => r.root.length > 0);
    const m = new Map<string, FleetNode[]>();
    for (const s of sessions) {
      if (s.state === 'exited') continue;
      const cwd = norm(s.cwd);
      let best: { id: string; len: number } | null = null;
      for (const r of roots) {
        if ((cwd === r.root || cwd.startsWith(`${r.root}/`)) && (!best || r.root.length > best.len)) {
          best = { id: r.id, len: r.root.length };
        }
      }
      if (!best) continue;
      const node: FleetNode = { id: s.id, label: s.name ?? s.title ?? s.projectLabel, state: s.state };
      const list = m.get(best.id);
      if (list) list.push(node);
      else m.set(best.id, [node]);
    }
    return m;
  }, [sessions, projects]);

  // Running-persona names per project: process.personaId → persona →
  // home_team_id → dev project with that team_id.
  const personasByProject = useMemo(() => {
    const byId = new Map(agentPersonas.map((p) => [p.id, p]));
    const namesByTeam = new Map<string, string[]>();
    const seen = new Set<string>();
    for (const proc of Object.values(activeProcesses)) {
      if (proc.status !== 'running' || !proc.personaId || seen.has(proc.personaId)) continue;
      seen.add(proc.personaId);
      const persona = byId.get(proc.personaId);
      const team = persona?.home_team_id;
      if (!persona || !team) continue;
      const list = namesByTeam.get(team);
      if (list) list.push(persona.name);
      else namesByTeam.set(team, [persona.name]);
    }
    const m = new Map<string, string[]>();
    for (const proj of projects) {
      if (proj.team_id && namesByTeam.has(proj.team_id)) m.set(proj.id, namesByTeam.get(proj.team_id)!);
    }
    return m;
  }, [agentPersonas, activeProcesses, projects]);

  // The popover needs more than the names the badge counts: live status,
  // elapsed time, and whether the process declares somewhere to navigate. Kept
  // as a separate map (like kpiListByProject) so `Island.personasRunning` stays
  // the plain name list the scene model and the render cache are built on.
  const personaRowsByProject = useMemo(() => {
    const byId = new Map(agentPersonas.map((p) => [p.id, p]));
    const rowsByTeam = new Map<string, PersonaRow[]>();
    const seen = new Set<string>();
    for (const proc of Object.values(activeProcesses)) {
      if (proc.status !== 'running' || !proc.personaId || seen.has(proc.personaId)) continue;
      seen.add(proc.personaId);
      const persona = byId.get(proc.personaId);
      const team = persona?.home_team_id;
      if (!persona || !team) continue;
      const row: PersonaRow = {
        personaId: proc.personaId,
        name: persona.name,
        status: proc.status,
        startedAt: proc.startedAt,
        navigable: Boolean(proc.navigateTo),
      };
      const list = rowsByTeam.get(team);
      if (list) list.push(row);
      else rowsByTeam.set(team, [row]);
    }
    const m = new Map<string, PersonaRow[]>();
    for (const proj of projects) {
      if (proj.team_id && rowsByTeam.has(proj.team_id)) m.set(proj.id, rowsByTeam.get(proj.team_id)!);
    }
    return m;
  }, [agentPersonas, activeProcesses, projects]);

  const ideaScanAt = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const [slug, rows] of scans) m.set(slug, rows[0]?.created_at ?? null);
    return m;
  }, [scans]);

  // Ongoing (not done) goal count per project — the Goals dimension payload.
  const goalsOngoingByProject = useMemo(() => {
    const m = new Map<string, number>();
    for (const [slug, rows] of storeGoals) {
      const n = rows.filter((g) => isOngoing(g.status)).length;
      if (n > 0) m.set(slug, n);
    }
    return m;
  }, [storeGoals]);

  // Family health → honest `unknown` cells: a hard-failed scans/KPI family
  // renders Ideas/KPI cells as "data unavailable" (muted), never a fake
  // "never scanned"/"absent". (A `stale` family keeps its last-good data.)
  const families = useMemo<FamilyHealth>(
    () => ({ scansUnknown: scansStatus === 'failed', kpiUnknown: Boolean(factoryError), goalsUnknown: goalsStatus === 'failed' }),
    [scansStatus, factoryError, goalsStatus],
  );
  const scene = useMemo(
    () => deriveScene(passports, meta, loading, kpiByProject, ideaScanAt, sentry, families, llmSpend, goalsOngoingByProject),
    [passports, meta, loading, kpiByProject, ideaScanAt, sentry, families, llmSpend, goalsOngoingByProject],
  );

  // Which data families are currently not clean (failed OR showing stale data).
  const bad = (s: string) => s === 'failed' || s === 'stale';
  const failedFamilies = useMemo(() => {
    const out: string[] = [];
    if (error) out.push(t.mastermind.family_passports);
    if (bad(metaStatus)) out.push(t.mastermind.family_relations);
    if (bad(scansStatus)) out.push(t.mastermind.family_scans);
    if (factoryError) out.push(t.mastermind.family_kpi);
    if (bad(sentryStatus)) out.push(t.mastermind.family_monitoring);
    if (fleetSessionsError) out.push(t.mastermind.family_fleet);
    return out;
  }, [error, metaStatus, scansStatus, factoryError, sentryStatus, fleetSessionsError, t]);

  const onRetryData = useCallback(() => {
    retryFailed();
    if (error) reload();
    if (factoryError) factoryReload();
    if (fleetSessionsError) void fleetRefresh();
  }, [retryFailed, error, reload, factoryError, factoryReload, fleetSessionsError, fleetRefresh]);
  // Saved positions + live fleet + per-dim Improve actionability overlay the
  // derived scene. Actionability mirrors the wall's ImproveCell checks, so a
  // canvas cell is clickable exactly when its wall row would show a gear.
  //
  // CONTENT-STABLE IDENTITY (optimizer pass): every input here churns object
  // identity — fleetByProject rebuilds all its arrays on every session event
  // (sub-second cadence while any CLI runs). Handing each memoized island a
  // fresh object every tick re-rendered the whole world once a second. The
  // cache below reuses the previous island object whenever that island's
  // actual inputs are unchanged, so a fleet tick re-renders only the island
  // whose dock changed.
  //
  // The base island is compared by CONTENT, not identity: `deriveScene` is a
  // pure rebuild, so each of the ~9 data families landing in its own microtask
  // on first mount (passport phases 0/1/2, relations, scans, goals, KPI,
  // monitoring, LLM spend) produced a brand-new object for EVERY island and
  // blew the cache on `base === i` — the whole world reconciled ~10× in the
  // first seconds. Most of those arrivals change one family's cells on a few
  // islands; a stringify per island (µs) is nothing against re-rendering
  // ~150 SVG nodes each (ms), so the comparison buys back the freeze.
  const passportBySlug = useMemo(() => new Map(passports.map((p) => [p.identity.slug, p])), [passports]);
  const islandCache = useRef(new Map<string, {
    baseKey: string; passport: unknown; raw: unknown;
    oX: number | undefined; oY: number | undefined;
    fleetKey: string; personasKey: string; busy: boolean; shipKey: string;
    out: (typeof scene.islands)[number];
  }>());
  // HYDRATION WAVES (staggered data adoption): the identity cache above stops
  // an island from re-rendering when its data DIDN'T change — but the first
  // seconds after mount are the opposite case. ~9 data families resolve in
  // quick succession (passport phases 0/1/2, ship, KPI, relations, scans,
  // monitoring, spend) and several of them touch EVERY island, so each arrival
  // still reconciled the whole world (~150 SVG nodes × N islands) in one
  // synchronous commit — the first-open lag. The budget below caps how many
  // islands may adopt CHANGED content per pass: the rest keep their previous
  // painted object (identical reference → memo skip, briefly stale by design)
  // and an rAF re-runs the memo until every island is current. A burst now
  // rolls across the canvas at HYDRATE_WAVE islands/frame instead of freezing
  // it. Single-island updates (drag commit, busy flag, one fleet tick) always
  // fit the first wave, so interactions stay same-frame.
  const [hydrateTick, forceHydrate] = useReducer((n: number) => n + 1, 0);
  const hydratePending = useRef(false);
  const positioned = useMemo(() => {
    void hydrateTick; // re-entry ticket for deferred adoptions below
    const cache = islandCache.current;
    let adopted = 0;
    const next = new Map<string, NonNullable<ReturnType<typeof cache.get>>>();
    const islands = scene.islands.map((i) => {
      const o = overrides[i.slug];
      const fleet = scene.demo ? i.fleet : fleetByProject.get(i.slug) ?? EMPTY_FLEET;
      const personasRunning = scene.demo ? i.personasRunning : personasByProject.get(i.slug) ?? EMPTY_NAMES;
      const passport = passportBySlug.get(i.slug);
      const raw = rawByProject.get(i.slug);
      const busy = busySlugs.has(i.slug);
      const ship = shipByProject.get(i.slug) ?? null;
      const fleetKey = fleet.map((f) => `${f.id}:${f.state}`).join('|');
      const personasKey = personasRunning.join('|');
      const shipKey = ship ? `${ship.next}|${ship.shipped}/${ship.total}|${ship.late}` : '';
      const baseKey = JSON.stringify(i);
      const c = cache.get(i.slug);
      if (c && c.baseKey === baseKey && c.passport === passport && c.raw === raw
        && c.oX === o?.x && c.oY === o?.y && c.fleetKey === fleetKey
        && c.personasKey === personasKey && c.busy === busy && c.shipKey === shipKey) {
        next.set(i.slug, c);
        return c.out;
      }
      // Changed, but over budget this pass — keep the stale painted entry for a
      // frame and reclaim it on the next tick. Brand-new islands (no prior
      // entry) can't be deferred: the shell's mount waves stagger those.
      if (c && adopted >= HYDRATE_WAVE) {
        hydratePending.current = true;
        next.set(i.slug, c);
        return c.out;
      }
      if (c) adopted += 1;
      const nodes = i.nodes.map((n) => {
        const decorated = {
          ...n,
          ...dimAction(n.key, passport, raw),
          ...(n.key === 'ideas' && busy ? { busy: true } : {}),
        };
        // A zero-count Goals cell has nothing to list — inert, no affordance.
        if (n.key === 'goals' && !(n.days && n.days > 0)) decorated.action = null;
        // Same for a project with no KPIs defined at all.
        if (n.key === 'kpi' && (kpiListByProject.get(i.slug)?.length ?? 0) === 0) decorated.action = null;
        // Declaration-only cells: nothing declared, nothing to list.
        if (decorated.action === 'stack-list' && stackItems(passport, n.key).length === 0) decorated.action = null;
        return decorated;
      });
      // Attention derives from the RESOLVED fleet (live for real projects, the
      // demo fleet for demo islands) — a needs-you marker the banner shows at
      // every zoom band.
      const attention = computeAttention(fleet);
      const out = { ...i, ...(o ? { x: o.x, y: o.y } : {}), fleet, personasRunning, nodes, attention, ship };
      const entry = { baseKey, passport, raw, oX: o?.x, oY: o?.y, fleetKey, personasKey, busy, shipKey, out };
      next.set(i.slug, entry);
      return out;
    });
    islandCache.current = next;
    return { ...scene, islands };
  }, [scene, overrides, fleetByProject, personasByProject, passportBySlug, rawByProject, busySlugs, kpiListByProject, shipByProject, hydrateTick]);

  // Drain deferred adoptions one animation frame at a time. Runs after every
  // commit (no dep array on purpose): whenever the pass above left islands on
  // stale content, the next frame re-enters it with a fresh budget.
  useEffect(() => {
    if (!hydratePending.current) return;
    hydratePending.current = false;
    const id = requestAnimationFrame(forceHydrate);
    return () => cancelAnimationFrame(id);
  });

  // Read-modify-write against the store (not a stale render closure) so a drag
  // that lands between someone else's write still merges rather than reverts.
  const onIslandCommit = (slug: string, x: number, y: number) =>
    savePositions({ ...loadPositions(), [slug]: { x, y } });

  // Sidebar hide/show filter — the canvas renders only visible islands; the
  // project list sees all of them.
  const canvasScene = useMemo(() => ({
    ...positioned,
    islands: positioned.islands.filter((i) => !hiddenSlugs.has(i.slug)),
  }), [positioned, hiddenSlugs]);

  // ── Publishing the scene for Athena ──────────────────────────────────────
  // WP2 reads `mastermind.scene.v1`; this is the only writer. Per-family load
  // STATUS travels with it because that is the one thing a Rust re-derive could
  // never know — a cell reading `unknown` because a fetch failed is a different
  // fact from a cell that is genuinely absent.
  const publishFamilies = useMemo<Record<string, FamilyStatus>>(() => ({
    passports: error ? 'failed' : loading ? 'loading' : 'loaded',
    relations: metaStatus,
    scans: scansStatus,
    sentry: sentryStatus,
    goals: goalsStatus,
    llmSpend: llmSpendStatus,
    kpi: factoryError ? 'failed' : 'loaded',
  }), [error, loading, metaStatus, scansStatus, sentryStatus, goalsStatus, llmSpendStatus, factoryError]);

  // `positioned`, not `canvasScene`: hiding an island is a view filter, and a
  // digest that silently drops projects the user tucked away would let her
  // report a portfolio that isn't the portfolio. The publisher debounces,
  // dedupes and refuses the demo scene itself.
  useEffect(() => {
    publishCanvasScene({ scene: positioned, families: publishFamilies, kpiByProject });
  }, [positioned, publishFamilies, kpiByProject]);

  // ── Athena's composed panel ──────────────────────────────────────────────
  // Persisted per project by the layout store; restored whenever that project
  // is the canvas focus target (her compose op sets it, and so does opening a
  // project from the canvas or the list).
  const athenaPanels = useAthenaPanels();
  const focusedSlug = useFocusedProjectSlug();
  const athenaPanel = focusedSlug ? athenaPanels[focusedSlug] ?? null : null;
  const openProject = useCallback((slug: string) => {
    setOpenSlug(slug);
    // No camera travel — the user just clicked the island, it is already there.
    focusCanvasProject(slug, false);
  }, []);
  const panelDispatchTarget = useMemo(() => {
    if (!focusedSlug) return undefined;
    const p = projects.find((x) => x.id === focusedSlug);
    return p?.root_path ? { projectId: p.id, projectName: p.name, rootPath: p.root_path } : undefined;
  }, [focusedSlug, projects]);

  const toggleVisible = (slug: string) => {
    const next = loadHidden();
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    saveHidden(next);
  };

  const previewSession = previewId ? sessions.find((s) => s.id === previewId) ?? null : null;
  const openIsland = openSlug ? positioned.islands.find((i) => i.slug === openSlug) ?? null : null;
  const openPassport = openSlug ? passports.find((p) => p.identity.slug === openSlug) ?? null : null;

  // Canvas cell → the same Improve popovers the Passport wall opens, anchored
  // at the click point (they flip/clamp against the window themselves). The
  // Ideas dimension opens the scan-dispatch popover instead.
  const onDimOpen = (slug: string, node: DimNode, e: React.MouseEvent) => {
    if (node.action === 'ideas') {
      setScanPopup({ slug, x: e.clientX, y: e.clientY });
      return;
    }
    if (node.action === 'goals') {
      setGoalSlug(slug);
      return;
    }
    if (node.action === 'stack-list' && (node.key === 'datalinks' || node.key === 'support')) {
      setStackPopup({ slug, key: node.key, x: Math.min(e.clientX, window.innerWidth - 260), y: Math.min(e.clientY + 10, window.innerHeight - 300) });
      return;
    }
    if (node.action === 'kpi') {
      setKpiPopup({ slug, x: Math.min(e.clientX, window.innerWidth - 284), y: Math.min(e.clientY + 10, window.innerHeight - 320) });
      return;
    }
    // Green Skills cell — run an installed skill via a background Fleet session.
    if (node.action === 'skills-run') {
      setSkillRunSlug(slug);
      return;
    }
    if (!node.action || !node.rowKey) return;
    setImprovePopup({ slug, rowKey: node.rowKey, standards: node.action === 'standards', anchor: new DOMRect(e.clientX, e.clientY, 1, 1) });
  };

  // Persona rows for one island. Demo islands have names but no processes
  // behind them, so they degrade to inert name-only rows.
  const personaRows = (slug: string): PersonaRow[] => {
    const live = personaRowsByProject.get(slug);
    if (live) return live;
    const names = positioned.islands.find((i) => i.slug === slug)?.personasRunning ?? EMPTY_NAMES;
    return names.map((name) => ({ personaId: name, name, status: 'running', startedAt: null, navigable: false }));
  };

  // Row click → the process's own destination, through the Monitor's switch.
  const openPersona = (personaId: string) => {
    const proc = Object.values(activeProcesses).find((p) => p.personaId === personaId && p.navigateTo);
    if (proc) navigateToProcess(proc, () => setPersonaMenu(null));
  };

  // Island context-menu "Open terminal": a project can host one when it's a real
  // (non-demo) project with a folder path. slug === dev-tools project id.
  const canOpenTerminal = useCallback(
    (slug: string) => !slug.startsWith('demo-') && Boolean(projects.find((p) => p.id === slug)?.root_path),
    [projects],
  );

  // Spawn a plain interactive Fleet session in the project root (no prompt) and
  // open its preview immediately; the next fleet poll docks it in the badges.
  const openTerminal = useCallback(async (slug: string) => {
    const root = projects.find((p) => p.id === slug)?.root_path;
    if (!root) return;
    try {
      const id = await spawnSession(root);
      setPreviewId(id);
      void fleetRefresh();
    } catch (err) {
      toastCatch('mastermind spawn terminal')(err);
    }
  }, [projects, fleetRefresh]);

  // "Dispatch Fleet…" — seed a BACKGROUND session in the project root with the
  // user's instruction and stay on the canvas (no preview panel): the session
  // docks as an island fleet badge, reachable later like any other. Rejects on
  // failure so the modal stays open and re-enables its button.
  const dispatchFleet = useCallback(async (slug: string, instruction: string) => {
    const project = projects.find((p) => p.id === slug);
    if (!project?.root_path) return;
    try {
      await spawnSession(project.root_path, [instruction]);
      void fleetRefresh();
      addToast(tx(t.mastermind.dispatch_toast, { name: project.name }), 'success');
    } catch (err) {
      addToast(t.mastermind.dispatch_error, 'error');
      toastCatch('mastermind dispatch fleet')(err);
      throw err;
    }
  }, [projects, fleetRefresh, addToast, tx, t]);

  // Dispatch a PARAMETRIZED idea scan for the popup's project through the
  // canonical recorded pipeline (writes the DevScan row the freshness reads).
  // The popover shapes the run — agent combination, context scope, target
  // findings — and every knob maps 1:1 onto run_scan's own parameters.
  const runIdeaScan = async ({ agentKeys, contextIds, targetCount }: ScanParams) => {
    if (!scanPopup || busySlugs.has(scanPopup.slug) || agentKeys.length === 0) return;
    const slug = scanPopup.slug;
    setBusySlugs((prev) => new Set(prev).add(slug));
    // Safety net: if the terminal IDEA_SCAN_STATUS event never reaches us,
    // release the project after 3 minutes instead of wedging its Ideas cell.
    scanTimers.current.set(slug, window.setTimeout(() => clearScanBusy(slug), 180_000));
    const label = agentKeys.length === 1 ? agentKeys[0] : `${agentKeys.length} agents`;
    useOverviewStore.getState().processStarted(
      'idea_scan',
      undefined,
      `Idea Scan (${label})`,
      { section: 'plugins', tab: 'skills' },
    );
    try {
      await runScan(slug, agentKeys, {
        // Empty scope = whole project, which is exactly what run_scan expects.
        contextIds: contextIds.length > 0 ? contextIds : undefined,
        targetCount: targetCount ?? undefined,
      });
      addToast(`Idea scan dispatched (${label})`, 'success');
      void invalidateScans(slug);
      setScanPopup(null);
    } catch (err) {
      useOverviewStore.getState().processEnded('idea_scan', 'failed');
      clearScanBusy(slug);
      toastCatch('mastermind idea scan')(err);
    }
  };

  // New project — same mechanism as the Projects manager (ProjectModal +
  // store create/update, path-dedup included).
  const handleCreateProject = async (data: { name: string; path: string; projectType: string; githubUrl: string; teamId: string | null; prCredentialId: string | null; testEnvUrl: string; testEnvBranch: string; mainBranch: string }) => {
    const existing = projects.find((p) => p.root_path === data.path);
    if (existing) return { id: existing.id };
    try {
      const project = await storeCreateProject(data.name, data.path, '', data.projectType, data.githubUrl || undefined, data.teamId ?? undefined);
      await storeUpdateProject(project.id, {
        teamId: data.teamId,
        prCredentialId: data.prCredentialId,
        testEnvUrl: data.testEnvUrl || null,
        testEnvBranch: data.testEnvBranch || null,
        mainBranch: data.mainBranch || null,
      });
      void fetchProjects();
      reload();
      return { id: project.id };
    } catch (err) {
      // Surface a Sentry breadcrumb rather than swallowing — the modal reads
      // `undefined` as "create failed" and keeps its form open.
      silentCatch('mastermind handleCreateProject')(err);
      return undefined;
    }
  };

  return (
    <ImproveProvider value={improve}>
    <div className="relative h-[calc(100dvh-120px)] min-h-[480px] overflow-hidden rounded-card border border-primary/[0.08]" data-testid="mastermind-page">
      {/* Hold the canvas back until the durable layout doc has hydrated (so the
          variant's sync layout initializers read the persisted doc) AND the
          first passport load has resolved — an empty world during the fetch
          reads as "you have nothing", not "loading". */}
      {layoutReady && !(loading && passports.length === 0) ? (
        <MastermindHexMosaic
          scene={canvasScene}
          mode={mode}
          onIslandCommit={onIslandCommit}
          onFleetOpen={setPreviewId}
          onProjectOpen={openProject}
          onShipOpen={(slug) => openFactory(slug, 'ship')}
          onFactoryOpen={(slug) => openFactory(slug, 'overview')}
          onSkillsOpen={openSkillsManager}
          onDimOpen={onDimOpen}
          onPersonasOpen={(slug, e) => setPersonaMenu({ slug, x: Math.min(e.clientX, window.innerWidth - 244), y: Math.min(e.clientY + 10, window.innerHeight - 280) })}
          onCategoryOpen={(slug, category, e) => setCategoryPopup({ slug, category, x: Math.min(e.clientX, window.innerWidth - 300), y: Math.min(e.clientY + 10, window.innerHeight - 320) })}
          onOpenTerminal={openTerminal}
          onDispatchFleet={setDispatchSlug}
          onDispatchGroupFleet={(slugs, label) => setDispatchGroup({ slugs, label })}
          canOpenTerminal={canOpenTerminal}
        />
      ) : (
        <LoadingSpinner label={layoutReady ? t.mastermind.loading_projects : t.mastermind.loading_layout} />
      )}

      <ProjectListSidebar
        islands={positioned.islands}
        hidden={hiddenSlugs}
        open={projectsOpen}
        onOpenToggle={() => setProjectsOpen((v) => !v)}
        onToggleVisible={toggleVisible}
        onNewProject={() => setNewProjectOpen(true)}
        onProjectOpen={openProject}
      />

      <CanvasToolbar mode={mode} onModeChange={setMode} />

      {previewId && (
        <FleetPreviewPanel sessionId={previewId} session={previewSession} onClose={() => setPreviewId(null)} />
      )}

      {/* One right dock, two contents: a composed panel takes precedence over
          the passport sidebar (both are project-scoped, and stacking them would
          bury hers under his). Closing the panel reveals the sidebar again. */}
      <AnimatePresence>
        {athenaPanel && focusedSlug && (
          <AthenaPanel
            key="athena-panel"
            target={{ kind: 'project', slug: focusedSlug }}
            panel={athenaPanel}
            projectName={positioned.islands.find((i) => i.slug === focusedSlug)?.name ?? focusedSlug}
            dispatchTarget={panelDispatchTarget}
            onClose={clearCanvasFocus}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {openIsland && !athenaPanel && (
          <ProjectSidebar
            key="project-sidebar"
            passport={openPassport}
            name={openIsland.name}
            onClose={() => setOpenSlug(null)}
            onOpenFactory={() => openFactory(openIsland.slug, 'overview')}
            onOpenShip={() => openFactory(openIsland.slug, 'ship')}
            onOpenSkills={() => openSkillsManager(openIsland.slug)}
          />
        )}
      </AnimatePresence>

      {personaMenu && (
        <PersonaListPopover
          rows={personaRows(personaMenu.slug)}
          x={personaMenu.x}
          y={personaMenu.y}
          onOpen={openPersona}
          onClose={() => setPersonaMenu(null)}
        />
      )}

      {goalSlug && (
        <MastermindGoalsModal
          slug={goalSlug}
          projectName={positioned.islands.find((i) => i.slug === goalSlug)?.name ?? goalSlug}
          kpis={kpiListByProject.get(goalSlug) ?? EMPTY_KPIS}
          onClose={() => setGoalSlug(null)}
        />
      )}

      {categoryPopup && (
        <CategoryPopover
          category={categoryPopup.category}
          x={categoryPopup.x}
          y={categoryPopup.y}
          onDimOpen={(node, e) => onDimOpen(categoryPopup.slug, node, e)}
          onClose={() => setCategoryPopup(null)}
        />
      )}

      {stackPopup && (() => {
        const meta = STACK_META[stackPopup.key];
        const node = positioned.islands.find((i) => i.slug === stackPopup.slug)?.nodes.find((n) => n.key === stackPopup.key);
        return (
          <DimListPopover
            title={t.mastermind[meta.titleKey]}
            icon={meta.icon}
            ink={DIM_INK[node?.status ?? 'solid']}
            items={stackItems(passportBySlug.get(stackPopup.slug), stackPopup.key)}
            x={stackPopup.x}
            y={stackPopup.y}
            testId={`mm-stack-list-${stackPopup.key}`}
            onClose={() => setStackPopup(null)}
          />
        );
      })()}

      {kpiPopup && (
        <KpiListPopover
          items={kpiListByProject.get(kpiPopup.slug) ?? []}
          x={kpiPopup.x}
          y={kpiPopup.y}
          onClose={() => setKpiPopup(null)}
        />
      )}

      {dispatchSlug && (() => {
        const island = positioned.islands.find((i) => i.slug === dispatchSlug);
        return (
          <DispatchFleetModal
            name={island?.name ?? dispatchSlug}
            onDispatch={(instruction) => dispatchFleet(dispatchSlug, instruction)}
            onClose={() => setDispatchSlug(null)}
          />
        );
      })()}

      {dispatchGroup && (
        <DispatchFleetModal
          name={dispatchGroup.label || t.mastermind.group_untitled}
          targetCount={dispatchGroup.slugs.length}
          onDispatch={async (instruction) => {
            // Sequential on purpose: each spawn is a PTY + a Claude process, and
            // firing six at once is how a portfolio-wide dispatch becomes a
            // machine-wide stall. A failure surfaces and stops the rest.
            for (const slug of dispatchGroup.slugs) await dispatchFleet(slug, instruction);
          }}
          onClose={() => setDispatchGroup(null)}
        />
      )}

      {/* No `initialMode`: the canvas opens on the landing chooser so the
          operator picks Manage vs Registry, rather than being dropped into one
          lane with no sign the other exists. */}
      {skillRunSlug && (
        <SkillsWorkbench slug={skillRunSlug} onClose={() => setSkillRunSlug(null)} />
      )}

      {improvePopup && (improvePopup.standards ? (
        <ImprovePopover slug={improvePopup.slug} rowKey={improvePopup.rowKey} anchor={improvePopup.anchor} onClose={() => setImprovePopup(null)} />
      ) : (
        <DeployPopover slug={improvePopup.slug} rowKey={improvePopup.rowKey} anchor={improvePopup.anchor} onClose={() => setImprovePopup(null)} />
      ))}

      {scanPopup && (
        <IdeaScanPopover
          projectId={scanPopup.slug}
          name={positioned.islands.find((i) => i.slug === scanPopup.slug)?.name ?? scanPopup.slug}
          scans={scans.get(scanPopup.slug) ?? []}
          anchor={{ x: scanPopup.x, y: scanPopup.y }}
          busy={busySlugs.has(scanPopup.slug)}
          onRun={(params) => void runIdeaScan(params)}
          onClose={() => setScanPopup(null)}
        />
      )}

      <ProjectModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreate={handleCreateProject}
        onUpdate={async (id, data) => { await storeUpdateProject(id, { name: data.name, githubUrl: data.githubUrl, teamId: data.teamId }); }}
        onScanNow={startBackgroundScan}
        editProject={null}
      />

      {scene.demo && layoutReady && !demoDismissed && (
        <DemoNotice
          scanning={rescanning}
          onScan={rescan}
          onNewProject={() => setNewProjectOpen(true)}
          onDismiss={() => setDemoDismissed(true)}
        />
      )}
      {scene.demo && demoDismissed && (
        // The badge is the way BACK to the notice: once dismissed, the canvas
        // is a wall of cells that quietly refuse every click (demo islands have
        // no passport, so nothing resolves an action). Clicking it re-opens the
        // two exits — scan the workspace, or add a project.
        <button
          type="button"
          onClick={() => setDemoDismissed(false)}
          title={t.mastermind.demo_badge_reopen}
          className="absolute bottom-3 left-3 z-10 typo-caption text-foreground/50 px-2 py-1 rounded-interactive bg-secondary/60 border border-primary/10 hover:text-foreground hover:border-primary/25 transition-colors focus-ring"
          data-testid="mm-demo-badge"
        >
          {t.mastermind.demo_badge}
        </button>
      )}

      <DataHealthBar failed={failedFamilies} onRetry={onRetryData} />
    </div>
    </ImproveProvider>
  );
}
