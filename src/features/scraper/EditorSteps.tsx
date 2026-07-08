import { Clock, Database, FileSearch, Globe } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

import { FieldRuleRows } from './FieldRuleRows';
import { LlmRuleBuilder } from './LlmRuleBuilder';
import { cadenceLabel } from './useScraperData';
import type { ScrapeForm } from './useScrapeForm';

/**
 * The four pipeline steps as standalone content blocks (Phase 1b-2). Each
 * edit-modal variant (Wizard / Composer / Blueprint) arranges these differently
 * but shares the exact controls — so "control over each pipeline step" is
 * consistent everywhere and the LLM builder lives in one place.
 */
export interface StepMeta {
  id: 'source' | 'extract' | 'output' | 'schedule';
  label: string;
  icon: LucideIcon;
  hint: string;
}

export const STEPS: StepMeta[] = [
  { id: 'source', label: 'Source', icon: Globe, hint: 'Which pages to fetch' },
  { id: 'extract', label: 'Extract', icon: FileSearch, hint: 'Fields to pull from each page' },
  { id: 'output', label: 'Output', icon: Database, hint: 'Where records land' },
  { id: 'schedule', label: 'Schedule', icon: Clock, hint: 'When it runs' },
];

/** Is a step "complete" enough to be considered configured? */
export function stepComplete(form: ScrapeForm, id: StepMeta['id']): boolean {
  switch (id) {
    case 'source':
      return Boolean(form.name.trim()) && form.urlList.length > 0;
    case 'extract':
      return form.namedFieldCount > 0;
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
  return (
    <div className="flex flex-col gap-4">
      <Labeled label="Name">
        <input
          className={INPUT_FIELD}
          value={form.name}
          onChange={(e) => form.setName(e.target.value)}
          placeholder="Product price watch"
        />
      </Labeled>
      <Labeled label="URLs — one per line">
        <textarea
          className={`${INPUT_FIELD} min-h-[88px] resize-y font-mono`}
          value={form.urls}
          onChange={(e) => form.setUrls(e.target.value)}
          placeholder="https://example.com/product/123"
        />
      </Labeled>
      {form.urlList.length > 0 && (
        <p className="typo-caption text-muted-foreground">
          {form.urlList.length} URL{form.urlList.length === 1 ? '' : 's'} · fetched over HTTP (no browser).
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

export function OutputStep({ form }: { form: ScrapeForm }) {
  const fieldNames = form.fields.map((f) => f.name.trim()).filter(Boolean);
  return (
    <div className="flex flex-col gap-4">
      <Labeled label="Dataset — where change-detected records are stored">
        <input
          className={INPUT_FIELD}
          value={form.dataset}
          onChange={(e) => form.setDataset(e.target.value)}
          placeholder="products"
        />
      </Labeled>
      <Labeled label="Key field (optional) — dedupe records by this field instead of the URL">
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
  return (
    <div className="flex flex-col gap-4">
      <Labeled label="Schedule — 5-field cron, UTC (leave blank for manual only)">
        <input
          className={`${INPUT_FIELD} font-mono`}
          value={form.cron}
          onChange={(e) => form.setCron(e.target.value)}
          placeholder="0 6 * * *"
        />
      </Labeled>
      <p className="typo-caption text-muted-foreground">
        Runs <span className="text-foreground">{cadenceLabel(form.cron.trim() || null).toLowerCase()}</span>.
      </p>
      <AccessibleToggle
        checked={form.enabled}
        onChange={() => form.setEnabled(!form.enabled)}
        label="Enabled — scheduled runs fire automatically"
      />
    </div>
  );
}
