import { useState } from 'react';

import type { ScraperConfig, ScraperConfigInput } from '@/api/scraper';
import { BaseModal } from '@/lib/ui/BaseModal';

import { ScrapeEditorWizard } from './ScrapeEditorWizard';
import { useScrapeForm } from './useScrapeForm';

/**
 * Scrape editor (Phase 1b-2). The /prototype round settled on the "Wizard"
 * layout — a guided one-step-at-a-time assembly line — so the Composer and
 * Blueprint variants were retired. Built on the shared form spine (useScrapeForm)
 * with the "Build with Claude" LLM pipeline builder in the Extract step.
 */
interface ScrapeEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initial?: ScraperConfig | null;
  onSave: (input: ScraperConfigInput) => Promise<unknown>;
}

export function ScrapeEditorModal({ isOpen, onClose, initial, onSave }: ScrapeEditorModalProps) {
  const form = useScrapeForm(initial ?? null, isOpen);
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

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId="scrape-editor" size="xl" staggerChildren={false}>
      <ScrapeEditorWizard
        form={form}
        isEdit={Boolean(initial)}
        saving={saving}
        onCancel={onClose}
        onSave={handleSave}
      />
    </BaseModal>
  );
}
