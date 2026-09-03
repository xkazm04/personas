import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Bot,
  ChevronRight,
  Compass,
  Globe2,
  Inbox,
  Layers,
  ListChecks,
  Pencil,
  RefreshCw,
  Save,
  ScrollText,
  Sparkles,
  Target,
  Trash2,
  User,
  UserCircle2,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useToastStore } from '@/stores/toastStore';
import { silentCatch } from '@/lib/silentCatch';
import {
  companionDeleteBrainItem,
  companionGetBrainItem,
  companionListBrainItems,
  companionCountBrainItems,
  companionRunConsolidation,
  companionRunReflection,
  companionSaveIdentity,
  companionCorrectIdentityClaim,
  companionGetAdaptations,
  type BrainDetail,
  type BrainKind,
  type BrainListItem,
} from '@/api/companion';
import { useCompanionStore } from './companionStore';
import { titleCase } from './athenaLabels';
import { BrainLinksStrip } from './BrainLinksStrip';
import { BrainCycleReports } from './BrainCycleReports';
import { BrainHealthPanel } from './BrainHealthPanel';
import type { AthenaAdaptation } from '@/lib/bindings/AthenaAdaptation';

type KindLabelKey =
  | 'episodes'
  | 'doctrine'
  | 'identity'
  | 'constitution'
  | 'facts_user'
  | 'facts_project'
  | 'facts_world'
  | 'reflections'
  | 'procedurals'
  | 'goals'
  | 'rituals'
  | 'backlog'
  | 'design_decisions';

type KindDescKey =
  | 'brain_desc_identity'
  | 'brain_desc_facts_user'
  | 'brain_desc_facts_project'
  | 'brain_desc_facts_world'
  | 'brain_desc_goals'
  | 'brain_desc_backlog'
  | 'brain_desc_procedurals'
  | 'brain_desc_rituals'
  | 'brain_desc_episodes'
  | 'brain_desc_reflections'
  | 'brain_desc_design_decisions'
  | 'brain_desc_doctrine'
  | 'brain_desc_constitution';

// Visual families — color-code the 13 memory kinds so the eye can cluster
// related memory at a glance ("memory lives in the fuchsia cluster") and build
// spatial memory across sessions. The accent paints each card's icon and its
// left accent bar; the KINDS reading order already keeps each family contiguous
// in the grid so the colours read as clusters.
type BrainFamily = 'identity' | 'goals' | 'procedural' | 'episodic' | 'doctrine';

const FAMILY_ACCENT: Record<BrainFamily, { icon: string; bar: string }> = {
  identity: { icon: 'text-cyan-400', bar: 'bg-cyan-400/60' },        // identity + the three fact scopes
  goals: { icon: 'text-amber-400', bar: 'bg-amber-400/60' },         // goals + backlog
  procedural: { icon: 'text-violet-400', bar: 'bg-violet-400/60' },  // procedurals + rituals
  episodic: { icon: 'text-fuchsia-400', bar: 'bg-fuchsia-400/60' },  // episodes + reflections + decisions
  doctrine: { icon: 'text-slate-400', bar: 'bg-slate-400/60' },      // doctrine + constitution
};

const KINDS: { kind: BrainKind; icon: typeof Bot; labelKey: KindLabelKey; descKey: KindDescKey; family: BrainFamily }[] = [
  // Reading order: who I think she is (identity), what she knows about
  // me (facts), what I'm trying to do (goals + backlog), how she's
  // agreed to behave (procedurals + rituals), what she remembers
  // (episodes, reflections), the docs, her contract.
  { kind: 'identity', icon: User, labelKey: 'identity', descKey: 'brain_desc_identity', family: 'identity' },
  { kind: 'fact:user', icon: UserCircle2, labelKey: 'facts_user', descKey: 'brain_desc_facts_user', family: 'identity' },
  { kind: 'fact:project', icon: Sparkles, labelKey: 'facts_project', descKey: 'brain_desc_facts_project', family: 'identity' },
  { kind: 'fact:world', icon: Globe2, labelKey: 'facts_world', descKey: 'brain_desc_facts_world', family: 'identity' },
  { kind: 'goal', icon: Target, labelKey: 'goals', descKey: 'brain_desc_goals', family: 'goals' },
  { kind: 'backlog', icon: Inbox, labelKey: 'backlog', descKey: 'brain_desc_backlog', family: 'goals' },
  { kind: 'procedural', icon: Workflow, labelKey: 'procedurals', descKey: 'brain_desc_procedurals', family: 'procedural' },
  { kind: 'ritual', icon: Compass, labelKey: 'rituals', descKey: 'brain_desc_rituals', family: 'procedural' },
  { kind: 'episode', icon: Bot, labelKey: 'episodes', descKey: 'brain_desc_episodes', family: 'episodic' },
  { kind: 'reflection', icon: ListChecks, labelKey: 'reflections', descKey: 'brain_desc_reflections', family: 'episodic' },
  { kind: 'design_decision', icon: ScrollText, labelKey: 'design_decisions', descKey: 'brain_desc_design_decisions', family: 'episodic' },
  { kind: 'doctrine', icon: BookOpen, labelKey: 'doctrine', descKey: 'brain_desc_doctrine', family: 'doctrine' },
  { kind: 'constitution', icon: Layers, labelKey: 'constitution', descKey: 'brain_desc_constitution', family: 'doctrine' },
];

