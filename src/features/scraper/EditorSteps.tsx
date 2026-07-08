import { useState } from 'react';
import { AlertTriangle, Clock, Database, FileSearch, FlaskConical, Globe, Play } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { previewScraperExtract, type PreviewRow } from '@/api/scraper';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

import { FieldRuleRows } from './FieldRuleRows';
import { LlmRuleBuilder } from './LlmRuleBuilder';
import { cadenceLabel } from './useScraperData';
import { fieldsToRuleSet, type ScrapeForm } from './useScrapeForm';

/**
 * The four pipeline steps as standalone content blocks (Phase 1b-2). Each
 * edit-modal variant (Wizard / Composer / Blueprint) arranges these differently
 * but shares the exact controls — so "control over each pipeline step" is
 * consistent everywhere and the LLM builder lives in one place.
 */
export interface StepMeta {
  id: 'source' | 'extract' | 'preview' | 'output' | 'schedule';
  label: string;
  icon: LucideIcon;
  hint: string;
}

export const STEPS: StepMeta[] = [
  { id: 'source', label: 'Source', icon: Globe, hint: 'Which pages to fetch' },
  { id: 'extract', label: 'Extract', icon: FileSearch, hint: 'Fields to pull from each page' },
  { id: 'preview', label: 'Preview', icon: FlaskConical, hint: 'Test the rules on the live page' },
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
    case 'preview':
      return true; // optional dry-run
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
      <Labeled label="Title — short + recognizable">
        <input
          className={INPUT_FIELD}
          value={form.name}
          onChange={(e) => form.setName(e.target.value)}
          placeholder="Competitor price watch"
        />
      </Labeled>
      <Labeled label="Description — a one-line overview of the use case (optional)">
        <input
          className={INPUT_FIELD}
          value={form.description}
          onChange={(e) => form.setDescription(e.target.value)}
          placeholder="Track daily price + stock on our 3 rivals’ product pages."
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

export function PreviewStep({ form }: { form: ScrapeForm }) {
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fieldNames = form.fields.map((f) => f.name.trim()).filter(Boolean);
  const disabled = form.urlList.length === 0 || form.namedFieldCount === 0;

  const run = async () => {
    setError(null);
    setRows(null);
    try {
      setRows(await previewScraperExtract(form.urlList, fieldsToRuleSet(form.fields), 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between rounded-interactive border border-primary/10 bg-secondary/20 px-3 py-2.5">
        <span className="typo-caption text-muted-foreground">
          {disabled
            ? 'Add a URL and at least one field first.'
            : `Fetches ${form.urlList[0]} and runs your rules — nothing is saved.`}
        </span>
        <AsyncButton variant="primary" size="sm" disabled={disabled} loadingText="Fetching…" onClick={run}>
          <Play className="size-3.5" /> Run preview
        </AsyncButton>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-interactive border border-status-error/25 bg-status-error/5 p-3 typo-caption text-status-error">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {rows?.map((row) => (
        <div key={row.url} className="rounded-interactive border border-primary/10 bg-background/40 p-3">
          <div className="mb-2 flex items-center gap-1.5 typo-caption text-muted-foreground">
            <Globe className="size-3.5" />
            <span className="truncate">{row.url}</span>
            {row.error ? (
              <span className="text-status-error">· {row.error}</span>
            ) : (
              <span>· {(row.bytes / 1024).toFixed(0)} KB fetched</span>
            )}
          </div>
          {!row.error && row.record && (
            <table className="w-full">
              <tbody className="divide-y divide-primary/8">
                {fieldNames.map((name) => {
                  const val = (row.record as Record<string, unknown>)[name];
                  const isEmpty = val === null || val === undefined || val === '' || (Array.isArray(val) && val.length === 0);
                  return (
                    <tr key={name}>
                      <td className="py-1.5 pr-3 align-top font-mono typo-caption text-muted-foreground">{name}</td>
                      <td className="py-1.5 align-top">
                        {isEmpty ? (
                          <span className="inline-flex items-center gap-1 typo-caption text-status-warning">
                            <AlertTriangle className="size-3" /> no match
                          </span>
                        ) : (
                          <span className="break-words typo-caption text-foreground">{formatValue(val)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}

function formatValue(v: unknown): string {
  if (Array.isArray(v)) {
    const shown = v.slice(0, 5).map((x) => String(x)).join(', ');
    return v.length > 5 ? `[${shown}, +${v.length - 5} more]` : `[${shown}]`;
  }
  return String(v);
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
