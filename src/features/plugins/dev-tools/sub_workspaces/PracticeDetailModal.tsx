// Practice detail — the review surface. Opening a practice shows the full
// claim and its evidence, the metadata the table no longer carries (origin,
// topic, altitude, confidence, provenance), and the governance action its
// current state allows.
//
// Governance, not editing: `observed`/`proposed` items get Adopt / Reject,
// `adopted` items get Roll out and Deprecate. Rejection is retained rather
// than deleted — the miners dedup against it for 90 days, so a rejected
// practice stops coming back.
//
// PROTOTYPING (temporary): this wrapper owns the state machine — decide(),
// busy, keyboard stepping — and delegates PRESENTATION to one of three views
// behind a throwaway tab strip. Every view gets identical props, so switching
// can never change governance behaviour. The strip and the losing variants get
// deleted at consolidation.
import { useEffect, useState } from 'react';
import { Check, X, Ban, Share2, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';

import { BaseModal } from '@/lib/ui/BaseModal';
import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { decideWorkspaceKnowledge } from '@/api/devTools/workspaces';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { WorkspaceKnowledge } from '@/lib/bindings/WorkspaceKnowledge';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';

import { KnowledgeStatusChip } from './centerShared';
import { PracticeDetailDossier } from './PracticeDetailDossier';
import { PracticeDetailLedger } from './PracticeDetailLedger';
import type { PracticeNav, PracticeViewProps } from './practiceViewTypes';

export type { PracticeNav } from './practiceViewTypes';

/** Minimal markdown rendering: the evidence is authored by agents as markdown,
 *  but a full renderer is overkill here — headings, bullets, bold and inline
 *  code carry essentially all of it.
 *  (Baseline only; both variants use the shared MarkdownRenderer instead.) */
function Evidence({ md }: { md: string }) {
  const lines = md.split('\n');
  return (
    <div className="flex flex-col gap-1.5">
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <div key={i} className="h-1" />;
        const inline = (s: string) =>
          s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, j) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              return <strong key={j} className="text-foreground font-semibold">{part.slice(2, -2)}</strong>;
            }
            if (part.startsWith('`') && part.endsWith('`')) {
              return (
                <code key={j} className="typo-code rounded bg-secondary/60 px-1 py-0.5 text-primary">
                  {part.slice(1, -1)}
                </code>
              );
            }
            return <span key={j}>{part}</span>;
          });
        if (line.startsWith('### ')) {
          return <div key={i} className="typo-body text-foreground font-semibold mt-1">{inline(line.slice(4))}</div>;
        }
        if (line.startsWith('## ')) {
          return <div key={i} className="typo-section-title text-foreground mt-1">{inline(line.slice(3))}</div>;
        }
        if (line.startsWith('- ')) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-muted-foreground shrink-0">•</span>
              <span className="typo-body text-muted-foreground min-w-0">{inline(line.slice(2))}</span>
            </div>
          );
        }
        if (line.startsWith('---')) return <hr key={i} className="border-primary/10 my-1" />;
        return <p key={i} className="typo-body text-muted-foreground">{inline(line)}</p>;
      })}
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="typo-label text-muted-foreground uppercase tracking-wide">{label}</span>
      {/* typo-body (400), not typo-caption (500) — the label is already 700, so
          a mid-weight value made the pair read as one blob instead of a
          label/value tier. */}
      <span className="typo-body text-foreground truncate">{children}</span>
    </div>
  );
}