/**
 * Brain Viewer — three nested views over Athena's memory:
 *   1. Types     — the four memory kinds with item counts
 *   2. List      — paginated rows for the selected kind
 *   3. Detail    — full content + delete (where applicable)
 *
 * Two render modes (driven by `onClose`):
 *   - **Overlay** (chat panel): `onClose` is provided → absolute-positioned
 *     overlay over the transcript with a close button.
 *   - **Inline** (plugin page): `onClose` undefined → fills its parent,
 *     no close button. Caller controls the surrounding chrome.
 *
 * Navigation is breadcrumb-style: ← arrow goes back one level. Escape
 * key navigates back one level too (suppressed when typing in a field).
 * In inline mode, escape at the root view is a no-op.
 */
export function BrainViewer({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const brainView = useCompanionStore((s) => s.brainView);
  const setBrainView = useCompanionStore((s) => s.setBrainView);

  const goBack = useCallback(() => {
    if (brainView.id) {
      // detail → list
      setBrainView({ open: true, kind: brainView.kind, id: null });
    } else if (brainView.kind) {
      // list → types
      setBrainView({ open: true, kind: null, id: null });
    } else if (onClose) {
      // types → close (overlay mode only — inline mode has no close)
      onClose();
    }
  }, [brainView.id, brainView.kind, onClose, setBrainView]);

  // Esc key navigates back one level (or closes from the root in overlay mode).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'textarea' || tag === 'input') return;
      // Inline mode at root: nothing to do.
      if (!onClose && !brainView.kind && !brainView.id) return;
      e.preventDefault();
      goBack();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goBack, onClose, brainView.kind, brainView.id]);

  // Overlay vs inline shell: overlay paints itself on top of the chat
  // transcript; inline fills the parent (the plugin page's ContentBody).
  const shellClass = onClose
    ? 'absolute inset-0 z-20 flex flex-col bg-secondary/95 backdrop-blur-sm'
    : 'flex flex-col h-full';

  return (
    <div className={shellClass}>
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-foreground/10 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {(brainView.kind || brainView.id) ? (
            <button
              type="button"
              onClick={goBack}
              className="p-1 rounded-interactive text-foreground hover:text-foreground hover:bg-foreground/5 transition-colors focus-ring"
              aria-label={t.common.back}
              title={t.common.back}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : null}
          <div className="typo-body font-medium truncate">
            {brainView.kind
              ? `${t.plugins.companion.brain_title} — ${kindLabel(t, brainView.kind)}`
              : t.plugins.companion.brain_title}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-interactive text-foreground hover:text-foreground hover:bg-foreground/5 transition-colors focus-ring"
            aria-label={t.common.close}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {!brainView.kind && <RootView />}
        {brainView.kind && !brainView.id && (
          <ListView kind={brainView.kind} />
        )}
        {brainView.kind && brainView.id && (
          <DetailView kind={brainView.kind} id={brainView.id} />
        )}
      </div>
    </div>
  );
}

