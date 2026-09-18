import { useEffect, useMemo, useState } from 'react';

import type { PreviewRow, ScrapeRule, ScrapeRuleSet, ScraperConfig, ScraperConfigInput } from '@/api/scraper';

/**
 * Structured, editable form spine shared by all edit-modal variants (Phase 1b-2).
 * Rules are held as an ordered, flat `RuleField[]` (one row per extracted field)
 * so each pipeline step is directly controllable — far more legible than raw
 * JSON — and converted to/from the wire `ScrapeRuleSet` at the edges.
 */
export type RuleType = 'css' | 'regex' | 'json';

export interface RuleField {
  id: string;
  name: string;
  type: RuleType;
  selector: string; // css
  attr: string; // css (optional attribute)
  all: boolean; // css (collect all matches)
  pattern: string; // regex
  group: number; // regex
  pointer: string; // json
}

let _seq = 0;
const uid = () => `f${_seq++}`;

function blankField(): RuleField {
  return { id: uid(), name: '', type: 'css', selector: '', attr: '', all: false, pattern: '', group: 0, pointer: '' };
}

function ruleToField(name: string, rule: ScrapeRule): RuleField {
  const f = blankField();
  f.name = name;
  if (rule.type === 'css') {
    f.type = 'css';
    f.selector = rule.selector ?? '';
    f.attr = rule.attr ?? '';
    f.all = rule.all ?? false;
  } else if (rule.type === 'regex') {
    f.type = 'regex';
    f.pattern = rule.pattern ?? '';
    f.group = rule.group ?? 0;
  } else if (rule.type === 'json') {
    f.type = 'json';
    f.pointer = rule.pointer ?? '';
  }
  return f;
}

export function fieldsFromRuleSet(rules: ScrapeRuleSet | null | undefined): RuleField[] {
  if (!rules) return [];
  return Object.entries(rules).map(([name, rule]) => ruleToField(name, rule));
}

function fieldToRule(f: RuleField): ScrapeRule {
  if (f.type === 'regex') return { type: 'regex', pattern: f.pattern, group: f.group || 0 };
  if (f.type === 'json') return { type: 'json', pointer: f.pointer };
  return { type: 'css', selector: f.selector, attr: f.attr.trim() ? f.attr.trim() : null, all: f.all };
}

export function fieldsToRuleSet(fields: RuleField[]): ScrapeRuleSet {
  const out: ScrapeRuleSet = {};
  for (const f of fields) {
    if (f.name.trim()) out[f.name.trim()] = fieldToRule(f);
  }
  return out;
}

/**
 * A stable signature of everything a preview actually exercised: the URL list
 * and the compiled rule set. Editing a selector, renaming a field, adding a URL
 * — anything that would change what the scrape harvests — changes this string,
 * which is how a stale preview is detected rather than trusted.
 */
export function previewSignature(urlList: string[], fields: RuleField[]): string {
  return JSON.stringify([urlList, fieldsToRuleSet(fields)]);
}

/** What the last successful dry-run proved, and for which rules. */
export interface PreviewStamp {
  signature: string;
  /** Rows the preview returned that carried at least one extracted value. */
  rows: number;
  at: number;
}

/**
 * How many preview rows actually PRODUCED something: no fetch error, and at
 * least one named field with a non-empty value.
 *
 * A 200 response with every selector matching nothing is the scraper's default
 * failure mode, and it is indistinguishable from a good run unless somebody
 * counts. This is that count.
 */
export function countProductiveRows(rows: PreviewRow[], fieldNames: string[]): number {
  return rows.filter((row) => {
    if (row.error || !row.record) return false;
    const rec = row.record as Record<string, unknown>;
    return fieldNames.some((name) => {
      const v = rec[name];
      if (v === null || v === undefined || v === '') return false;
      return Array.isArray(v) ? v.length > 0 : true;
    });
  }).length;
}

/** A short "css h1" / "regex /…/" summary for a field row. */
export function ruleSummary(f: RuleField): string {
  if (f.type === 'css') return `css ${f.selector || '—'}${f.attr ? ` @${f.attr}` : ''}${f.all ? ' [all]' : ''}`;
  if (f.type === 'regex') return `regex /${f.pattern || '—'}/`;
  return `json ${f.pointer || '—'}`;
}

/** Props every edit-modal variant receives from the switcher. */
export interface EditorVariantProps {
  form: ScrapeForm;
  isEdit: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}

