// Editing a whitelisted site: the draft the modal holds and the writes a save
// turns into. Before spark server-control these were three controls that each
// wrote on change (the Detail layout's Sign in and Policy tabs); folding them
// into the modal made them a draft with one Save, so the writes are planned
// here, as a pure diff against the stored row, and only what changed is sent.
//
// TIGHTEN-ONLY, BY CONSTRUCTION. An override is either set to `gated` or
// cleared. Rust refuses every other class with `refused_loosening`, so no plan
// this module produces can ask for one; clearing returns the tool to the class
// the page's own manifest implied, which is a reset, not a loosening.

import * as browserApi from '@/api/browser';

import type { BrowserSite } from '../types';

export interface SiteEditDraft {
  label: string;
  /** Raw text of the budget field. */
  budget: string;
  credentialId: string | null;
  /** tool name -> forced to ask first. Only tools the scan found are listed. */
  gated: Readonly<Record<string, boolean>>;
}

export type SiteWrite =
  | { kind: 'upsert'; label: string | null; budget: number | null }
  | { kind: 'credential'; credentialId: string | null }
  | { kind: 'override'; tool: string; gated: boolean };

export function draftFromSite(site: BrowserSite): SiteEditDraft {
  const gated: Record<string, boolean> = {};
  for (const tool of site.scan_report?.page_tools ?? []) gated[tool.name] = site.overrides[tool.name] === 'gated';
  return { label: site.label, budget: String(site.budget), credentialId: site.credential_id, gated };
}

/** A whole number, 0 or more, written as digits only. */
export function parseBudget(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{1,9}$/.test(text)) return null;
  return Number(text);
}

/** Every write that turns `site` into `draft`, in a stable order. Empty when nothing changed. */
export function planSiteWrites(site: BrowserSite, draft: SiteEditDraft): SiteWrite[] {
  const writes: SiteWrite[] = [];
  const label = draft.label.trim();
  const budget = parseBudget(draft.budget);
  // A blank name is "keep what the row has", the same as the add form's
  // `label || null`: Rust shows the origin when a row has no name of its own.
  const labelChanged = label !== '' && label !== site.label;
  const budgetChanged = budget !== null && budget !== site.budget;
  if (labelChanged || budgetChanged) {
    writes.push({ kind: 'upsert', label: labelChanged ? label : null, budget: budgetChanged ? budget : null });
  }
  if (draft.credentialId !== site.credential_id) {
    writes.push({ kind: 'credential', credentialId: draft.credentialId });
  }
  for (const tool of Object.keys(draft.gated).sort()) {
    const now = site.overrides[tool] === 'gated';
    const want = draft.gated[tool] === true;
    if (now !== want) writes.push({ kind: 'override', tool, gated: want });
  }
  return writes;
}

/** Send the planned writes in order. Answers with the last stored row, or null when nothing was sent. */
export async function applySiteWrites(origin: string, writes: readonly SiteWrite[]): Promise<BrowserSite | null> {
  let row: BrowserSite | null = null;
  for (const write of writes) {
    if (write.kind === 'upsert') {
      row = await browserApi.upsertSite({ origin, label: write.label, enabled: null, budget: write.budget, created_by: null });
    } else if (write.kind === 'credential') {
      row = await browserApi.bindSiteCredential(origin, write.credentialId);
    } else {
      row = await browserApi.setSiteOverride(origin, write.tool, write.gated ? 'gated' : null);
    }
  }
  return row;
}
