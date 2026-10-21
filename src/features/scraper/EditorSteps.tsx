import { useState } from 'react';
import { AlertTriangle, Clock, Database, FileSearch, FlaskConical, Globe, Play } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { previewScraperExtract, type PreviewRow } from '@/api/scraper';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { inlineErrorCopy } from '@/features/triggers/lib/inlineErrorCopy';

import { useTranslation } from '@/i18n/useTranslation';

import { FieldRuleRows } from './FieldRuleRows';
import { LlmRuleBuilder } from './LlmRuleBuilder';
import { PreviewResults } from './PreviewResults';
import { cadenceLabel } from './useScraperData';
import { countProductiveRows, fieldsToRuleSet, type ScrapeForm } from './useScrapeForm';

/**
 * The four pipeline steps as standalone content blocks (Phase 1b-2). Each
 * edit-modal variant (Wizard / Composer / Blueprint) arranges these differently
 * but shares the exact controls — so "control over each pipeline step" is
 * consistent everywhere and the LLM builder lives in one place.
 */
export interface StepMeta {
  id: 'source' | 'extract' | 'preview' | 'output' | 'schedule';
  icon: LucideIcon;
}

export const STEPS: StepMeta[] = [
  // Label and hint copy: t.plugins.scraper.step_labels[id] / step_hints[id].
  { id: 'source', icon: Globe },
  { id: 'extract', icon: FileSearch },
  { id: 'preview', icon: FlaskConical },
  { id: 'output', icon: Database },
  { id: 'schedule', icon: Clock },
];

/** Is a step "complete" enough to be considered configured? */
export function stepComplete(form: ScrapeForm, id: StepMeta['id']): boolean {
  switch (id) {
    case 'source':
      return Boolean(form.name.trim()) && form.urlList.length > 0;
    case 'extract':
      return form.namedFieldCount > 0;
    case 'preview':
      // Proven for THESE rules. It stops being complete the moment a selector
      // changes, which is the whole reason the stamp carries a signature.
      return form.previewProven;
    case 'output':
      return Boolean(form.dataset.trim());
    case 'schedule':
      return true; // optional
  }
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="typo-label text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function SourceStep({ form }: { form: ScrapeForm }) {
  const { t, tx } = useTranslation();
  const sc = t.plugins.scraper;
  return (
    <div className="flex flex-col gap-4">
      <Labeled label={sc.field_title}>
        <input
          className={INPUT_FIELD}
          value={form.name}
          onChange={(e) => form.setName(e.target.value)}
          placeholder={sc.field_title_placeholder}
        />
      </Labeled>
      <Labeled label={sc.field_description}>
        <input
          className={INPUT_FIELD}
          value={form.description}
          onChange={(e) => form.setDescription(e.target.value)}
          placeholder={sc.field_description_placeholder}
        />
      </Labeled>
      <Labeled label={sc.field_urls}>
        <textarea
          className={`${INPUT_FIELD} min-h-[88px] resize-y font-mono`}
          value={form.urls}
          onChange={(e) => form.setUrls(e.target.value)}
          placeholder={sc.field_urls_placeholder}
        />
      </Labeled>
      {form.urlList.length > 0 && (
        <p className="typo-caption text-muted-foreground">
          {tx(form.urlList.length === 1 ? sc.urls_summary_one : sc.urls_summary_other, { count: form.urlList.length })}
        </p>
      )}
    </div>
  );
}

export function ExtractStep({ form }: { form: ScrapeForm }) {
  return (
    <div className="flex flex-col gap-3">
      <LlmRuleBuilder
        urls={form.urlList}
        hasFields={form.namedFieldCount > 0}
        onRules={form.setFieldsFromRuleSet}
      />
      <FieldRuleRows
        fields={form.fields}
        updateField={form.updateField}
        removeField={form.removeField}
        addField={form.addField}
      />
    </div>
  );
}