export interface ScrapeForm {
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  urls: string;
  setUrls: (v: string) => void;
  urlList: string[];
  fields: RuleField[];
  addField: () => void;
  updateField: (id: string, patch: Partial<RuleField>) => void;
  removeField: (id: string) => void;
  setFieldsFromRuleSet: (rules: ScrapeRuleSet, mode: 'replace' | 'merge') => void;
  dataset: string;
  setDataset: (v: string) => void;
  keyField: string;
  setKeyField: (v: string) => void;
  cron: string;
  setCron: (v: string) => void;
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  /** The last dry-run that produced a record, and for which rules. */
  previewStamp: PreviewStamp | null;
  /** Called by the Preview step with the rows the dry-run returned. */
  recordPreview: (rows: PreviewRow[]) => void;
  // derived
  namedFieldCount: number;
  /** True when a preview produced a record for EXACTLY the current urls+rules. */
  previewProven: boolean;
  /** True when a preview ran but the rules/urls have changed since. */
  previewStale: boolean;
  canSave: boolean;
  /** Why saving is blocked, for the caller to explain (null = not blocked). */
  saveBlockedReason: 'fields' | 'preview' | null;
  toInput: () => ScraperConfigInput;
}

export function useScrapeForm(initial: ScraperConfig | null, isOpen: boolean): ScrapeForm {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [urls, setUrls] = useState('');
  const [fields, setFields] = useState<RuleField[]>([]);
  const [dataset, setDataset] = useState('');
  const [keyField, setKeyField] = useState('');
  const [cron, setCron] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [previewStamp, setPreviewStamp] = useState<PreviewStamp | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    // A previous scrape's proof must never carry over into the next edit.
    setPreviewStamp(null);
    setName(initial?.name ?? '');
    setDescription(initial?.description ?? '');
    setUrls((initial?.urls ?? []).join('\n'));
    setFields(fieldsFromRuleSet(initial?.rules) || []);
    setDataset(initial?.dataset ?? '');
    setKeyField(initial?.keyField ?? '');
    setCron(initial?.cron ?? '');
    setEnabled(initial?.enabled ?? true);
  }, [isOpen, initial]);

  const urlList = useMemo(
    () => urls.split('\n').map((u) => u.trim()).filter(Boolean),
    [urls],
  );

  const addField = () => setFields((fs) => [...fs, blankField()]);
  const updateField = (id: string, patch: Partial<RuleField>) =>
    setFields((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const removeField = (id: string) => setFields((fs) => fs.filter((f) => f.id !== id));
  const setFieldsFromRuleSet = (rules: ScrapeRuleSet, mode: 'replace' | 'merge') => {
    const incoming = fieldsFromRuleSet(rules);
    setFields((fs) => {
      if (mode === 'replace') return incoming;
      const names = new Set(fs.map((f) => f.name.trim()));
      return [...fs, ...incoming.filter((f) => !names.has(f.name.trim()))];
    });
  };

  const namedFieldCount = fields.filter((f) => f.name.trim()).length;

  const recordPreview = (rows: PreviewRow[]) => {
    const fieldNames = fields.map((f) => f.name.trim()).filter(Boolean);
    const productive = countProductiveRows(rows, fieldNames);
    // A dry-run that extracted nothing is not proof; it is the failure this
    // gate exists to catch, so it does not stamp the form.
    if (productive === 0) return;
    setPreviewStamp({ signature: previewSignature(urlList, fields), rows: productive, at: Date.now() });
  };

  const signature = previewSignature(urlList, fields);
  const previewProven = previewStamp !== null && previewStamp.signature === signature;
  const previewStale = previewStamp !== null && previewStamp.signature !== signature;

  /**
   * An ARMED scrape (`enabled`, i.e. its cron may fire unattended) may not be
   * saved until a dry-run has produced a record for exactly these rules. The
   * Control Room's row Test already dry-runs; the editor was the weaker door,
   * and an unpreviewed armed scrape is a broken selector harvesting nothing on
   * a schedule with a green pill next to it.
   *
   * Saving it DISARMED is always allowed: parking a half-built scrape is not
   * the same as arming one nobody ran.
   */
  const fieldsComplete = Boolean(name.trim() && dataset.trim() && urlList.length > 0 && namedFieldCount > 0);
  const canSave = fieldsComplete && (!enabled || previewProven);
  const saveBlockedReason: 'fields' | 'preview' | null = !fieldsComplete
    ? 'fields'
    : canSave
      ? null
      : 'preview';

  const toInput = (): ScraperConfigInput => ({
    id: initial?.id,
    name: name.trim(),
    description: description.trim() || null,
    urls: urlList,
    rules: fieldsToRuleSet(fields),
    dataset: dataset.trim(),
    key_field: keyField.trim() || null,
    cron: cron.trim() || null,
    enabled,
  });

  return {
    name, setName, description, setDescription, urls, setUrls, urlList,
    fields, addField, updateField, removeField, setFieldsFromRuleSet,
    dataset, setDataset, keyField, setKeyField, cron, setCron, enabled, setEnabled,
    previewStamp, recordPreview,
    namedFieldCount, previewProven, previewStale, canSave, saveBlockedReason, toInput,
  };
}
