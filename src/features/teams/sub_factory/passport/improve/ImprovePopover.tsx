// The Improve popover — the gap-cell upgrade surface (pattern D). Offers the
// applicable Tier-0 standards practices as a MULTI-SELECT checklist and shows a
// LIVE projected-passport preview (re-deriving the passport with the hypothetical
// config) so the user sees exactly how golden-standard practices lift the scores
// before applying. Apply → setStandardsConfig + re-derive. Portalled + anchored
// so the matrix's overflow-x-auto never clips it.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X, ArrowRight } from 'lucide-react';

import { useToastStore } from '@/stores/toastStore';
import { derivePassportFromMetadata } from '../passportDerive';
import { CI_LABEL, SECURITY_LABEL } from '../passportModel';
import { ReadinessSeal } from '../passportWidgets';
import { useImprove } from './ImproveContext';
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
  const engine = useImprove();
  const addToast = useToastStore((s) => s.addToast);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const raw = engine?.getRaw(slug);
  const applicable = useMemo(() => applicableStandardsActions(raw?.project.standards_config), [raw?.project.standards_config]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(applicable.map((a) => a.id)));

  const projection = useMemo(() => {
    if (!raw) return null;
    const current = parseStandards(raw.project.standards_config);
    const picked = applicable.filter((a) => selected.has(a.id));
    const projectedStandards = applyStandardsActions(current, picked, raw.project);
    const before = derivePassportFromMetadata(raw.meta, raw.project, { hasSkills: raw.hasSkills, evidence: raw.evidence });
    const after = derivePassportFromMetadata(raw.meta, { ...raw.project, standards_config: serializeStandards(projectedStandards) }, { hasSkills: raw.hasSkills, evidence: raw.evidence });
    return { picked, projectedStandards, before, after };
  }, [raw, applicable, selected]);

  useLayoutEffect(() => {
    if (!anchor) { setPos(null); return; }
    const panelH = panelRef.current?.offsetHeight ?? 300;
    const spaceBelow = window.innerHeight - anchor.bottom;
    const top = spaceBelow < panelH + 14 && anchor.top > spaceBelow ? Math.max(8, anchor.top - panelH - 6) : anchor.bottom + 6;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - WIDTH - 8));
    setPos({ top, left });
  }, [anchor, selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(id); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  if (!raw || !anchor || !projection) return null;

  const { picked, projectedStandards, before, after } = projection;

  const onApply = async () => {
    if (!engine || picked.length === 0) return;
    setSaving(true);
    try {
      await engine.applyStandards(slug, serializeStandards(projectedStandards));
      addToast(`Upgraded ${raw.project.name} — ${picked.length} ${picked.length === 1 ? 'practice' : 'practices'} enabled`, 'success');
      onClose();
    } catch {
      addToast('Couldn’t apply standards', 'error');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Improve ${raw.project.name}`}
      style={{ top: pos?.top ?? anchor.bottom + 6, left: pos?.left ?? anchor.left, width: WIDTH, visibility: pos ? 'visible' : 'hidden' }}
      className="fixed z-[9995] rounded-modal border border-primary/15 bg-background shadow-elevation-4 overflow-hidden"
    >
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-primary/10 bg-primary/[0.04]">
        <Sparkles className="w-3.5 h-3.5 text-primary flex-shrink-0" aria-hidden />
        <span className="typo-caption font-semibold text-foreground truncate">Improve {raw.project.name}</span>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto p-0.5 rounded-interactive text-foreground hover:bg-secondary/40 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* level ladder + provenance for the clicked ordinal row (e.g. CI) */}
      {ladderFor(rowKey, before) && (
        <div className="px-3 pt-2.5 space-y-1.5">
          <LevelLadder rowKey={rowKey} passport={before} />
          {dimensionReason(rowKey, raw) && (
            <p className="typo-label text-foreground/45 leading-snug">{dimensionReason(rowKey, raw)}</p>
          )}
        </div>
      )}

      {/* live projected-passport preview */}
      <div className="px-3 py-2.5 border-b border-primary/10 space-y-1.5">
        <PreviewRow label="Automation">
          <ReadinessSeal kind="level" level={before.automationReadiness.level} score={before.automationReadiness.score} size="sm" />
          <ArrowRight className="w-3 h-3 text-foreground/40 flex-shrink-0" aria-hidden />
          <ReadinessSeal kind="level" level={after.automationReadiness.level} score={after.automationReadiness.score} size="sm" />
          <Delta before={before.automationReadiness.score} after={after.automationReadiness.score} />
        </PreviewRow>
        <PreviewRow label="Production">
          <ReadinessSeal kind="band" band={before.productionReadiness.band} score={before.productionReadiness.score} size="sm" />
          <ArrowRight className="w-3 h-3 text-foreground/40 flex-shrink-0" aria-hidden />
          <ReadinessSeal kind="band" band={after.productionReadiness.band} score={after.productionReadiness.score} size="sm" />
          <Delta before={before.productionReadiness.score} after={after.productionReadiness.score} />
        </PreviewRow>
        <LevelDelta label="CI" before={CI_LABEL[before.productionReadiness.ci.level]} after={CI_LABEL[after.productionReadiness.ci.level]} />
        <LevelDelta label="Security" before={SECURITY_LABEL[before.productionReadiness.security.level]} after={SECURITY_LABEL[after.productionReadiness.security.level]} />
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
              <span className="typo-caption font-medium text-foreground block">{a.label}</span>
              <span className="typo-caption text-foreground/55 block leading-snug" style={{ fontWeight: 400 }}>{a.hint}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-primary/10 bg-secondary/10">
        <span className="typo-caption text-foreground/55">{picked.length} selected</span>
        <button
          type="button"
          onClick={onApply}
          disabled={picked.length === 0 || saving}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-interactive typo-caption font-medium text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Sparkles className="w-3 h-3" />
          {saving ? 'Applying…' : 'Apply upgrade'}
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
  return <span className="typo-caption font-semibold text-emerald-300 tabular-nums">+{d}</span>;
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
          <span className="typo-caption font-medium text-emerald-300">{after}</span>
        </>
      )}
    </div>
  );
}
