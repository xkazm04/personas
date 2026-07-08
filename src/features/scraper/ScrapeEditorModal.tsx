import { useEffect, useMemo, useState } from 'react';

import type { ScraperConfig, ScraperConfigInput } from '@/api/scraper';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { BaseModal } from '@/lib/ui/BaseModal';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

/**
 * Shared create/edit form for a saved scrape. All prototype variants open THIS
 * modal so the editing experience is identical while the browsing metaphor
 * differs (Phase 1b-2). Rules are edited as JSON (field → rule) — a structured
 * rule-builder is a later refinement; the prototype focus is the browse view.
 */
interface ScrapeEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initial?: ScraperConfig | null;
  onSave: (input: ScraperConfigInput) => Promise<unknown>;
}

const EXAMPLE_RULES = `{
  "title": { "type": "css", "selector": "h1" },
  "price": { "type": "css", "selector": ".price" }
}`;

export function ScrapeEditorModal({ isOpen, onClose, initial, onSave }: ScrapeEditorModalProps) {
  const [name, setName] = useState('');
  const [urls, setUrls] = useState('');
  const [rulesText, setRulesText] = useState(EXAMPLE_RULES);
  const [dataset, setDataset] = useState('');
  const [keyField, setKeyField] = useState('');
  const [cron, setCron] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(initial?.name ?? '');
    setUrls((initial?.urls ?? []).join('\n'));
    setRulesText(initial?.rules ? JSON.stringify(initial.rules, null, 2) : EXAMPLE_RULES);
    setDataset(initial?.dataset ?? '');
    setKeyField(initial?.keyField ?? '');
    setCron(initial?.cron ?? '');
    setEnabled(initial?.enabled ?? true);
  }, [isOpen, initial]);

  const rulesError = useMemo(() => {
    try {
      const parsed = JSON.parse(rulesText);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return 'Rules must be a JSON object (field → rule).';
      }
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Invalid JSON';
    }
  }, [rulesText]);

  const urlList = urls.split('\n').map((u) => u.trim()).filter(Boolean);
  const canSave = name.trim() && dataset.trim() && urlList.length > 0 && !rulesError;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const input: ScraperConfigInput = {
        id: initial?.id,
        name: name.trim(),
        urls: urlList,
        rules: JSON.parse(rulesText),
        dataset: dataset.trim(),
        key_field: keyField.trim() || null,
        cron: cron.trim() || null,
        enabled,
      };
      await onSave(input);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId="scrape-editor" size="lg" staggerChildren={false}>
      <div className="flex flex-col gap-5 p-6">
        <div>
          <h2 id="scrape-editor" className="typo-section-title text-foreground">
            {initial ? 'Edit scrape' : 'New scrape'}
          </h2>
          <p className="typo-caption text-muted-foreground mt-1">
            Fetch the URLs, apply the rules, and store change-detected records in the dataset.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="typo-label text-muted-foreground">Name</span>
            <input className={INPUT_FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="Product price watch" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="typo-label text-muted-foreground">Dataset</span>
            <input className={INPUT_FIELD} value={dataset} onChange={(e) => setDataset(e.target.value)} placeholder="products" />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="typo-label text-muted-foreground">URLs — one per line</span>
          <textarea
            className={`${INPUT_FIELD} font-mono min-h-[72px] resize-y`}
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            placeholder="https://example.com/page"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="typo-label text-muted-foreground">
            Rules — JSON, field → {'{ type: css | regex | json, … }'}
          </span>
          <textarea
            className={`${INPUT_FIELD} font-mono min-h-[140px] resize-y`}
            value={rulesText}
            onChange={(e) => setRulesText(e.target.value)}
            spellCheck={false}
          />
          {rulesError && <span className="typo-caption text-status-error">{rulesError}</span>}
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="typo-label text-muted-foreground">Key field (optional)</span>
            <input className={INPUT_FIELD} value={keyField} onChange={(e) => setKeyField(e.target.value)} placeholder="title" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="typo-label text-muted-foreground">Schedule — 5-field cron, UTC (optional)</span>
            <input className={`${INPUT_FIELD} font-mono`} value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 6 * * *" />
          </label>
        </div>

        <div className="flex items-center justify-between border-t border-primary/10 pt-4">
          <AccessibleToggle checked={enabled} onChange={() => setEnabled((v) => !v)} label="Enabled (scheduled runs fire)" />
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <AsyncButton variant="primary" isLoading={saving} disabled={!canSave} onClick={handleSave}>
              {initial ? 'Save changes' : 'Create scrape'}
            </AsyncButton>
          </div>
        </div>
      </div>
    </BaseModal>
  );
}
