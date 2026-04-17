import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PenLine } from 'lucide-react';
import { getTemplateCatalog } from '@/lib/personas/templates/templateCatalog';
import type { TemplateCatalogEntry } from '@/lib/types/templateTypes';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { iconIdForCategories, toAgentIconValue } from '@/lib/icons/agentIconCatalog';
import { useTranslation } from '@/i18n/useTranslation';

const CATEGORY_LABELS: Record<string, string> = {
  all: 'All',
  devops: 'DevOps',
  quality: 'Quality',
  productivity: 'Productivity',
  communication: 'Communication',
  security: 'Security',
  data: 'Data',
  documentation: 'Docs',
  testing: 'Testing',
  monitoring: 'Monitoring',
  email: 'Email',
  maintenance: 'Maintenance',
  automation: 'Automation',
  'project-management': 'PM',
};

function deriveCategories(catalog: TemplateCatalogEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const t of catalog) {
    for (const c of t.category) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([cat]) => cat);
}

/** Derive agent-icon alias from template categories. */
function templateAgentIcon(template: TemplateCatalogEntry): string {
  return toAgentIconValue(iconIdForCategories(template.category));
}

interface TemplatePickerStepProps {
  /** Called when a template is selected (advances to identity step). */
  onSelect: (template: TemplateCatalogEntry) => void;
  /** Called when user wants to start from scratch. */
  onFromScratch: () => void;
  /** Called when user wants to cancel (only shown when canCancel is true). */
  onCancel?: () => void;
}

export function TemplatePickerStep({ onSelect, onFromScratch, onCancel }: TemplatePickerStepProps) {
  const { t } = useTranslation();
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [catalog, setCatalog] = useState<TemplateCatalogEntry[]>([]);
  const [filterCategories, setFilterCategories] = useState<string[]>([]);

  useEffect(() => {
    getTemplateCatalog().then((entries) => {
      setCatalog(entries);
      setFilterCategories(deriveCategories(entries));
    });
  }, []);

  const filteredTemplates = useMemo(
    () =>
      activeFilter === 'all'
        ? catalog
        : catalog.filter((t) => t.category.includes(activeFilter)),
    [activeFilter, catalog],
  );

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-6 max-w-lg 2xl:max-w-2xl 3xl:max-w-3xl 4xl:max-w-4xl w-full px-6"
    >
      <div>
        <h2 className="text-lg font-semibold text-foreground/90">{t.agents.template_picker.title}</h2>
        <p className="text-sm text-foreground mt-1">
          {t.agents.template_picker.subtitle}
        </p>
      </div>

      <div className="max-h-[calc(100vh-280px)] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-primary/15 scrollbar-track-transparent">
        {/* Sticky category filter chips */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm pb-3 flex gap-1.5 flex-wrap">
          <button
            onClick={() => setActiveFilter('all')}
            className={`relative px-2.5 py-1 text-sm font-medium rounded-modal border transition-colors ${activeFilter === 'all'
                ? 'border-primary/30 text-foreground'
                : 'border-primary/10 text-foreground hover:text-muted-foreground hover:border-primary/20'
              }`}
          >
            {activeFilter === 'all' && (
              <motion.div
                layoutId="template-filter-pill"
                className="absolute inset-0 bg-primary/10 rounded-card"
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            )}
            <span className="relative z-10">All</span>
          </button>
          {filterCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveFilter(cat)}
              className={`relative px-2.5 py-1 text-sm font-medium rounded-modal border transition-colors ${activeFilter === cat
                  ? 'border-primary/30 text-foreground'
                  : 'border-primary/10 text-foreground hover:text-muted-foreground hover:border-primary/20'
                }`}
            >
              {activeFilter === cat && (
                <motion.div
                  layoutId="template-filter-pill"
                  className="absolute inset-0 bg-primary/10 rounded-card"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
              <span className="relative z-10">{CATEGORY_LABELS[cat] ?? cat}</span>
            </button>
          ))}
        </div>

        {/* Template grid with layout animation */}
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          <AnimatePresence mode="popLayout">
            {filteredTemplates.map((template) => {
              return (
                <motion.button
                  key={template.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => onSelect(template)}
                  className="flex items-start gap-3 p-3 rounded-modal border border-primary/10 bg-secondary/20 hover:bg-secondary/40 hover:border-primary/20 transition-colors text-left"
                >
                  <div
                    className="icon-frame-md icon-frame-pop flex-shrink-0 border"
                    style={{
                      backgroundColor: `${template.color}18`,
                      borderColor: `${template.color}30`,
                    }}
                  >
                    <PersonaIcon icon={templateAgentIcon(template)} color={template.color} size="w-5 h-5" framed frameSize='lg' />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground/85 truncate">{template.name}</p>
                    <p className="text-sm text-foreground line-clamp-2 leading-relaxed mt-0.5">
                      {template.description}
                    </p>
                  </div>
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      <div className="flex items-center justify-between">
        {onCancel ? (
          <button
            onClick={onCancel}
            className="px-4 py-2.5 text-sm text-foreground hover:text-muted-foreground transition-colors"
          >
            {t.common.cancel}
          </button>
        ) : (
          <div />
        )}
        <button
          onClick={onFromScratch}
          className="px-4 py-2.5 text-sm text-foreground hover:text-muted-foreground transition-colors flex items-center gap-1.5"
        >
          <PenLine className="w-3.5 h-3.5" />
          {t.agents.template_picker.start_from_scratch}
        </button>
      </div>
    </motion.div>
  );
}
