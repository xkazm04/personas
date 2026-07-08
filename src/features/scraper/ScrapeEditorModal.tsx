import { useState } from 'react';

import type { ScraperConfig, ScraperConfigInput } from '@/api/scraper';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { BaseModal } from '@/lib/ui/BaseModal';

import { ScrapeEditorBlueprint } from './ScrapeEditorBlueprint';
import { ScrapeEditorComposer } from './ScrapeEditorComposer';
import { ScrapeEditorWizard } from './ScrapeEditorWizard';
import { useScrapeForm, type EditorVariantProps } from './useScrapeForm';

/**
 * Scrape editor (Phase 1b-2), prototyped via /prototype — three directional
 * layouts over one shared form spine (useScrapeForm) + LLM pipeline builder:
 *  - Wizard   — guided one-step-at-a-time assembly line
 *  - Composer — whole pipeline on one scroll canvas
 *  - Blueprint— wired node diagram, jump to any stage
 *
 * All three edit the same steps (Source → Extract → Output → Schedule) and share
 * the "Build with Claude" generator, so the difference is purely how you move
 * through the pipeline.
 */
interface ScrapeEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initial?: ScraperConfig | null;
  onSave: (input: ScraperConfigInput) => Promise<unknown>;
}

type EditorVariant = 'wizard' | 'composer' | 'blueprint';

const VARIANT_TABS = [
  { id: 'wizard' as const, label: 'Wizard' },
  { id: 'composer' as const, label: 'Composer' },
  { id: 'blueprint' as const, label: 'Blueprint' },
];

export function ScrapeEditorModal({ isOpen, onClose, initial, onSave }: ScrapeEditorModalProps) {
  const form = useScrapeForm(initial ?? null, isOpen);
  const [variant, setVariant] = useState<EditorVariant>('wizard');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.canSave) return;
    setSaving(true);
    try {
      await onSave(form.toInput());
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const variantProps: EditorVariantProps = {
    form,
    isEdit: Boolean(initial),
    saving,
    onCancel: onClose,
    onSave: handleSave,
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId="scrape-editor" size="xl" staggerChildren={false}>
      <div className="flex items-center justify-between border-b border-primary/10 px-4 py-2.5">
        <SegmentedTabs<EditorVariant>
          tabs={VARIANT_TABS}
          activeTab={variant}
          onTabChange={setVariant}
          ariaLabel="Editor layout"
          size="sm"
        />
        <span className="typo-caption text-muted-foreground">Prototype — 3 editor layouts</span>
      </div>

      {variant === 'wizard' && <ScrapeEditorWizard {...variantProps} />}
      {variant === 'composer' && <ScrapeEditorComposer {...variantProps} />}
      {variant === 'blueprint' && <ScrapeEditorBlueprint {...variantProps} />}
    </BaseModal>
  );
}