export function PreviewStep({ form }: { form: ScrapeForm }) {
  const { t, tx } = useTranslation();
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  // The rejection, raw; resolved to copy at render (inlineErrorCopy).
  const [error, setError] = useState<unknown>(null);
  const fieldNames = form.fields.map((f) => f.name.trim()).filter(Boolean);
  const disabled = form.urlList.length === 0 || form.namedFieldCount === 0;

  const run = async () => {
    setError(null);
    setRows(null);
    try {
      const result = await previewScraperExtract(form.urlList, fieldsToRuleSet(form.fields), 1);
      setRows(result);
      // Stamps the form ONLY when a row actually produced a record — that stamp
      // is what lets the scrape be saved armed.
      form.recordPreview(result);
    } catch (e) {
      setError(e ?? new Error('preview failed'));
    }
  };

  const productive = rows ? countProductiveRows(rows, fieldNames) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between rounded-interactive border border-primary/10 bg-secondary/20 px-3 py-2.5">
        <span className="typo-caption text-muted-foreground">
          {disabled
            ? t.plugins.scraper.preview_needs_input
            : tx(t.plugins.scraper.preview_hint, { url: form.urlList[0] ?? '' })}
        </span>
        <AsyncButton variant="primary" size="sm" disabled={disabled} loadingText={t.plugins.scraper.preview_fetching} onClick={run}>
          <Play className="size-3.5" /> {t.plugins.scraper.preview_run}
        </AsyncButton>
      </div>

      {form.previewStale && (
        <div
          data-testid="scrape-preview-stale"
          className="flex items-start gap-2 rounded-interactive border border-status-warning/25 bg-status-warning/5 p-3 typo-caption text-status-warning"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{t.plugins.scraper.preview_stale}</span>
        </div>
      )}

      {productive === 0 && error === null && (
        <div
          data-testid="scrape-preview-empty"
          className="flex items-start gap-2 rounded-interactive border border-status-warning/25 bg-status-warning/5 p-3 typo-caption text-status-warning"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{t.plugins.scraper.preview_no_records}</span>
        </div>
      )}

      {error !== null && (
        <div className="flex items-start gap-2 rounded-interactive border border-status-error/25 bg-status-error/5 p-3 typo-caption text-status-error">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{inlineErrorCopy(t, error)}</span>
        </div>
      )}

      {rows && <PreviewResults rows={rows} fieldNames={fieldNames} />}
    </div>
  );
}

export function OutputStep({ form }: { form: ScrapeForm }) {
  const { t } = useTranslation();
  const fieldNames = form.fields.map((f) => f.name.trim()).filter(Boolean);
  return (
    <div className="flex flex-col gap-4">
      <Labeled label={t.plugins.scraper.field_dataset}>
        <input
          className={INPUT_FIELD}
          value={form.dataset}
          onChange={(e) => form.setDataset(e.target.value)}
          placeholder="products"
        />
      </Labeled>
      <Labeled label={t.plugins.scraper.field_key}>
        <input
          className={`${INPUT_FIELD} font-mono`}
          value={form.keyField}
          onChange={(e) => form.setKeyField(e.target.value)}
          placeholder={fieldNames[0] ?? 'title'}
          list="scrape-field-names"
        />
      </Labeled>
      <datalist id="scrape-field-names">
        {fieldNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </div>
  );
}

export function ScheduleStep({ form }: { form: ScrapeForm }) {
  const { t, tx } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <Labeled label={t.plugins.scraper.field_schedule}>
        <input
          className={`${INPUT_FIELD} font-mono`}
          value={form.cron}
          onChange={(e) => form.setCron(e.target.value)}
          placeholder="0 6 * * *"
        />
      </Labeled>
      <p className="typo-caption text-muted-foreground">
        {tx(t.plugins.scraper.schedule_runs, { cadence: cadenceLabel(form.cron.trim() || null).toLowerCase() })}
      </p>
      <AccessibleToggle
        checked={form.enabled}
        onChange={() => form.setEnabled(!form.enabled)}
        label={t.plugins.scraper.field_enabled}
      />
      {/* Arming is the step that needs proof; parking a draft never does. */}
      {form.enabled && !form.previewProven && (
        <p data-testid="scrape-arm-needs-preview" className="typo-caption text-status-warning">
          {t.plugins.scraper.arm_needs_preview}
        </p>
      )}
    </div>
  );
}