/**
 * Root of the viewer — three lanes over the same brain.
 *
 * **Why sleep cycles are a lane and not a 14th card in the kind grid.** The
 * grid's cards are `BrainKind`s, and every card routes into
 * `companion_list_brain_items` / `companion_get_brain_item`. Neither command
 * has a `cycle_report` arm (`commands/companion/brain.rs:184-194` dispatches on
 * a closed set and errors on anything else), so a `cycle_report` card would be
 * a tile that opens onto a backend error. The journal has its own command —
 * `companion_list_cycle_reports` — with its own shape (phases, counters,
 * status), which the generic list row cannot render anyway. So it gets a lane.
 */
type BrainLane = 'memory' | 'cycles' | 'health';

function RootView() {
  const { t } = useTranslation();
  const [lane, setLane] = useState<BrainLane>('memory');

  return (
    <div className="flex flex-col">
      <div className="px-5 pt-4">
        <SegmentedTabs<BrainLane>
          tabs={[
            { id: 'memory', label: t.plugins.companion.brain_tab_memory },
            { id: 'cycles', label: t.plugins.companion.brain_tab_cycles },
            { id: 'health', label: t.plugins.companion.brain_tab_health },
          ]}
          activeTab={lane}
          onTabChange={setLane}
          ariaLabel={t.plugins.companion.brain_title}
          idPrefix="brain-lane"
        />
      </div>
      {/* The panel attributes are written out rather than spread from
          `segmentedTabPanelProps`, matching the four compliant tab strips in
          the repo (CloudDeployPanel, GitLabPanel, DraftEditStep,
          TemplateDetailModal): the census rule `tabstrip-with-no-declared-panel`
          keys on a literal `role="tabpanel"` in the same file, and a spread
          helper is invisible to it. Ids match SegmentedTabs' own
          `${idPrefix}-panel-${id}` / `${idPrefix}-tab-${id}` shape. */}
      <div role="tabpanel" id={`brain-lane-panel-${lane}`} aria-labelledby={`brain-lane-tab-${lane}`}>
        {lane === 'memory' && <TypesView />}
        {lane === 'cycles' && <BrainCycleReports />}
        {lane === 'health' && <BrainHealthPanel />}
      </div>
    </div>
  );
}

function kindLabel(
  t: ReturnType<typeof useTranslation>['t'],
  kind: BrainKind,
): string {
  // Phase D scoped variants share their parent's label — the meta line
  // already shows the scope, so the title doesn't need to repeat it.
  if (kind.startsWith('procedural')) return t.plugins.companion.procedurals;
  if (kind.startsWith('goal')) return t.plugins.companion.goals;
  if (kind.startsWith('ritual')) return t.plugins.companion.rituals;
  if (kind.startsWith('backlog')) return t.plugins.companion.backlog;
  switch (kind) {
    case 'episode':
      return t.plugins.companion.episodes;
    case 'doctrine':
      return t.plugins.companion.doctrine;
    case 'identity':
      return t.plugins.companion.identity;
    case 'constitution':
      return t.plugins.companion.constitution;
    case 'fact':
      return t.plugins.companion.facts;
    case 'fact:user':
      return t.plugins.companion.facts_user;
    case 'fact:project':
      return t.plugins.companion.facts_project;
    case 'fact:world':
      return t.plugins.companion.facts_world;
    case 'reflection':
      return t.plugins.companion.reflections;
    case 'design_decision':
      return t.plugins.companion.design_decisions;
    default:
      // Unknown kind — never show the raw slug. Title-case it so it
      // still reads as English even if the backend added a new kind
      // ahead of the frontend.
      return titleCase(kind);
  }
}

