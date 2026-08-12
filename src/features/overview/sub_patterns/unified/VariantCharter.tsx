// CHARTER — the document metaphor. A principle reads like a charter page:
// accent-barred lede, then its manifestations as numbered CLAUSES grouped by
// cluster (§ sections), each expanding its evidence as footnote citations.
// Prose left, facts + governance in a margin rail — the Ledger's
// separation-of-kind, taught the hierarchy. Reading-first: you meet the
// doctrine as an argument, not a card pile.
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { KnowledgeStatusChip } from '@/features/plugins/dev-tools/sub_workspaces/centerShared';
import { useTranslation } from '@/i18n/useTranslation';

import { areaTheme } from '../practiceAreaTheme';
import { hierarchyStats } from './hierarchyModel';
import { EvidenceBlock, GovernanceDock, LayerBadge } from './shared';
import type { UnifiedViewProps } from './types';

function MarginRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 min-w-0">
      <span className="typo-label text-muted-foreground">{label}</span>
      <span className="typo-body text-foreground break-words">{children}</span>
    </div>
  );
}

export function VariantCharter({
  hierarchy,
  focus,
  onFocus,
  onAnchor,
  evidence,
  evidenceLoading,
  projectById,
  busy,
  onDecide,
  onRollout,
  onClose,
}: UnifiedViewProps) {
  const { t } = useTranslation();
  const tw = t.plugins.dev_tools.workspaces;
  const head = hierarchy.principle ?? hierarchy.anchor;
  const theme = areaTheme(head.topic);
  const stats = hierarchyStats(hierarchy, evidence);
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(hierarchy.anchor.id === head.id ? [] : [hierarchy.anchor.id]),
  );
  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  let clauseNo = 0;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-col md:flex-row md:divide-x divide-primary/10">
          {/* THE DOCUMENT */}
          <div className="md:flex-1 min-w-0 px-7 py-6">
            <div className="flex items-center gap-2 flex-wrap mb-2.5">
              <span className={`typo-label px-1.5 py-0.5 rounded ${theme.chip}`}>{head.topic}</span>
              <LayerBadge layer={head.layer} />
              <KnowledgeStatusChip status={head.status} />
            </div>
            <h2 id="unified-practice" className="typo-title text-foreground leading-snug">
              {head.title}
            </h2>
            <p className={`typo-body-lg text-foreground leading-relaxed border-l-2 pl-4 mt-4 ${theme.rail}`}>
              {head.statement}
            </p>
            {stats.manifestations > 0 && (
              <p className="typo-caption text-muted-foreground mt-3">
                {stats.manifestations} manifestations{stats.evidenceTotal != null ? ` · ${stats.evidenceTotal} evidence records` : ''}
              </p>
            )}

            {/* CLAUSES, by cluster */}
            {hierarchy.groups.map((g) => (
              <section key={g.cluster || '_'} className="mt-7">
                {g.cluster && (
                  <h3 className="typo-label text-muted-foreground tracking-wide uppercase mb-1">
                    § {g.cluster}
                  </h3>
                )}
                <div className="divide-y divide-border/40">
                  {g.items.map((m) => {
                    clauseNo += 1;
                    const expanded = open.has(m.id);
                    const isFocus = focus.id === m.id;
                    return (
                      <article key={m.id} className={`py-3.5 ${isFocus ? 'bg-primary/[0.04] -mx-3 px-3 rounded-card' : ''}`}>
                        <button
                          type="button"
                          onClick={() => { toggle(m.id); onFocus(m); }}
                          className="w-full text-left flex items-start gap-2.5 group"
                        >
                          <span className="typo-data-sm font-mono text-foreground/40 tabular-nums pt-0.5 w-7 flex-shrink-0">
                            {String(clauseNo).padStart(2, '0')}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="typo-body font-medium text-foreground group-hover:text-primary transition-colors">
                              {m.title}
                            </span>
                            {!expanded && (
                              <span className="typo-caption text-muted-foreground block mt-0.5 line-clamp-1">
                                {m.statement}
                              </span>
                            )}
                          </span>
                          <span className="flex items-center gap-2 flex-shrink-0 pt-0.5">
                            {(m.evidenceCount ?? 0) > 0 && (
                              <span className="typo-caption text-foreground/50 tabular-nums">×{m.evidenceCount}</span>
                            )}
                            {expanded
                              ? <ChevronDown className="w-4 h-4 text-foreground/45" aria-hidden />
                              : <ChevronRight className="w-4 h-4 text-foreground/45" aria-hidden />}
                          </span>
                        </button>
                        {expanded && (
                          <div className="pl-9 pt-2 flex flex-col gap-2">
                            <p className="typo-body text-foreground leading-relaxed">{m.statement}</p>
                            <div className="border-t border-border/40 pt-1">
                              <span className="typo-label text-muted-foreground">Citations</span>
                              <EvidenceBlock itemId={m.id} evidence={evidence} loading={evidenceLoading} projectById={projectById} />
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}

            {hierarchy.groups.length === 0 && (
              <div className="mt-6">
                <span className="typo-label text-muted-foreground">Evidence</span>
                <EvidenceBlock itemId={head.id} evidence={evidence} loading={evidenceLoading} projectById={projectById} />
              </div>
            )}
          </div>

          {/* MARGIN RAIL — facts of the focused item + governance + siblings */}
          <aside className="md:w-[270px] shrink-0 px-5 py-4 bg-secondary/20 flex flex-col">
            <span className="typo-label text-muted-foreground truncate" title={focus.title}>
              {focus.id === head.id ? 'This principle' : focus.title}
            </span>
            <div className="divide-y divide-primary/10">
              <MarginRow label={tw.col_origin}>
                {focus.originProjectId ? projectById.get(focus.originProjectId)?.name ?? tw.origin_removed : tw.origin_workspace}
              </MarginRow>
              <MarginRow label={tw.col_confidence}>
                {focus.confidence == null ? '—' : `${Math.round(focus.confidence * 100)}%`}
              </MarginRow>
              <MarginRow label={tw.col_updated}><RelativeTime timestamp={focus.updatedAt} /></MarginRow>
            </div>
            <div className="mt-3 pt-3 border-t border-primary/10">
              <GovernanceDock item={focus} busy={busy} onDecide={onDecide} onRollout={onRollout} />
            </div>

            {hierarchy.siblingPrinciples.length > 1 && (
              <div className="mt-5 pt-3 border-t border-primary/10">
                <span className="typo-label text-muted-foreground">Related charters</span>
                <div className="flex flex-col gap-0.5 mt-1.5">
                  {hierarchy.siblingPrinciples.filter((s) => s.id !== head.id).slice(0, 6).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onAnchor(s)}
                      className="typo-caption text-left text-foreground/70 hover:text-primary transition-colors line-clamp-2"
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>
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