/** The shipped layout, kept for A/B against the variants. */
function PracticeDetailBaseline({
  practice,
  originLabel,
  actorLabel,
  busy,
  pending,
  adopted,
  onDecide,
  onRollout,
  onClose,
  nav,
}: PracticeViewProps) {
  const { t, tx } = useTranslation();
  const tw = t.plugins.dev_tools.workspaces;

  return (
    <div className="flex flex-col max-h-[80vh]">
      <div className="flex items-start gap-3 p-5 pb-3 border-b border-primary/10">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <KnowledgeStatusChip status={practice.status} />
            <span className="typo-label text-muted-foreground">{practice.kind}</span>
            {practice.evidence_count != null && practice.evidence_count > 1 && (
              <span className="typo-label text-muted-foreground">
                {tx(tw.detail_evidence_count, { count: practice.evidence_count })}
              </span>
            )}
          </div>
          <h2 id="practice-detail" className="typo-title text-foreground">
            {practice.title}
          </h2>
        </div>

        {nav && nav.total > 1 && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => nav.onStep(-1)}
              disabled={busy || nav.index === 0}
              aria-label={tw.detail_prev}
              title={tw.detail_prev}
              className="p-1.5 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-secondary/40 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="typo-caption text-muted-foreground tabular-nums whitespace-nowrap">
              {tx(tw.detail_position, { index: nav.index + 1, total: nav.total })}
            </span>
            <button
              type="button"
              onClick={() => nav.onStep(1)}
              disabled={busy || nav.index >= nav.total - 1}
              aria-label={tw.detail_next}
              title={tw.detail_next}
              className="p-1.5 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-secondary/40 disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-5 flex flex-col gap-5">
        <p className="typo-body-lg text-foreground">{practice.statement}</p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-card border border-primary/10 p-3">
          <Meta label={tw.col_topic}>{practice.topic || '—'}</Meta>
          <Meta label={tw.col_origin}>{originLabel}</Meta>
          <Meta label={tw.col_altitude}>
            {practice.abstraction ?? '—'}
            {practice.ftype ? ` · ${practice.ftype}` : ''}
          </Meta>
          <Meta label={tw.col_confidence}>
            {practice.confidence == null ? '—' : `${Math.round(practice.confidence * 100)}%`}
          </Meta>
          <Meta label={tw.detail_source}>{actorLabel ?? '—'}</Meta>
          <Meta label={tw.detail_durability}>{practice.durability ?? '—'}</Meta>
          <Meta label={tw.col_updated}>
            <RelativeTime timestamp={practice.updated_at} />
          </Meta>
          {practice.decided_at && (
            <Meta label={tw.detail_decided}>
              <RelativeTime timestamp={practice.decided_at} />
            </Meta>
          )}
        </div>

        {practice.detail_md?.trim() && (
          <div>
            <div className="typo-label text-muted-foreground uppercase tracking-wide mb-2">
              {tw.detail_evidence}
            </div>
            <Evidence md={practice.detail_md} />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 p-4 border-t border-primary/10">
        {pending && (
          <>
            <Button onClick={() => onDecide('adopt')} disabled={busy} icon={<Check className="w-4 h-4" />} className="whitespace-nowrap">
              {tw.decide_adopt}
            </Button>
            <Button variant="ghost" onClick={() => onDecide('reject')} disabled={busy} icon={<X className="w-4 h-4" />} className="whitespace-nowrap">
              {tw.decide_reject}
            </Button>
            <span className="typo-caption text-muted-foreground ml-1 hidden lg:inline">
              {tw.decide_reject_hint}
            </span>
          </>
        )}
        {adopted && (
          <>
            {onRollout && (
              <Button onClick={onRollout} disabled={busy} icon={<Share2 className="w-4 h-4" />} iconRight={<ExternalLink className="w-3 h-3 opacity-60" />} className="whitespace-nowrap">
                {tw.rollout_dispatch}
              </Button>
            )}
            <Button variant="ghost" onClick={() => onDecide('deprecate')} disabled={busy} icon={<Ban className="w-4 h-4" />} className="whitespace-nowrap">
              {tw.decide_deprecate}
            </Button>
          </>
        )}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {nav && nav.total > 1 && (
            <span className="typo-caption text-muted-foreground hidden md:inline whitespace-nowrap">
              {tw.detail_nav_hint}
            </span>
          )}
          <Button variant="ghost" onClick={onClose} className="whitespace-nowrap">
            {t.common.close}
          </Button>
        </div>
      </div>
    </div>
  );
}

// -- throwaway prototyping scaffold ------------------------------------------

const VARIANTS = [
  { id: 'baseline', label: 'Baseline', hint: 'shipped layout', View: PracticeDetailBaseline },
  { id: 'dossier', label: 'Dossier', hint: 'one column · type + rules carry hierarchy', View: PracticeDetailDossier },
  { id: 'ledger', label: 'Ledger', hint: 'prose left · facts + actions in the margin', View: PracticeDetailLedger },
] as const;

export function PracticeDetailModal({
  practice,
  projectById,
  onClose,
  onChanged,
  onRollout,
  nav,
}: {
  practice: WorkspaceKnowledge;
  projectById: Map<string, DevProject>;
  onClose: () => void;
  onChanged: () => void;
  /** Open the rollout surface for an adopted practice. */
  onRollout?: (practice: WorkspaceKnowledge) => void;
  /** Absent when the practice was opened outside a list (no queue to walk). */
  nav?: PracticeNav;
}) {
  const { t } = useTranslation();
  const tw = t.plugins.dev_tools.workspaces;
  const addToast = useToastStore((s) => s.addToast);
  const [busy, setBusy] = useState(false);
  const [variant, setVariant] = useState<(typeof VARIANTS)[number]['id']>('dossier');

  const decide = async (decision: 'adopt' | 'reject' | 'deprecate') => {
    setBusy(true);
    try {
      await decideWorkspaceKnowledge(practice.id, decision);
      addToast(
        decision === 'adopt' ? tw.decide_adopted
          : decision === 'reject' ? tw.decide_rejected
            : tw.decide_deprecated,
        decision === 'adopt' ? 'success' : 'warning',
      );
      onChanged();
      // Reviewing a queue is the common case, so a decision advances instead of
      // dumping you back to the table and making you find your place again.
      // The parent closes when the queue runs out.
      if (nav) nav.onStep(1);
      else onClose();
    } catch (err) {
      toastCatch('workspaces:decide')(err);
    } finally {
      setBusy(false);
    }
  };

  // ←/→ walk the queue. Ignored while a decision is in flight (so a double-tap
  // can't skip an item mid-write) and while focus sits in a text field.
  useEffect(() => {
    if (!nav) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if (busy) return;
      e.preventDefault();
      nav.onStep(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav, busy]);

  const originLabel = practice.origin_project_id
    ? projectById.get(practice.origin_project_id)?.name ?? tw.origin_removed
    : tw.origin_workspace;
  const actorLabel = (() => {
    try {
      return practice.provenance
        ? (JSON.parse(practice.provenance) as { actor_kind?: string }).actor_kind ?? null
        : null;
    } catch {
      return null;
    }
  })();

  const viewProps: PracticeViewProps = {
    practice,
    projectById,
    originLabel,
    actorLabel,
    busy,
    pending: practice.status === 'observed' || practice.status === 'proposed',
    adopted: practice.status === 'adopted',
    onDecide: decide,
    onRollout: onRollout ? () => { onRollout(practice); onClose(); } : undefined,
    onClose,
    nav,
  };

  const Active = VARIANTS.find((v) => v.id === variant)?.View ?? PracticeDetailBaseline;

  // size="xl", not "lg": at max-w-3xl the governance buttons wrapped onto a
  // second row and split their own icon from their label.
  return (
    <BaseModal isOpen onClose={onClose} titleId="practice-detail" size="xl" staggerChildren={false}>
      {/* Throwaway A/B strip — dashed border marks it as scaffolding, not
          product chrome. Deleted at consolidation, so it stays un-i18n'd. */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-dashed border-primary/20 bg-secondary/20">
        {VARIANTS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setVariant(v.id)}
            title={v.hint}
            className={`typo-caption px-2 py-0.5 rounded-interactive transition-colors ${
              variant === v.id
                ? 'bg-primary/15 text-foreground'
                : 'text-muted-foreground hover:bg-secondary/50'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <Active {...viewProps} />
    </BaseModal>
  );
}