function TypesView() {
  const { t } = useTranslation();
  const setBrainView = useCompanionStore((s) => s.setBrainView);
  const [counts, setCounts] = useState<Partial<Record<BrainKind, number>>>({});

  // One counts IPC for all kinds. Firing 13 parallel companionListBrainItems
  // calls deserialized every row (episode/reflection payloads grow with the
  // whole history) just to render "N items" labels.
  useEffect(() => {
    let cancelled = false;
    companionCountBrainItems(KINDS.map(({ kind }) => kind))
      .then((counts) => {
        if (cancelled) return;
        setCounts(counts);
      })
      .catch(silentCatch('companion_count_brain_items'));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="grid grid-cols-2 gap-3 p-5">
      {KINDS.map(({ kind, icon: Icon, labelKey, descKey, family }) => {
        const accent = FAMILY_ACCENT[family];
        return (
          <button
            type="button"
            key={kind}
            onClick={() => setBrainView({ open: true, kind, id: null })}
            className="relative overflow-hidden text-left rounded-card border border-foreground/10 hover:border-primary/30 bg-foreground/[0.02] hover:bg-primary/5 px-4 py-3 transition-all hover:-translate-y-0.5 hover:shadow-elevation-2 focus-ring"
          >
            {/* Left accent bar — the family's colour, clipped to the card radius. */}
            <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${accent.bar}`} />
            <div className="flex items-center gap-2 mb-1">
              <Icon className={`w-4 h-4 ${accent.icon}`} />
              <span className="typo-body font-medium">
                {t.plugins.companion[labelKey]}
              </span>
            </div>
            <div className="typo-caption text-foreground mb-1.5">
              {t.plugins.companion[descKey]}
            </div>
            <div className="typo-body font-semibold text-foreground">
              {counts[kind] === undefined
                ? '…'
                : counts[kind] === 1
                  ? t.plugins.companion.brain_one_item
                  : `${counts[kind]} ${t.plugins.companion.brain_items}`}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Rows in the first viewport that play the one-shot entrance cascade when a
 * kind's item list lands (35ms stagger via RevealItem, id-guarded so a
 * refetch of the same kind never replays it).
 */
const LIST_CASCADE_ROWS = 20;

function ListView({ kind }: { kind: BrainKind }) {
  const { t } = useTranslation();
  const setBrainView = useCompanionStore((s) => s.setBrainView);
  const [items, setItems] = useState<BrainListItem[] | null>(null);
  // `items === null` doubles as the in-flight signal: it never hides rows
  // that are already on screen (this view only ever has one fetch per
  // mount), and it gates the ghost/empty choice below — ghosts only into
  // emptiness, the empty state only once the fetch has settled.
  const isFetching = items === null;
  const enter = useRevealTracker(kind);

  useEffect(() => {
    let cancelled = false;
    companionListBrainItems(kind)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(silentCatch(`companion_list_brain_items:${kind}`));
    return () => {
      cancelled = true;
    };
  }, [kind]);

  if (isFetching) {
    return <BrainListGhostRows />;
  }
  if (items.length === 0) {
    return <ListEmpty kind={kind} />;
  }

  return (
    <ul className="divide-y divide-foreground/5">
      {items.map((item, index) => (
        <li key={item.id}>
          <RevealItem
            revealId={item.id}
            order={index}
            hasEntered={(id) => index >= LIST_CASCADE_ROWS || enter.hasEntered(id)}
            markEntered={enter.markEntered}
          >
            <button
              type="button"
              onClick={() => setBrainView({ open: true, kind, id: item.id })}
              className="w-full text-left px-5 py-3 hover:bg-foreground/[0.04] transition-colors focus-ring flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="typo-caption font-medium text-foreground truncate">
                    {item.title}
                  </span>
                  <span className="typo-caption text-foreground shrink-0">
                    ·{' '}
                    {Number.isNaN(Date.parse(item.meta)) ? (
                      // `meta` is overloaded: a bare timestamp for some kinds
                      // (episodes, reflections, …) but a composite status line
                      // for others (goals, backlog, …). Only render the live
                      // relative-time label when it actually parses as a date;
                      // otherwise show the composite string verbatim.
                      item.meta
                    ) : (
                      <RelativeTime timestamp={item.meta} className="text-foreground" />
                    )}
                  </span>
                </div>
                <div className="typo-caption text-foreground line-clamp-2">
                  {item.preview || t.plugins.companion.brain_empty_placeholder}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-foreground mt-1 shrink-0" />
            </button>
          </RevealItem>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// BrainListGhostRows — calm ghost rows for the ONLY moment a kind's item list
// has nothing to show (a fetch on a fresh mount). Each ghost enters via
// `animate-fade-in` (150ms, fill-mode: both) behind a staggered
// animation-delay starting at 120ms — invisible until then, so a fast fetch
// never paints one. Geometry matches the real row (px-5 py-3, title + meta
// line, two-line preview, trailing chevron slot). No `animate-pulse`.
// ---------------------------------------------------------------------------

const GHOST_BAR = 'rounded bg-primary/[0.06]';
const GHOST_TITLE_WIDTHS = ['w-40', 'w-32', 'w-48', 'w-36'];

function BrainListGhostRows() {
  return (
    <div className="divide-y divide-foreground/5" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => {
        const titleW = GHOST_TITLE_WIDTHS[i % GHOST_TITLE_WIDTHS.length];
        const delay = `${120 + i * 35}ms`;
        return (
          <div
            key={i}
            className="px-5 py-3 flex items-start gap-3 animate-fade-in"
            style={{ animationDelay: delay }}
          >
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={`h-3 ${titleW} max-w-full ${GHOST_BAR}`} />
                <span className={`h-2.5 w-14 ${GHOST_BAR}`} />
              </div>
              <span className={`block h-2.5 w-full max-w-[80%] ${GHOST_BAR}`} />
            </div>
            <span className={`w-4 h-4 mt-1 shrink-0 ${GHOST_BAR}`} />
          </div>
        );
      })}
    </div>
  );
}

/** Icon for a memory kind, mirroring `kindLabel`'s scoped-variant prefixes. */
function kindIcon(kind: BrainKind): LucideIcon {
  const exact = KINDS.find((k) => k.kind === kind);
  if (exact) return exact.icon;
  if (kind.startsWith('procedural')) return Workflow;
  if (kind.startsWith('goal')) return Target;
  if (kind.startsWith('ritual')) return Compass;
  if (kind.startsWith('backlog')) return Inbox;
  if (kind.startsWith('fact')) return Sparkles;
  return Bot;
}

/**
 * Empty memory kind — a guided launchpad instead of a dead `<p>`. Reuses the
 * shared `EmptyState` primitive (icon + title + hint) and routes the user
 * forward with a kind-aware CTA:
 *   - `reflection` → run the reflection generator and jump straight to the
 *     new entry (mirrors the Memory tab's bulk action; resolves the empty
 *     state on the spot).
 *   - fact kinds → kick off a consolidation pass (the pipeline that proposes
 *     facts to remember), with a toast pointing at the Memory-tab review.
 *   - everything else → open Athena's chat seeded with a "help me add the
 *     first entry" opener, mirroring WelcomeHero's launchpad feel.
 */
function ListEmpty({ kind }: { kind: BrainKind }) {
  const { t, tx } = useTranslation();
  const setBrainView = useCompanionStore((s) => s.setBrainView);
  const addToast = useToastStore((s) => s.addToast);
  const [running, setRunning] = useState(false);

  const Icon = kindIcon(kind);
  const isReflection = kind === 'reflection';
  const isFact = kind === 'fact' || kind.startsWith('fact:');

  const generateReflection = useCallback(async () => {
    setRunning(true);
    try {
      const id = await companionRunReflection();
      addToast(t.plugins.companion.reflections, 'success');
      // Jump straight to the new reflection so the result is visible — this
      // also unmounts the empty state.
      setBrainView({ open: true, kind: 'reflection', id });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast(`${t.plugins.companion.reflection_failed}: ${msg}`, 'error');
      silentCatch('companion_run_reflection')(err);
      setRunning(false);
    }
  }, [addToast, setBrainView, t]);

  const runConsolidation = useCallback(async () => {
    setRunning(true);
    try {
      await companionRunConsolidation();
      addToast(t.plugins.companion.brain_empty_consolidation_started, 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast(msg, 'error');
      silentCatch('companion_run_consolidation')(err);
    } finally {
      setRunning(false);
    }
  }, [addToast, t]);

  const askAthena = useCallback(() => {
    useCompanionStore.getState().setPendingPrompt({
      text: tx(t.plugins.companion.brain_empty_ask_prompt, {
        kind: kindLabel(t, kind),
      }),
      autoSend: true,
    });
    useCompanionStore.getState().setState('open');
  }, [t, tx, kind]);

  if (running) {
    return (
      <EmptyState
        icon={Icon}
        title={t.plugins.companion.brain_empty}
        subtitle={t.plugins.companion.brain_empty_hint}
      >
        <div className="flex items-center gap-2 typo-caption text-foreground">
          <LoadingSpinner size="sm" />
          <span>
            {isReflection
              ? t.plugins.companion.reflection_running
              : t.plugins.companion.consolidation_running}
          </span>
        </div>
      </EmptyState>
    );
  }

  const action = isReflection
    ? {
        label: t.plugins.companion.memory_generate_reflection,
        onClick: generateReflection,
        icon: Sparkles,
      }
    : isFact
      ? {
          label: t.plugins.companion.memory_run_consolidation,
          onClick: runConsolidation,
          icon: RefreshCw,
        }
      : {
          label: t.plugins.companion.brain_empty_ask_cta,
          onClick: askAthena,
          icon: Sparkles,
        };

  return (
    <EmptyState
      icon={Icon}
      title={t.plugins.companion.brain_empty}
      subtitle={t.plugins.companion.brain_empty_hint}
      action={action}
    />
  );
}

function DetailView({ kind, id }: { kind: BrainKind; id: string }) {
  const { t } = useTranslation();
  const setBrainView = useCompanionStore((s) => s.setBrainView);
  const [detail, setDetail] = useState<BrainDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // F1 — identity is the one user-editable brain file (editor-of-record).
  const isIdentity = kind === 'identity';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    setEditing(false);
    companionGetBrainItem(kind, id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (!cancelled) setError(msg);
        silentCatch(`companion_get_brain_item:${kind}:${id}`)(err);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, id]);

  const handleDelete = useCallback(async () => {
    if (!detail || !detail.deletable) return;
    setDeleting(true);
    try {
      await companionDeleteBrainItem(kind, id);
      // After delete, drop back to the list view.
      setBrainView({ open: true, kind, id: null });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      silentCatch(`companion_delete_brain_item:${kind}:${id}`)(err);
    } finally {
      setDeleting(false);
    }
  }, [detail, kind, id, setBrainView]);

  const startEdit = useCallback(() => {
    setDraft(detail?.content ?? '');
    setEditing(true);
  }, [detail]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await companionSaveIdentity(draft);
      setDetail((d) => (d ? { ...d, content: draft } : d));
      setEditing(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      silentCatch('companion_save_identity')(err);
    } finally {
      setSaving(false);
    }
  }, [draft]);

  if (error) {
    return (
      <div className="m-5 rounded-card border border-rose-500/30 bg-rose-500/10 px-3 py-2 typo-body text-rose-400">
        {error}
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="flex items-center gap-3 p-5 typo-body text-foreground">
        <LoadingSpinner size="sm" />
        <span>{t.plugins.companion.brain_loading}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-3 border-b border-foreground/5 shrink-0">
        <div className="typo-body font-medium truncate">{detail.title}</div>
        {detail.meta && (
          <div className="typo-caption text-foreground mt-0.5">
            {detail.meta}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            aria-label={t.plugins.companion.identity_edit}
            className="w-full h-full min-h-[24rem] rounded-card border border-primary/20 bg-secondary/30 p-3 typo-code font-mono text-foreground resize-none focus-ring"
          />
        ) : (
          <>
            <MarkdownRenderer content={detail.content || t.plugins.companion.brain_empty_placeholder} />
            <BrainLinksStrip
              content={detail.content || ''}
              onOpen={(kind, id) => setBrainView({ open: true, kind, id })}
              variant="card"
            />
            {isIdentity && <IdentityAdaptations />}
            {isIdentity && <IdentityClaimCorrections content={detail.content || ''} />}
          </>
        )}
      </div>
      {isIdentity && (
        <div className="border-t border-foreground/10 px-3 py-3 shrink-0 flex items-center gap-2">
          {editing ? (
            <>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-primary text-primary-foreground hover:opacity-90 typo-caption font-medium disabled:opacity-50 transition-opacity focus-ring"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? t.plugins.companion.identity_saving : t.plugins.companion.identity_save}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive border border-primary/20 text-foreground hover:bg-secondary/50 typo-caption font-medium disabled:opacity-50 transition-colors focus-ring"
              >
                <X className="w-3.5 h-3.5" />
                {t.common.cancel}
              </button>
              <span className="typo-caption text-foreground ml-1">{t.plugins.companion.identity_edit_hint}</span>
            </>
          ) : (
            <button
              type="button"
              onClick={startEdit}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive border border-primary/20 text-foreground hover:bg-secondary/50 typo-caption font-medium transition-colors focus-ring"
            >
              <Pencil className="w-3.5 h-3.5" />
              {t.plugins.companion.identity_edit}
            </button>
          )}
        </div>
      )}
      {!isIdentity && detail.deletable && (
        <div className="border-t border-foreground/10 px-3 py-3 shrink-0">
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 typo-caption font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-ring"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {deleting
              ? t.plugins.companion.brain_deleting
              : t.plugins.companion.brain_delete}
          </button>
        </div>
      )}
    </div>
  );
}

/** Extract the user-profile bullets ("About Michal" sections) from identity.md
 *  markdown — section heading-path + bullet text — skipping placeholder seeds. */
function parseIdentityClaims(content: string): { section: string; bullet: string }[] {
  let h1 = '';
  let h2 = '';
  const claims: { section: string; bullet: string }[] = [];
  for (const line of content.split('\n')) {
    const t = line.trimStart();
    if (t.startsWith('# ')) {
      h1 = t.slice(2).trim();
      h2 = '';
    } else if (t.startsWith('## ')) {
      h2 = t.slice(3).trim();
    } else if (t.startsWith('- ') && h2 && h1.toLowerCase().includes('about michal')) {
      const bullet = t.slice(2).trim();
      // Skip the placeholder seed bullets ("(seeded from intake interview)", …).
      if (bullet && !bullet.startsWith('(')) {
        claims.push({ section: `${h1} / ${h2}`, bullet });
      }
    }
  }
  return claims;
}

/** "What Athena adapts" — the active engagement budget modulations (F4). */
function IdentityAdaptations() {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const [mods, setMods] = useState<AthenaAdaptation[]>([]);
  useEffect(() => {
    companionGetAdaptations()
      .then(setMods)
      .catch(silentCatch('companion_get_adaptations'));
  }, []);
  if (mods.length === 0) return null;
  return (
    <div className="rounded-card border border-primary/15 bg-primary/[0.03] px-3 py-2.5 space-y-1">
      <div className="typo-caption tracking-wide font-semibold text-primary">{c.identity_adapts_title}</div>
      {mods.map((m) => (
        <div key={m.kind} className="typo-caption text-foreground">
          {tx(c.identity_adapts_row, {
            kind: titleCase(m.kind.replace(/_/g, ' ')),
            base: m.baseCap,
            eff: m.effectiveCap,
            engaged: m.engaged,
            dismissed: m.dismissed,
          })}
        </div>
      ))}
    </div>
  );
}

/** Per-bullet "that's wrong" correction loop (F4): mark a profile claim wrong →
 *  records a correction + proposes a one-click removal approval. */
function IdentityClaimCorrections({ content }: { content: string }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const [corrected, setCorrected] = useState<Set<string>>(new Set());
  const claims = useMemo(() => parseIdentityClaims(content), [content]);
  if (claims.length === 0) return null;

  const onWrong = (section: string, bullet: string) => {
    setCorrected((s) => new Set(s).add(bullet));
    companionCorrectIdentityClaim(section, bullet).catch((err: unknown) => {
      setCorrected((s) => {
        const next = new Set(s);
        next.delete(bullet);
        return next;
      });
      silentCatch('companion_correct_identity_claim')(err);
    });
  };

  return (
    <div className="space-y-1.5 pt-2 border-t border-foreground/10">
      <div className="typo-caption tracking-wide font-semibold text-foreground">{c.identity_correct_title}</div>
      <p className="typo-caption text-foreground">{c.identity_correct_hint}</p>
      {claims.map((claim) => {
        const done = corrected.has(claim.bullet);
        return (
          <div
            key={`${claim.section}:${claim.bullet}`}
            className="flex items-start justify-between gap-2 rounded-card border border-foreground/10 bg-secondary/20 px-2.5 py-1.5"
          >
            <span className={`typo-caption text-foreground ${done ? 'line-through opacity-60' : ''}`}>
              {claim.bullet}
            </span>
            <button
              type="button"
              disabled={done}
              onClick={() => onWrong(claim.section, claim.bullet)}
              className="shrink-0 inline-flex items-center gap-1 rounded-interactive border border-rose-500/20 text-rose-400 hover:bg-rose-500/10 px-2 py-0.5 typo-caption disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-ring"
            >
              <X className="w-3 h-3" />
              {done ? c.identity_wrong_proposed : c.identity_wrong}
            </button>
          </div>
        );
      })}
    </div>
  );
}
