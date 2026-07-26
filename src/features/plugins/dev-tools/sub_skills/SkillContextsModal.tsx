// Per-context progress modal — opens from a context-tracked skill row.
// Shows the skill's Memory-Ledger footprint per context (fresh ≤30d nodes),
// uncovered contexts included so the remainder is honest.
//
// ── PROTOTYPE SCAFFOLD (/prototype, throwaway) ──────────────────────────────
// Two directions behind a switcher — pick one, then it renders directly.
//   · Bars — one row per context, note-count bar + freshness
//   · Grid — compact tile mosaic, coverage at a glance
import { useEffect, useMemo, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';

import { memorySkillContexts, type SkillContextRow } from '@/api/devTools/devTools';
import { BaseModal } from '@/features/shared/components/modals';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { silentCatch } from '@/lib/silentCatch';

type VariantId = 'bars' | 'grid';

export function SkillContextsModal({ projectId, projectName, skill, totalContexts, onClose }: {
  projectId: string;
  projectName: string;
  skill: string;
  totalContexts: number;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<SkillContextRow[] | null>(null);
  const [variant, setVariant] = useState<VariantId>('bars');

  useEffect(() => {
    let alive = true;
    memorySkillContexts(projectId, skill)
      .then((r) => { if (alive) setRows(r); })
      .catch((e) => { silentCatch('skill contexts modal')(e); if (alive) setRows([]); });
    return () => { alive = false; };
  }, [projectId, skill]);

  const covered = useMemo(() => (rows ?? []).filter((r) => r.freshNodes > 0).length, [rows]);
  const maxNodes = useMemo(() => Math.max(1, ...(rows ?? []).map((r) => r.freshNodes)), [rows]);
  const pct = totalContexts > 0 ? Math.round((covered / totalContexts) * 100) : 0;

  return (
    <BaseModal isOpen onClose={onClose} titleId="skill-contexts-title" size="md" portal staggerChildren={false}>
      <div className="flex flex-col max-h-[70vh]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.04]">
          <MapIcon className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
          <span id="skill-contexts-title" className="typo-title truncate">{skill} — context coverage</span>
          <span className="ml-auto typo-caption text-foreground/60 tabular-nums flex-shrink-0">{covered}/{totalContexts} · {pct}% · 30d</span>
        </div>
        <div className="flex items-center justify-between px-4 pt-2.5">
          <span className="typo-label text-foreground/40 truncate">{projectName}</span>
          <SegmentedTabs
            tabs={[{ id: 'bars', label: 'Bars' }, { id: 'grid', label: 'Grid' }]}
            activeTab={variant}
            onTabChange={setVariant}
            variant="segment"
            size="sm"
            fullWidth={false}
            ariaLabel="Context detail variant"
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          {rows === null ? (
            <div className="py-8"><LoadingSpinner label="Loading contexts…" /></div>
          ) : rows.length === 0 ? (
            <p className="typo-caption text-foreground/45 py-8 text-center">This project has no scanned contexts yet — run a context scan first.</p>
          ) : variant === 'bars' ? (
            <ul className="space-y-1">
              {rows.map((r) => {
                const on = r.freshNodes > 0;
                return (
                  <li key={r.contextId} className="flex items-center gap-2.5 py-1">
                    <span className={`typo-caption truncate w-40 flex-shrink-0 ${on ? 'text-foreground' : 'text-foreground/40'}`}>{r.name}</span>
                    <span className="flex-1 h-[5px] rounded-full bg-foreground/[0.08] overflow-hidden">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${Math.round((r.freshNodes / maxNodes) * 100)}%`, background: on ? '#34D399' : 'transparent' }}
                      />
                    </span>
                    <span className="typo-label text-foreground/50 tabular-nums w-14 text-right flex-shrink-0">{on ? `${r.freshNodes} notes` : '—'}</span>
                    <span className="typo-label text-foreground/35 w-16 text-right flex-shrink-0">
                      {r.latestAt ? <RelativeTime timestamp={r.latestAt} className="tabular-nums" /> : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {rows.map((r) => {
                const on = r.freshNodes > 0;
                return (
                  <div
                    key={r.contextId}
                    title={on ? `${r.name} — ${r.freshNodes} fresh notes` : `${r.name} — no notes (30d)`}
                    className={`px-2 py-1.5 rounded-interactive border text-left ${on ? 'border-emerald-400/30 bg-emerald-400/[0.08]' : 'border-primary/10 bg-secondary/20 opacity-60'}`}
                  >
                    <span className={`typo-label truncate block ${on ? 'text-foreground' : 'text-foreground/45'}`}>{r.name}</span>
                    <span className="typo-label tabular-nums" style={{ color: on ? '#34D399' : 'rgba(148,163,184,.5)' }}>
                      {on ? `${r.freshNodes}` : '0'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
