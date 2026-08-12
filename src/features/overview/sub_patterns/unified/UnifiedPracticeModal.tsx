// Unified practice detail (pattern-fabric v2) — ONE modal for both entries:
// a Library row click and a Graph cluster/pattern click land here, anchored
// on the item's PRINCIPLE context (principle header → manifestations by
// cluster → evidence rows). Replaces PracticeDetailLedger (single-item view,
// blind to hierarchy) and ClusterPatternsModal (flat card stack).
//
// This wrapper owns behaviour — hierarchy resolution, evidence fetching,
// decide() CAS, focus/anchor state — and the variants own only presentation,
// so the /prototype variant swap can never alter governance. The variant
// switcher is prototype scaffolding: it dies at consolidation.
import { useCallback, useEffect, useRef, useState } from 'react';

import { BaseModal } from '@/lib/ui/BaseModal';
import { listWorkspaceEvidence } from '@/api/devTools/workspaces';
import { decidePracticeRow } from '@/lib/decisions/rowWrites';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { WorkspaceKnowledgeEvidence } from '@/lib/bindings/WorkspaceKnowledgeEvidence';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';

import type { KnowledgeItemView } from '../libraryModel';
import { resolveHierarchy } from './hierarchyModel';
import type { UnifiedViewProps } from './types';
import { VariantCharter } from './VariantCharter';
import { VariantStrata } from './VariantStrata';
import { VariantCasefile } from './VariantCasefile';

const VARIANTS = [
  { id: 'charter', label: 'Charter', hint: 'document — clauses & citations' },
  { id: 'strata', label: 'Strata', hint: 'atlas — three navigable panes' },
  { id: 'casefile', label: 'Casefile', hint: 'audit — evidence-first grid' },
] as const;
type VariantId = (typeof VARIANTS)[number]['id'];

export function UnifiedPracticeModal({
  anchor,
  items,
  projectById,
  onClose,
  onChanged,
  onRollout,
}: {
  anchor: KnowledgeItemView;
  /** Full corpus slice both surfaces already hold — hierarchy is resolved
   *  client-side, no extra fetch. */
  items: readonly KnowledgeItemView[];
  projectById: Map<string, DevProject>;
  onClose: () => void;
  onChanged: () => void;
  onRollout?: (item: KnowledgeItemView) => void;
}) {
  const { t } = useTranslation();
  const tw = t.plugins.dev_tools.workspaces;
  const addToast = useToastStore((s) => s.addToast);

  const [variant, setVariant] = useState<VariantId>('charter');
  const [anchorItem, setAnchorItem] = useState(anchor);
  const [focus, setFocus] = useState(anchor);
  const [busy, setBusy] = useState(false);

  const hierarchy = resolveHierarchy(anchorItem, items);

  // -- evidence: fetched per item, cached for the modal's lifetime ----------
  const [evidence, setEvidence] = useState<Map<string, readonly WorkspaceKnowledgeEvidence[]>>(
    new Map(),
  );
  const [evidenceLoading, setEvidenceLoading] = useState<Set<string>>(new Set());
  const fetched = useRef(new Set<string>());
  const loadEvidence = useCallback((ids: string[]) => {
    const wanted = ids.filter((id) => !fetched.current.has(id));
    if (wanted.length === 0) return;
    for (const id of wanted) fetched.current.add(id);
    setEvidenceLoading((s) => new Set([...s, ...wanted]));
    void Promise.all(
      wanted.map(async (id) => {
        try {
          const rows = await listWorkspaceEvidence(id);
          setEvidence((m) => new Map(m).set(id, rows));
        } catch (err) {
          silentCatch('unifiedPractice:evidence')(err);
          fetched.current.delete(id); // allow a retry on next expand
        } finally {
          setEvidenceLoading((s) => {
            const next = new Set(s);
            next.delete(id);
            return next;
          });
        }
      }),
    );
  }, []);

  // The principle + every manifestation load up front: the whole point of
  // the v2 modal is that evidence is VISIBLE, not behind N clicks. Counts
  // are single-digit per item; the fan-out is bounded by the hierarchy.
  useEffect(() => {
    const ids = [
      ...(hierarchy.principle ? [hierarchy.principle.id] : [hierarchy.anchor.id]),
      ...hierarchy.groups.flatMap((g) => g.items.map((i) => i.id)),
    ];
    loadEvidence(ids);
  }, [hierarchy.principle?.id, hierarchy.anchor.id, loadEvidence]); // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (
    item: KnowledgeItemView,
    decision: 'adopt' | 'reject' | 'deprecate',
  ) => {
    setBusy(true);
    try {
      await decidePracticeRow(item.id, decision, { seenStatus: item.status });
      addToast(
        decision === 'adopt' ? tw.decide_adopted
          : decision === 'reject' ? tw.decide_rejected
            : tw.decide_deprecated,
        decision === 'adopt' ? 'success' : 'warning',
      );
      onChanged();
    } catch (err) {
      toastCatch('workspaces:decide')(err);
    } finally {
      setBusy(false);
    }
  };

  const viewProps: UnifiedViewProps = {
    hierarchy,
    focus,
    onFocus: setFocus,
    onAnchor: (item) => {
      setAnchorItem(item);
      setFocus(item);
    },
    evidence,
    evidenceLoading,
    projectById,
    busy,
    onDecide: decide,
    onRollout,
    onClose,
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId="unified-practice" size="xl" staggerChildren={false}>
      <div className="flex flex-col max-h-[84vh] min-h-0">
        {/* PROTOTYPE SCAFFOLD — variant switcher; removed at consolidation. */}
        <div className="flex items-center gap-1 px-4 pt-2.5 pb-0 flex-shrink-0">
          {VARIANTS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setVariant(v.id)}
              title={v.hint}
              className={`typo-label px-2.5 py-1 rounded-interactive transition-colors ${
                variant === v.id
                  ? 'bg-primary/12 text-primary'
                  : 'text-foreground/50 hover:text-foreground hover:bg-secondary/40'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        {variant === 'charter' && <VariantCharter {...viewProps} />}
        {variant === 'strata' && <VariantStrata {...viewProps} />}
        {variant === 'casefile' && <VariantCasefile {...viewProps} />}
      </div>
    </BaseModal>
  );
}
