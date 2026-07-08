import { useEffect, useMemo, useState } from 'react';

import type { ScrapeRule, ScrapeRuleSet, ScraperConfig, ScraperConfigInput } from '@/api/scraper';

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
  // derived
  namedFieldCount: number;
  canSave: boolean;
  toInput: () => ScraperConfigInput;
}

export function useScrapeForm(initial: ScraperConfig | null, isOpen: boolean): ScrapeForm {
  const [name, setName] = useState('');
  const [urls, setUrls] = useState('');
  const [fields, setFields] = useState<RuleField[]>([]);
  const [dataset, setDataset] = useState('');
  const [keyField, setKeyField] = useState('');
  const [cron, setCron] = useState('');
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setName(initial?.name ?? '');
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
  const canSave = Boolean(name.trim() && dataset.trim() && urlList.length > 0 && namedFieldCount > 0);

  const toInput = (): ScraperConfigInput => ({
    id: initial?.id,
    name: name.trim(),
    urls: urlList,
    rules: fieldsToRuleSet(fields),
    dataset: dataset.trim(),
    key_field: keyField.trim() || null,
    cron: cron.trim() || null,
    enabled,
  });

  return {
    name, setName, urls, setUrls, urlList,
    fields, addField, updateField, removeField, setFieldsFromRuleSet,
    dataset, setDataset, keyField, setKeyField, cron, setCron, enabled, setEnabled,
    namedFieldCount, canSave, toInput,
  };
}
