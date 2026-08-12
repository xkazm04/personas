// CASEFILE — the audit metaphor. The principle is a RULING BANNER carrying
// its aggregate facts (manifestations, clusters, evidence, verified share);
// below it, every manifestation is a case card with its evidence rows INLINE
// — refs, quote, project, verification freshness — filterable by cluster.
// Evidence-first: this is the view for "prove it", where the other two are
// for reading and for navigating.
import { useMemo, useState } from 'react';

import Button from '@/features/shared/components/buttons/Button';
import { KnowledgeStatusChip } from '@/features/plugins/dev-tools/sub_workspaces/centerShared';
import { useTranslation } from '@/i18n/useTranslation';

import { areaTheme } from '../practiceAreaTheme';
import { hierarchyStats } from './hierarchyModel';
import { EvidenceBlock, GovernanceDock, LayerBadge } from './shared';
import type { UnifiedViewProps } from './types';

function BannerStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-start">
      <span className="typo-data-lg text-foreground tabular-nums leading-none">{value}</span>
      <span className="typo-label text-muted-foreground mt-1">{label}</span>
    </div>
  );
}

export function VariantCasefile({
  hierarchy,
  focus,
  onFocus,
  evidence,
  evidenceLoading,
  projectById,
  busy,
  onDecide,
  onRollout,
  onClose,
}: UnifiedViewProps) {
  const { t } = useTranslation();
  const head = hierarchy.principle ?? hierarchy.anchor;
  const theme = areaTheme(head.topic);
  const stats = hierarchyStats(hierarchy, evidence);
  const [cluster, setCluster] = useState<string | null>(null);

  const verifiedShare = useMemo(() => {
    let total = 0;
    let verified = 0;
    for (const rows of evidence.values()) {
      for (const r of rows) {
        total += 1;
        if (r.verifiedAt) verified += 1;
      }
    }
    return total === 0 ? null : Math.round((verified / total) * 100);
  }, [evidence]);

  const shownGroups = cluster
    ? hierarchy.groups.filter((g) => g.cluster === cluster)
    : hierarchy.groups;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* RULING BANNER */}
      <div className={`px-6 pt-5 pb-4 border-b-2 flex-shrink-0 ${theme.rail.replace('border-l-', 'border-b-') || 'border-border'} bg-secondary/15`}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`typo-label px-1.5 py-0.5 rounded ${theme.chip}`}>{head.topic}</span>
          <LayerBadge layer={head.layer} />
          <KnowledgeStatusChip status={head.status} />
        </div>
        <div className="flex items-end justify-between gap-6 mt-2.5">
          <div className="min-w-0">
            <h2 id="unified-practice" className="typo-title text-foreground leading-snug">
              {head.title}
            </h2>
            <p className="typo-body text-muted-foreground leading-relaxed mt-1.5 max-w-[62ch]">
              {head.statement}
            </p>
          </div>
          <div className="hidden md:flex items-center gap-7 flex-shrink-0 pb-1">
            <BannerStat label="manifestations" value={String(stats.manifestations)} />
            <BannerStat label="evidence" value={stats.evidenceTotal == null ? '—' : String(stats.evidenceTotal)} />
            <BannerStat label="verified" value={verifiedShare == null ? '—' : `${verifiedShare}%`} />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          {hierarchy.groups.length > 1 ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setCluster(null)}
                className={`typo-label px-2 py-0.5 rounded-pill border transition-colors ${
                  cluster === null ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border/60 text-foreground/60 hover:text-foreground'
                }`}
              >
                all
              </button>
              {hierarchy.groups.filter((g) => g.cluster).map((g) => (
                <button
                  key={g.cluster}
                  type="button"
                  onClick={() => setCluster(cluster === g.cluster ? null : g.cluster)}
                  className={`typo-label px-2 py-0.5 rounded-pill border transition-colors ${
                    cluster === g.cluster ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border/60 text-foreground/60 hover:text-foreground'
                  }`}
                >
                  {g.cluster} <span className="tabular-nums text-foreground/45">{g.items.length}</span>
                </button>
              ))}
            </div>
          ) : <span />}
          <div className="flex-shrink-0">
            <GovernanceDock item={head} busy={busy} layout="inline" onDecide={onDecide} onRollout={onRollout} />
          </div>
        </div>
      </div>

      {/* CASE CARDS */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
        {hierarchy.groups.length === 0 && (
          <EvidenceBlock itemId={head.id} evidence={evidence} loading={evidenceLoading} projectById={projectById} />
        )}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {shownGroups.flatMap((g) => g.items).map((m) => {
            const isFocus = focus.id === m.id;
            return (
              <article
                key={m.id}
                className={`rounded-card border bg-background px-4 py-3 shadow-elevation-1 transition-colors ${
                  isFocus ? 'border-primary/40' : 'border-border/60'
                }`}
              >
                <button type="button" onClick={() => onFocus(m)} className="text-left w-full group">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="typo-body font-medium text-foreground group-hover:text-primary transition-colors min-w-0">
                      {m.title}
                    </h3>
                    <span className="typo-caption text-foreground/45 flex-shrink-0">
                      {m.topic.split('/')[1] ?? ''}
                    </span>
                  </div>
                  <p className="typo-caption text-muted-foreground leading-relaxed mt-1 line-clamp-2">
                    {m.statement}
                  </p>
                </button>
                <div className="mt-2 border-t border-border/40">
                  <EvidenceBlock itemId={m.id} evidence={evidence} loading={evidenceLoading} projectById={projectById} />
                </div>
                {isFocus && (
                  <div className="mt-1.5 pt-2 border-t border-border/40">
                    <GovernanceDock item={m} busy={busy} layout="inline" onDecide={onDecide} onRollout={onRollout} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>

      <footer className="flex items-center px-6 py-3 border-t border-primary/10 flex-shrink-0">
        <Button variant="ghost" onClick={onClose} className="ml-auto whitespace-nowrap">
          {t.common.close}
        </Button>
      </footer>
    </div>
  );
}
