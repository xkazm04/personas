/**
 * Row transformations: group rows into category panels, sort within a panel.
 *
 * Grouping is purely presentational — the backend has no notion of these
 * panels. Catalog events route by their EVENT_SOURCE_CATEGORIES membership;
 * persona-emitted rows go into synthetic "USR" and external rows into
 * synthetic "EXT". The colour palette mirrors the categories' own `color`
 * token so the panel trim stays consistent with the canvas palette.
 */
import { Radio, Activity } from 'lucide-react';
import { EVENT_SOURCE_CATEGORIES } from '../../libs/eventCanvasConstants';
import type { EventRow } from '../routingHelpers';
import type { ActivityEntry, GroupDef, SortMode } from './types';

const PALETTE_FALLBACK = { text: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/25' };
const PALETTE: Record<string, typeof PALETTE_FALLBACK> = {
  'text-amber-400':   { text: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/25' },
  'text-emerald-400': { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/25' },
  'text-violet-400':  PALETTE_FALLBACK,
  'text-sky-400':     { text: 'text-sky-400',     bg: 'bg-sky-500/10',     border: 'border-sky-500/25' },
};

export function groupRows(rows: EventRow[]): GroupDef[] {
  const byCatalogId = new Map<string, EventRow[]>();
  const usr: EventRow[] = [];
  const ext: EventRow[] = [];
  const eventTypeToCategory = new Map<string, string>();
  for (const cat of EVENT_SOURCE_CATEGORIES) {
    for (const tmpl of cat.templates) eventTypeToCategory.set(tmpl.eventType, cat.id);
  }

  for (const r of rows) {
    if (r.sourceClass === 'external') { ext.push(r); continue; }
    if (r.sourceClass === 'persona') { usr.push(r); continue; }
    const catId = eventTypeToCategory.get(r.eventType) ?? 'system';
    const arr = byCatalogId.get(catId) ?? [];
    arr.push(r);
    byCatalogId.set(catId, arr);
  }

  const out: GroupDef[] = EVENT_SOURCE_CATEGORIES.map(cat => {
    const p = PALETTE[cat.color] ?? PALETTE_FALLBACK;
    return {
      id: cat.id,
      label: cat.label,
      icon: cat.icon,
      accentText: p.text,
      accentBg: p.bg,
      accentBorder: p.border,
      rows: byCatalogId.get(cat.id) ?? [],
    };
  }).filter(g => g.rows.length > 0);

  if (usr.length > 0) out.push({
    id: 'usr', label: 'Persona-Emitted', icon: Radio,
    accentText: 'text-violet-400', accentBg: 'bg-violet-500/10', accentBorder: 'border-violet-500/25',
    rows: usr,
  });
  if (ext.length > 0) out.push({
    id: 'ext', label: 'External', icon: Activity,
    accentText: 'text-amber-400', accentBg: 'bg-amber-500/10', accentBorder: 'border-amber-500/25',
    rows: ext,
  });
  return out;
}

export function sortRows(rows: EventRow[], mode: SortMode, activity: Map<string, ActivityEntry>): EventRow[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    if (mode === 'activity') {
      const al = activity.get(a.eventType)?.lastTs ?? 0;
      const bl = activity.get(b.eventType)?.lastTs ?? 0;
      if (al !== bl) return bl - al;
    } else if (mode === 'listeners') {
      if (a.connections.length !== b.connections.length) return b.connections.length - a.connections.length;
    } else if (mode === 'sources') {
      const as = a.sourcePersonas.length + a.externalSourceLabels.length;
      const bs = b.sourcePersonas.length + b.externalSourceLabels.length;
      if (as !== bs) return bs - as;
    }
    return (a.template?.label ?? a.eventType).localeCompare(b.template?.label ?? b.eventType);
  });
  return copy;
}
