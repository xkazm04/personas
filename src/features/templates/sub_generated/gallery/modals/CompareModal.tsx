import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { getCategoryMeta } from '../search/filters/searchConstants';
import { DIFFICULTY_META } from '../../shared/templateComplexity';
import { useTranslation } from '@/i18n/useTranslation';
import type { CompareColumn } from '../cards/buildComparison';

interface CompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  columns: CompareColumn[];
}

const TITLE_ID = 'template-compare-title';

export function CompareModal({ isOpen, onClose, columns }: CompareModalProps) {
  const { t, tx } = useTranslation();
  const none = <span className="text-foreground">{t.templates.compare.none}</span>;

  // Each dimension is one table row; cells render per column (template).
  const dimensions: { label: string; render: (col: CompareColumn) => ReactNode }[] = [
    {
      label: t.templates.compare.col_category,
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
      render: (col) =>
        col.goal ? <span className="typo-body text-foreground line-clamp-3">{col.goal}</span> : none,
    },
    {
      label: t.templates.card.connectors_label,
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
      render: (col) => <span className="typo-body text-foreground">{col.triggerCount || 0}</span>,
    },
    {
      label: t.templates.card.use_cases_label,
      render: (col) => <span className="typo-body text-foreground">{col.flowCount || 0}</span>,
    },
    {
      label: t.templates.compare.col_complexity,
      render: (col) => (
        <span className={`inline-flex items-center px-2 py-0.5 typo-caption font-medium rounded-card border ${DIFFICULTY_META[col.difficulty].bgClass}`}>
          {t.templates.complexity[col.difficulty]}
        </span>
      ),
    },
    {
      label: t.templates.compare.col_setup,
      render: (col) => (
        <span className="typo-body text-foreground">{tx(t.templates.complexity.minuteShort, { minutes: col.setupMinutes })}</span>
      ),
    },
    {
      label: t.templates.list.adoptions,
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
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dimensions.map((dim) => (
                <tr key={dim.label} className="border-t border-primary/5">
                  <th scope="row" className="text-left align-top py-3 pr-3 typo-caption font-medium text-foreground uppercase tracking-wide">
                    {dim.label}
                  </th>
                  {columns.map((col) => (
                    <td key={col.id} className="align-top px-3 py-3">
                      {dim.render(col)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </BaseModal>
  );
}
