// The Improve popover — the gap-cell upgrade surface (pattern D). Offers the
// applicable Tier-0 standards practices as a MULTI-SELECT checklist and shows a
// LIVE projected-passport preview (re-deriving the passport with the hypothetical
// config) so the user sees exactly how golden-standard practices lift the scores
// before applying. Apply → setStandardsConfig + re-derive. Portalled + anchored
// so the matrix's overflow-x-auto never clips it.
import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X, ArrowRight } from 'lucide-react';

import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { derivePassportFromMetadata } from '../passportDerive';
import { CI_LABEL, SECURITY_LABEL } from '../passportModel';
import { ReadinessSeal } from '../passportWidgets';
import { useImprove } from './ImproveContext';
import { useAnchoredPopover } from './useAnchoredPopover';
import {
  parseStandards, serializeStandards, applyStandardsActions, applicableStandardsActions,
} from './standards';
import { LevelLadder } from './LevelLadder';
import { ladderFor } from './levels';
import { dimensionReason } from './provenance';

const WIDTH = 324;

export function ImprovePopover({
  slug, rowKey, anchor, onClose,
}: {
  slug: string;
  rowKey: string;
  anchor: DOMRect | null;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const engine = useImprove();
  const addToast = useToastStore((s) => s.addToast);
  const [saving, setSaving] = useState(false);

  const raw = engine?.getRaw(slug);
  const applicable = useMemo(() => applicableStandardsActions(raw?.project.standards_config), [raw?.project.standards_config]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(applicable.map((a) => a.id)));

  const projection = useMemo(() => {
    if (!raw) return null;
    const current = parseStandards(raw.project.standards_config);
    const picked = applicable.filter((a) => selected.has(a.id));
    const projectedStandards = applyStandardsActions(current, picked, raw.project);
    const before = derivePassportFromMetadata(raw.meta, raw.project, { hasSkills: raw.hasSkills, evidence: raw.evidence, skillCounts: raw.skillCounts, docRot: raw.docRot, memHealth: raw.memHealth });
    const after = derivePassportFromMetadata(raw.meta, { ...raw.project, standards_config: serializeStandards(projectedStandards) }, { hasSkills: raw.hasSkills, evidence: raw.evidence, skillCounts: raw.skillCounts, docRot: raw.docRot, memHealth: raw.memHealth });
    return { picked, projectedStandards, before, after };
  }, [raw, applicable, selected]);

  const { panelRef, style: popStyle } = useAnchoredPopover({ anchor, width: WIDTH, onClose, active: !!raw && !!anchor && !!projection, estimatedHeight: 300, layoutKey: selected });

  if (!raw || !anchor || !projection) return null;

  const { picked, projectedStandards, before, after } = projection;
  const reason = dimensionReason(rowKey, raw, t);

  const onApply = async () => {
    if (!engine || picked.length === 0) return;
    setSaving(true);
    try {
      await engine.applyStandards(slug, serializeStandards(projectedStandards));
      addToast(tx(picked.length === 1 ? d.improve_toast_upgraded_one : d.improve_toast_upgraded_other, { name: raw.project.name, count: picked.length }), 'success');
      onClose();
    } catch {
      addToast(d.improve_toast_apply_failed, 'error');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      tabIndex={-1}
      aria-label={tx(d.improve_pop_title, { name: raw.project.name })}
      style={popStyle(anchor)}
      className="fixed z-[9995] outline-none rounded-modal border border-primary/15 bg-background shadow-elevation-4 overflow-hidden"
    >
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-primary/10 bg-primary/[0.04]">
        <Sparkles className="w-3.5 h-3.5 text-primary flex-shrink-0" aria-hidden />
        <span className="typo-caption text-foreground truncate">{tx(d.improve_pop_title, { name: raw.project.name })}</span>
        <button type="button" onClick={onClose} aria-label={t.common.close} className="ml-auto p-0.5 rounded-interactive text-foreground hover:bg-secondary/40 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* level ladder + provenance for the clicked ordinal row (e.g. CI) */}
      {ladderFor(rowKey, before) && (
        <div className="px-3 pt-2.5 space-y-1.5">
          <LevelLadder rowKey={rowKey} passport={before} />
          {reason && <p className="typo-caption">{reason}</p>}
        </div>
      )}

      {/* live projected-passport preview */}
      <div className="px-3 py-2.5 border-b border-primary/10 space-y-1.5">
        <PreviewRow label={d.improve_pop_automation}>
          <ReadinessSeal kind="level" level={before.automationReadiness.level} score={before.automationReadiness.score} size="sm" />
          <ArrowRight className="w-3 h-3 text-foreground/40 flex-shrink-0" aria-hidden />
          <ReadinessSeal kind="level" level={after.automationReadiness.level} score={after.automationReadiness.score} size="sm" />
          <Delta before={before.automationReadiness.score} after={after.automationReadiness.score} />
        </PreviewRow>
        <PreviewRow label={d.improve_pop_production}>
          <ReadinessSeal kind="band" band={before.productionReadiness.band} score={before.productionReadiness.score} size="sm" />
          <ArrowRight className="w-3 h-3 text-foreground/40 flex-shrink-0" aria-hidden />
          <ReadinessSeal kind="band" band={after.productionReadiness.band} score={after.productionReadiness.score} size="sm" />
          <Delta before={before.productionReadiness.score} after={after.productionReadiness.score} />
        </PreviewRow>
        <LevelDelta label="CI" before={CI_LABEL[before.productionReadiness.ci.level]} after={CI_LABEL[after.productionReadiness.ci.level]} />
        <LevelDelta label={d.improve_pop_security} before={SECURITY_LABEL[before.productionReadiness.security.level]} after={SECURITY_LABEL[after.productionReadiness.security.level]} />
      </div>

      {/* multi-select checklist */}
      <div className="max-h-56 overflow-y-auto p-1.5">
        {applicable.map((a) => (
          <label key={a.id} className="flex items-start gap-2 px-2 py-1.5 rounded-interactive hover:bg-primary/[0.04] cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={selected.has(a.id)}
              onChange={() => setSelected((prev) => { const n = new Set(prev); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; })}
              className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 cursor-pointer"
              style={{ accentColor: 'var(--primary)' }}
            />
            <span className="min-w-0">
              <span className="typo-caption text-foreground block">{a.label}</span>
              <span className="typo-caption text-foreground/55 block" style={{ fontWeight: 400 }}>{a.hint}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-primary/10 bg-secondary/10">
        <span className="typo-caption text-foreground/55">{tx(d.improve_pop_selected, { count: picked.length })}</span>
        <button
          type="button"
          onClick={onApply}
          disabled={picked.length === 0 || saving}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-interactive typo-caption text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Sparkles className="w-3 h-3" />
          {saving ? d.improve_pop_applying : d.improve_pop_apply}
        </button>
      </div>
    </div>,
    document.body,
  );
}

function PreviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="typo-label text-foreground/45 w-[72px] flex-shrink-0">{label}</span>
      {children}
    </div>
  );
}

function Delta({ before, after }: { before: number; after: number }) {
  const d = after - before;
  if (d <= 0) return null;
  return <span className="typo-caption text-emerald-300 tabular-nums">+{d}</span>;
}

function LevelDelta({ label, before, after }: { label: string; before: string; after: string }) {
  const changed = before !== after;
  return (
    <div className="flex items-center gap-1.5">
      <span className="typo-label text-foreground/45 w-[72px] flex-shrink-0">{label}</span>
      <span className="typo-caption text-foreground/60">{before}</span>
      {changed && (
        <>
          <ArrowRight className="w-3 h-3 text-foreground/40" aria-hidden />
          <span className="typo-caption text-emerald-300">{after}</span>
        </>
      )}
    </div>
  );
}
