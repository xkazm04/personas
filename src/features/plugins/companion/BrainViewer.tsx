import { useCallback, useEffect, useState } from 'react';
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
  ScrollText,
  Sparkles,
  Target,
  Trash2,
  User,
  UserCircle2,
  Workflow,
  X,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { silentCatch } from '@/lib/silentCatch';
import {
  companionDeleteBrainItem,
  companionGetBrainItem,
  companionListBrainItems,
  type BrainDetail,
  type BrainKind,
  type BrainListItem,
} from '@/api/companion';
import { useCompanionStore } from './companionStore';
import { titleCase } from './athenaLabels';
import { BrainLinksStrip } from './BrainLinksStrip';

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

const KINDS: { kind: BrainKind; icon: typeof Bot; labelKey: KindLabelKey; descKey: KindDescKey }[] = [
  // Reading order: who I think she is (identity), what she knows about
  // me (facts), what I'm trying to do (goals + backlog), how she's
  // agreed to behave (procedurals + rituals), what she remembers
  // (episodes, reflections), the docs, her contract.
  { kind: 'identity', icon: User, labelKey: 'identity', descKey: 'brain_desc_identity' },
  { kind: 'fact:user', icon: UserCircle2, labelKey: 'facts_user', descKey: 'brain_desc_facts_user' },
  { kind: 'fact:project', icon: Sparkles, labelKey: 'facts_project', descKey: 'brain_desc_facts_project' },
  { kind: 'fact:world', icon: Globe2, labelKey: 'facts_world', descKey: 'brain_desc_facts_world' },
  { kind: 'goal', icon: Target, labelKey: 'goals', descKey: 'brain_desc_goals' },
  { kind: 'backlog', icon: Inbox, labelKey: 'backlog', descKey: 'brain_desc_backlog' },
  { kind: 'procedural', icon: Workflow, labelKey: 'procedurals', descKey: 'brain_desc_procedurals' },
  { kind: 'ritual', icon: Compass, labelKey: 'rituals', descKey: 'brain_desc_rituals' },
  { kind: 'episode', icon: Bot, labelKey: 'episodes', descKey: 'brain_desc_episodes' },
  { kind: 'reflection', icon: ListChecks, labelKey: 'reflections', descKey: 'brain_desc_reflections' },
  { kind: 'design_decision', icon: ScrollText, labelKey: 'design_decisions', descKey: 'brain_desc_design_decisions' },
  { kind: 'doctrine', icon: BookOpen, labelKey: 'doctrine', descKey: 'brain_desc_doctrine' },
  { kind: 'constitution', icon: Layers, labelKey: 'constitution', descKey: 'brain_desc_constitution' },
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
            onClick={onClose}
            className="p-1.5 rounded-interactive text-foreground hover:text-foreground hover:bg-foreground/5 transition-colors focus-ring"
            aria-label={t.common.close}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {!brainView.kind && <TypesView />}
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

  // Load list-counts in parallel so the cards show "N items" right away.
  // Each kind's count is a separate IPC; cheap, doesn't block render.
  useEffect(() => {
    let cancelled = false;
    KINDS.forEach(({ kind }) => {
      companionListBrainItems(kind)
        .then((items) => {
          if (cancelled) return;
          setCounts((c) => ({ ...c, [kind]: items.length }));
        })
        .catch(silentCatch(`companion_list_brain_items:${kind}`));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="grid grid-cols-2 gap-3 p-5">
      {KINDS.map(({ kind, icon: Icon, labelKey, descKey }) => (
        <button
          key={kind}
          onClick={() => setBrainView({ open: true, kind, id: null })}
          className="text-left rounded-card border border-foreground/10 hover:border-primary/30 bg-foreground/[0.02] hover:bg-primary/5 px-4 py-3 transition-colors focus-ring"
        >
          <div className="flex items-center gap-2 mb-1">
            <Icon className="w-4 h-4 text-primary" />
            <span className="typo-body font-medium">
              {t.plugins.companion[labelKey]}
            </span>
          </div>
          <div className="typo-caption text-foreground mb-1.5">
            {t.plugins.companion[descKey]}
          </div>
          <div className="typo-caption text-primary/80">
            {counts[kind] === undefined
              ? '…'
              : counts[kind] === 1
                ? t.plugins.companion.brain_one_item
                : `${counts[kind]} ${t.plugins.companion.brain_items}`}
          </div>
        </button>
      ))}
    </div>
  );
}

function ListView({ kind }: { kind: BrainKind }) {
  const { t } = useTranslation();
  const setBrainView = useCompanionStore((s) => s.setBrainView);
  const [items, setItems] = useState<BrainListItem[] | null>(null);

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

  if (items === null) {
    return (
      <div className="flex items-center gap-3 p-5 typo-body text-foreground">
        <LoadingSpinner size="sm" />
        <span>{t.plugins.companion.brain_loading}</span>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <p className="p-5 typo-body text-foreground">
        {t.plugins.companion.brain_empty}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-foreground/5">
      {items.map((item) => (
        <li key={item.id}>
          <button
            onClick={() => setBrainView({ open: true, kind, id: item.id })}
            className="w-full text-left px-5 py-3 hover:bg-foreground/[0.04] transition-colors focus-ring flex items-start gap-3"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="typo-caption font-medium text-foreground truncate">
                  {item.title}
                </span>
                <span className="typo-caption text-foreground shrink-0">
                  · {formatRelativeTime(item.meta)}
                </span>
              </div>
              <div className="typo-caption text-foreground line-clamp-2">
                {item.preview || '(empty)'}
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-foreground mt-1 shrink-0" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function DetailView({ kind, id }: { kind: BrainKind; id: string }) {
  const { t } = useTranslation();
  const setBrainView = useCompanionStore((s) => s.setBrainView);
  const [detail, setDetail] = useState<BrainDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
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
        <MarkdownRenderer content={detail.content || '(empty)'} />
        <BrainLinksStrip
          content={detail.content || ''}
          onOpen={(kind, id) => setBrainView({ open: true, kind, id })}
          variant="card"
        />
      </div>
      {detail.deletable && (
        <div className="border-t border-foreground/10 px-3 py-3 shrink-0">
          <button
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

/** Render an ISO timestamp as "Xm ago" / "Xh ago" / "MMM D". Cheap. */
function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diffSec = (Date.now() - t) / 1000;
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 7 * 86400) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}
