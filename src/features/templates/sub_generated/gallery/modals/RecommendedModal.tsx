import { X, Sparkles, Download } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { BaseModal } from '../../shared/BaseModal';
import { parseJsonOrDefault as parseJsonSafe } from '@/lib/utils/parseJson';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

interface RecommendedModalProps {
  isOpen: boolean;
  onClose: () => void;
  recommendedTemplates: PersonaDesignReview[];
  onSelectTemplate: (template: PersonaDesignReview) => void;
}

export function RecommendedModal({
  isOpen,
  onClose,
  recommendedTemplates,
  onSelectTemplate,
}: RecommendedModalProps) {
  const { t } = useTranslation();
  if (!isOpen) return null;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="recommended-modal-title"
      maxWidthClass="max-w-lg"
      panelClassName="max-h-[70vh] bg-background border border-primary/15 rounded-2xl shadow-elevation-4 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-primary/10 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400/70" />
          <h2 id="recommended-modal-title" className="text-sm font-semibold text-foreground/90">
            {t.templates.recommended.title}
          </h2>
          <span className="text-xs text-muted-foreground/60">
            {t.templates.recommended.subtitle}
          </span>
        </div>
        <button onClick={onClose} className="p-1 rounded-card hover:bg-secondary/50 transition-colors">
          <X className="w-4 h-4 text-muted-foreground/70" />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {recommendedTemplates.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground/50">
            {t.templates.recommended.no_recommendations}
          </div>
        ) : (
          <div className="divide-y divide-primary/5">
            {recommendedTemplates.map((t) => {
              const connectors: string[] = parseJsonSafe(t.connectors_used, []);
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    onSelectTemplate(t);
                    onClose();
                  }}
                  className="w-full flex items-center gap-3 px-5 py-3 hover:bg-secondary/30 transition-colors text-left group"
                >
                  {/* Name + description */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground/80 group-hover:text-amber-300 truncate">
                      {t.test_case_name}
                    </div>
                    <div className="text-xs text-muted-foreground/50 truncate mt-0.5">
                      {t.instruction.length > 70 ? t.instruction.slice(0, 70) + '...' : t.instruction}
                    </div>
                  </div>

                  {/* Connector icons */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {connectors.slice(0, 3).map((c) => {
                      const meta = getConnectorMeta(c);
                      return (
                        <div
                          key={c}
                          className="w-5 h-5 rounded flex items-center justify-center"
                          style={{ backgroundColor: `${meta.color}18` }}
                          title={meta.label}
                        >
                          <ConnectorIcon meta={meta} size="w-3 h-3" />
                        </div>
                      );
                    })}
                    {connectors.length > 3 && (
                      <span className="text-xs text-muted-foreground/60">+{connectors.length - 3}</span>
                    )}
                  </div>

                  {/* Adoption count */}
                  {t.adoption_count > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs font-mono text-emerald-400/60 flex-shrink-0">
                      <Download className="w-2.5 h-2.5" />
                      {t.adoption_count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </BaseModal>
  );
}
