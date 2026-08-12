// STRATA — the atlas metaphor. Three navigable panes mirror the three
// layers: principles of the area on the left (the stratum you stand on),
// the chosen principle's manifestations in the centre (grouped by cluster),
// and the selected manifestation's full record — statement, facts, evidence,
// governance — on the right. Navigation-first: the modal IS the hierarchy,
// and you walk it without ever closing.
import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { KnowledgeStatusChip } from '@/features/plugins/dev-tools/sub_workspaces/centerShared';
import { useTranslation } from '@/i18n/useTranslation';

import { areaTheme } from '../practiceAreaTheme';
import { hierarchyStats } from './hierarchyModel';
import { EvidenceBlock, GovernanceDock, LayerBadge } from './shared';
import type { UnifiedViewProps } from './types';

export function VariantStrata({
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
  const area = head.topic.split('/')[0] ?? '';
  const focusIsHead = focus.id === head.id;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex-1 min-h-0 flex divide-x divide-primary/10">
        {/* LEFT — principles of this area */}
        <aside className="w-[220px] flex-shrink-0 min-h-0 overflow-y-auto px-3 py-4 bg-secondary/15 hidden lg:block">
          <span className={`typo-label px-1.5 py-0.5 rounded ${theme.chip}`}>{area}</span>
          <div className="flex flex-col gap-1 mt-3">
            {hierarchy.siblingPrinciples.map((s) => {
              const current = s.id === head.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onAnchor(s)}
                  className={`text-left rounded-card px-2.5 py-2 border transition-colors ${
                    current
                      ? 'bg-foreground/[0.05] border-border'
                      : 'bg-transparent border-transparent hover:bg-foreground/[0.03]'
                  }`}
                >
                  <span className={`typo-caption block leading-snug ${current ? 'text-foreground font-medium' : 'text-foreground/70'}`}>
                    {s.title}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* CENTRE — the principle and its manifestation strata */}
        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto px-6 py-5">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <LayerBadge layer={head.layer} />
            <KnowledgeStatusChip status={head.status} />
            <span className="typo-caption text-muted-foreground tabular-nums">
              {stats.manifestations} manifestations{stats.evidenceTotal != null ? ` · ${stats.evidenceTotal} evidence` : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onFocus(head)}
            className="text-left w-full group"
          >
            <h2
              id="unified-practice"
              className={`typo-title leading-snug transition-colors ${focusIsHead ? 'text-primary' : 'text-foreground group-hover:text-primary'}`}
            >
              {head.title}
            </h2>
          </button>
          <p className="typo-body text-muted-foreground leading-relaxed mt-2">{head.statement}</p>

          {hierarchy.groups.map((g) => (
            <div key={g.cluster || '_'} className="mt-5">
              {g.cluster && (
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="typo-label text-muted-foreground uppercase tracking-wide">{g.cluster}</span>
                  <span className="flex-1 h-px bg-border/50" aria-hidden />
                  <span className="typo-caption text-foreground/45 tabular-nums">{g.items.length}</span>
                </div>
              )}
              <div className="flex flex-col gap-1">
                {g.items.map((m) => {
                  const selected = focus.id === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onFocus(m)}
                      className={`text-left rounded-card border px-3 py-2 transition-colors ${
                        selected
                          ? 'border-primary/40 bg-primary/[0.06]'
                          : 'border-border/50 bg-background hover:border-border hover:bg-secondary/20'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className={`typo-body min-w-0 flex-1 ${selected ? 'text-foreground font-medium' : 'text-foreground/85'}`}>
                          {m.title}
                        </span>
                        {(m.evidenceCount ?? 0) > 0 && (
                          <span className="typo-caption text-foreground/50 tabular-nums flex-shrink-0">×{m.evidenceCount}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* RIGHT — the selected record in full */}
        <aside className="w-[340px] flex-shrink-0 min-h-0 overflow-y-auto px-5 py-5 bg-secondary/10 hidden md:flex md:flex-col">
          <div className="flex items-center gap-2 flex-wrap">
            <LayerBadge layer={focus.layer} />
            <KnowledgeStatusChip status={focus.status} />
          </div>
          <h3 className="typo-heading text-foreground leading-snug mt-2">{focus.title}</h3>
          <p className="typo-body text-muted-foreground leading-relaxed mt-2">{focus.statement}</p>

          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
            <span className="typo-caption text-muted-foreground">
              <span className="typo-label">{tw.col_origin}</span>{' '}
              {focus.originProjectId ? projectById.get(focus.originProjectId)?.name ?? tw.origin_removed : tw.origin_workspace}
            </span>
            {focus.confidence != null && (
              <span className="typo-caption text-muted-foreground tabular-nums">
                <span className="typo-label">{tw.col_confidence}</span> {Math.round(focus.confidence * 100)}%
              </span>
            )}
            <span className="typo-caption text-muted-foreground">
              <span className="typo-label">{tw.col_updated}</span> <RelativeTime timestamp={focus.updatedAt} />
            </span>
          </div>

          <div className="mt-4 border-t border-border/50 pt-2 flex-1">
            <span className="typo-label text-muted-foreground">Evidence</span>
            <EvidenceBlock itemId={focus.id} evidence={evidence} loading={evidenceLoading} projectById={projectById} />
          </div>

          <div className="mt-3 pt-3 border-t border-border/50">
            <GovernanceDock item={focus} busy={busy} onDecide={onDecide} onRollout={onRollout} />
          </div>
        </aside>
      </div>

      <footer className="flex items-center px-6 py-3 border-t border-primary/10 flex-shrink-0">
        <Button variant="ghost" onClick={onClose} className="ml-auto whitespace-nowrap">
          {t.common.close}
        </Button>
      </footer>
    </div>
  );
}
