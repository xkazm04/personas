// Leaf primitives shared by every unified-modal variant — hoisted from day
// one so variant refinement is never paid twice (the /prototype skill's
// mid-prototype hoisting rule).
import { Ban, Check, FileCode2, Share2, ShieldCheck, X } from 'lucide-react';

import { DecisionActions } from '@/features/shared/components/decisions/DecisionActions';
import { useTranslation } from '@/i18n/useTranslation';

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { WorkspaceKnowledgeEvidence } from '@/lib/bindings/WorkspaceKnowledgeEvidence';

import { parseEvidenceRefs } from './hierarchyModel';
import type { KnowledgeItemView } from '../libraryModel';

/** Layer badge — the ONE place the three-layer vocabulary renders. */
export function LayerBadge({ layer }: { layer: KnowledgeItemView['layer'] }) {
  if (!layer) return null;
  const principle = layer === 'principle';
  return (
    <span
      className={`typo-label flex-shrink-0 rounded-pill border px-1.5 py-px ${
        principle
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'border-border/70 bg-secondary/40 text-foreground/75'
      }`}
    >
      {principle ? 'Principle' : 'Manifestation'}
    </span>
  );
}

/** One `path:line` ref as a mono chip. */
export function RefChip({ refPath }: { refPath: string }) {
  return (
    <span className="typo-caption font-mono inline-flex items-center gap-1 rounded-interactive border border-border/60 bg-secondary/30 px-1.5 py-0.5 text-foreground/85 max-w-[320px]">
      <FileCode2 className="w-3 h-3 flex-shrink-0 text-foreground/45" aria-hidden />
      <span className="truncate" title={refPath}>{refPath}</span>
    </span>
  );
}

/** One evidence row: project attribution, refs, quote, verify freshness. */
export function EvidenceRow({
  row,
  projectById,
}: {
  row: WorkspaceKnowledgeEvidence;
  projectById: Map<string, DevProject>;
}) {
  const refs = parseEvidenceRefs(row.refs);
  const project = row.projectId ? projectById.get(row.projectId)?.name ?? null : null;
  return (
    <div className="flex flex-col gap-1.5 py-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        {project && (
          <span className="typo-label text-foreground/80">{project}</span>
        )}
        <span className="typo-caption text-muted-foreground">
          <RelativeTime timestamp={row.recordedAt} />
        </span>
        {row.verifiedAt ? (
          <span className="typo-caption inline-flex items-center gap-1 text-status-success">
            <ShieldCheck className="w-3 h-3" aria-hidden />
            verified <RelativeTime timestamp={row.verifiedAt} />
          </span>
        ) : (
          <span className="typo-caption text-foreground/45">unverified</span>
        )}
      </div>
      {refs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {refs.map((r) => <RefChip key={r} refPath={r} />)}
        </div>
      )}
      {row.quote && (
        <blockquote className="typo-body text-muted-foreground border-l-2 border-border/70 pl-3 leading-relaxed">
          {row.quote}
        </blockquote>
      )}
    </div>
  );
}

/** Evidence block for one item — loading ghost, honest empty, rows. */
export function EvidenceBlock({
  itemId,
  evidence,
  loading,
  projectById,
}: {
  itemId: string;
  evidence: ReadonlyMap<string, readonly WorkspaceKnowledgeEvidence[]>;
  loading: ReadonlySet<string>;
  projectById: Map<string, DevProject>;
}) {
  const rows = evidence.get(itemId);
  if (!rows && loading.has(itemId)) {
    // Ghost, not spinner — loading v2 doctrine (spinners are disabled
    // app-wide); the shimmer bar sits where the rows will land.
    return (
      <div className="flex flex-col gap-1.5 py-2" aria-hidden>
        <div className="h-3 w-2/3 rounded-interactive bg-secondary/50 animate-pulse" />
        <div className="h-3 w-1/2 rounded-interactive bg-secondary/40 animate-pulse" />
      </div>
    );
  }
  if (!rows || rows.length === 0) {
    return (
      <p className="typo-caption text-foreground/45 py-1.5">No structured evidence yet.</p>
    );
  }
  return (
    <div className="divide-y divide-border/50">
      {rows.map((r) => <EvidenceRow key={r.id} row={r} projectById={projectById} />)}
    </div>
  );
}

/** Status-gated governance actions for ONE item — same DecisionActions the
 *  backlog/review streams use, so tones can't drift. */
export function GovernanceDock({
  item,
  busy,
  layout = 'stacked',
  onDecide,
  onRollout,
}: {
  item: KnowledgeItemView;
  busy: boolean;
  layout?: 'stacked' | 'inline';
  onDecide: (item: KnowledgeItemView, decision: 'adopt' | 'reject' | 'deprecate') => void;
  onRollout?: (item: KnowledgeItemView) => void;
}) {
  const { t } = useTranslation();
  const tw = t.plugins.dev_tools.workspaces;
  const pending = item.status === 'observed' || item.status === 'proposed';
  const adopted = item.status === 'adopted';
  if (!pending && !adopted) return null;
  return (
    <DecisionActions
      layout={layout}
      size="md"
      actions={
        pending
          ? [
              { id: 'adopt', label: tw.decide_adopt, tone: 'accept', icon: <Check className="w-4 h-4" />, disabled: busy, onClick: () => onDecide(item, 'adopt') },
              { id: 'reject', label: tw.decide_reject, tone: 'reject', icon: <X className="w-4 h-4" />, disabled: busy, onClick: () => onDecide(item, 'reject') },
            ]
          : [
              ...(onRollout
                ? [{ id: 'rollout', label: tw.rollout_dispatch, tone: 'accept' as const, icon: <Share2 className="w-4 h-4" />, disabled: busy, onClick: () => onRollout(item) }]
                : []),
              { id: 'deprecate', label: tw.decide_deprecate, tone: 'neutral' as const, icon: <Ban className="w-4 h-4" />, disabled: busy, onClick: () => onDecide(item, 'deprecate') },
            ]
      }
    />
  );
}
