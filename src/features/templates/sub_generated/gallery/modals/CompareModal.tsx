import type { ReactNode } from 'react';
import { X, Download, Play } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { getConnectorMeta, ConnectorIcon } from '@/lib/connectors/connectorMeta';
import { getCategoryMeta } from '../search/filters/searchConstants';
import { DIFFICULTY_META } from '../../shared/templateComplexity';
import { useTranslation } from '@/i18n/useTranslation';
import type { CompareColumn } from '../cards/buildComparison';

interface CompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  columns: CompareColumn[];
  /** Act-in-place: open the adoption flow for one compared template. */
  onAdopt?: (id: string) => void;
  /** Act-in-place: open the try-it preview for one compared template. */
  onTryIt?: (id: string) => void;
}

const TITLE_ID = 'template-compare-title';

export function CompareModal({ isOpen, onClose, columns, onAdopt, onTryIt }: CompareModalProps) {
  const { t, tx } = useTranslation();
  const none = <span className="text-foreground">{t.templates.compare.none}</span>;

  // Each dimension is one table row; cells render per column (template).
  // `signature` feeds the diff highlight: a row is accented when 2+ columns
  // disagree on its signature, so differences pop instead of being read for.
  const dimensions: { label: string; signature: (col: CompareColumn) => string; render: (col: CompareColumn) => ReactNode }[] = [
    {
      label: t.templates.compare.col_category,
      signature: (col) => col.category ?? '',
      render: (col) => {
        if (!col.category) return none;
        const meta = getCategoryMeta(col.category);
        return (
          <span className="inline-flex items-center gap-1.5 typo-body text-foreground">
            <meta.icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: meta.color }} />
            {meta.label}
          </span>
        );
      },
    },
    {
      label: t.templates.compare.col_goal,
      signature: (col) => col.goal ?? '',
      render: (col) =>
        col.goal ? <span className="typo-body text-foreground line-clamp-3">{col.goal}</span> : none,
    },
    {
      label: t.templates.card.connectors_label,
      signature: (col) => col.connectors.map((c) => c.name).sort().join(','),
      render: (col) =>
        col.connectors.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {col.connectors.map((c) => {
              const meta = getConnectorMeta(c.name);
              return (
                <Tooltip key={c.name} content={meta.label} placement="bottom">
                  <div
                    className={`w-7 h-7 rounded-card flex items-center justify-center transition-opacity ${c.ready ? '' : 'opacity-30 grayscale'}`}
                    style={{ backgroundColor: `${meta.color}18` }}
                  >
                    <ConnectorIcon meta={meta} size="w-4 h-4" />
                  </div>
                </Tooltip>
              );
            })}
          </div>
        ) : (
          none
        ),
    },
    {
      label: t.templates.card.triggers_label,
      signature: (col) => String(col.triggerCount || 0),
      render: (col) => <span className="typo-body text-foreground">{col.triggerCount || 0}</span>,
    },
    {
      label: t.templates.card.use_cases_label,
      signature: (col) => String(col.flowCount || 0),
      render: (col) => <span className="typo-body text-foreground">{col.flowCount || 0}</span>,
    },
    {
      label: t.templates.compare.col_complexity,
      signature: (col) => col.difficulty,
      render: (col) => (
        <span className={`inline-flex items-center px-2 py-0.5 typo-caption font-medium rounded-card border ${DIFFICULTY_META[col.difficulty].bgClass}`}>
          {t.templates.complexity[col.difficulty]}
        </span>
      ),
    },
    {
      label: t.templates.compare.col_setup,
      signature: (col) => String(col.setupMinutes),
      render: (col) => (
        <span className="typo-body text-foreground">{tx(t.templates.complexity.minuteShort, { minutes: col.setupMinutes })}</span>
      ),
    },
    {
      label: t.templates.list.adoptions,
      signature: (col) => String(col.adoptionCount || 0),
      render: (col) => <span className="typo-body text-foreground">{col.adoptionCount || 0}</span>,
    },
  ];

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId={TITLE_ID} size="6xl" portal staggerChildren={false}>
      <div className="flex flex-col max-h-[85vh]">
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-primary/10 flex-shrink-0">
          <div>
            <h2 id={TITLE_ID} className="typo-heading font-semibold text-foreground">
              {t.templates.compare.title}
            </h2>
            <p className="typo-body text-foreground mt-0.5">
              {tx(t.templates.compare.subtitle, { count: columns.length })}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t.common.close}
            className="p-1.5 rounded-interactive text-foreground hover:bg-secondary/40 transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-auto px-6 py-4">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="w-32 text-left align-bottom" />
                {columns.map((col) => (
                  <th key={col.id} className="text-left align-bottom px-3 pb-3 min-w-[180px]">
                    <span className="typo-body-lg font-semibold template-name-themed line-clamp-2">{col.name}</span>
                    {(onAdopt || onTryIt) && (
                      <div className="flex items-center gap-1.5 mt-2">
                        {onAdopt && (
                          <button
                            onClick={() => onAdopt(col.id)}
                            data-testid={`compare-adopt-${col.id}`}
                            className="inline-flex items-center gap-1 px-2 py-1 typo-caption font-medium rounded-interactive bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors"
                          >
                            <Download className="w-3 h-3" />
                            {t.templates.actions.adopt}
                          </button>
                        )}
                        {onTryIt && col.hasDesign && (
                          <button
                            onClick={() => onTryIt(col.id)}
                            data-testid={`compare-tryit-${col.id}`}
                            className="inline-flex items-center gap-1 px-2 py-1 typo-caption font-medium rounded-interactive bg-emerald-500/10 text-emerald-400/80 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                          >
                            <Play className="w-3 h-3" />
                            {t.templates.actions.try_it}
                          </button>
                        )}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dimensions.map((dim) => {
                const differs = columns.length >= 2 && new Set(columns.map(dim.signature)).size > 1;
                return (
                  <tr key={dim.label} className={`border-t border-primary/5 ${differs ? 'bg-amber-500/[0.05]' : ''}`}>
                    <th scope="row" className="text-left align-top py-3 pr-3 typo-caption font-medium text-foreground uppercase tracking-wide">
                      <span className="inline-flex items-center gap-1.5">
                        {differs && (
                          <Tooltip content={t.templates.compare.differs} placement="right">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                          </Tooltip>
                        )}
                        {dim.label}
                      </span>
                    </th>
                    {columns.map((col) => (
                      <td key={col.id} className="align-top px-3 py-3">
                        {dim.render(col)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </BaseModal>
  );
}
