import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { parseJsonOrDefault as parseJsonSafe } from '@/lib/utils/parseJson';

export interface TemplateMatch {
  review: PersonaDesignReview;
  score: number;
  matchedApps: string[];
}

const DESKTOP_PREFIX = 'desktop_';

interface SuggestedConnectorShape {
  name?: string;
  label?: string;
  category?: string;
}

interface DesignResultShape {
  service_flow?: unknown;
  suggested_connectors?: SuggestedConnectorShape[];
  persona?: { connectors?: Array<{ name?: string; label?: string }> };
}

function normalizedAppKeyword(connectorName: string): string {
  const stripped = connectorName.startsWith(DESKTOP_PREFIX)
    ? connectorName.slice(DESKTOP_PREFIX.length)
    : connectorName;
  return stripped.toLowerCase();
}

function collectTemplateConnectorTokens(review: PersonaDesignReview): string[] {
  const tokens: string[] = [];

  const used: string[] = parseJsonSafe(review.connectors_used, []);
  for (const u of used) if (typeof u === 'string') tokens.push(u);

  const dr: DesignResultShape = parseJsonSafe(review.design_result, {} as DesignResultShape);
  if (Array.isArray(dr.service_flow)) {
    for (const s of dr.service_flow) if (typeof s === 'string') tokens.push(s);
  }
  if (Array.isArray(dr.suggested_connectors)) {
    for (const sc of dr.suggested_connectors) {
      if (sc?.name) tokens.push(sc.name);
      if (sc?.label) tokens.push(sc.label);
      if (sc?.category) tokens.push(sc.category);
    }
  }
  if (Array.isArray(dr.persona?.connectors)) {
    for (const pc of dr.persona!.connectors!) {
      if (pc?.name) tokens.push(pc.name);
      if (pc?.label) tokens.push(pc.label);
    }
  }

  return tokens.map((t) => t.toLowerCase());
}

/**
 * Score how well a template matches the set of approved desktop apps.
 * Score = (apps matched / approved apps total). Token match is substring
 * either direction (e.g. "obsidian" matches "Obsidian Vault" or
 * "obsidian-memory").
 */
export function scoreTemplateMatch(
  review: PersonaDesignReview,
  approvedApps: Set<string>,
): TemplateMatch {
  if (approvedApps.size === 0) {
    return { review, score: 0, matchedApps: [] };
  }

  const tokens = collectTemplateConnectorTokens(review);
  const matched: string[] = [];

  for (const app of approvedApps) {
    const keyword = normalizedAppKeyword(app);
    if (!keyword) continue;
    const hit = tokens.some((tok) => tok.includes(keyword) || keyword.includes(tok));
    if (hit) matched.push(app);
  }

  return {
    review,
    score: matched.length / approvedApps.size,
    matchedApps: matched,
  };
}

/**
 * Rank templates by recommendation score. Templates with score > 0 float to
 * the top (highest score first); templates with no match keep their original
 * relative order below the matched set.
 */
export function rankTemplatesByApprovedApps(
  templates: PersonaDesignReview[],
  approvedApps: Set<string>,
): TemplateMatch[] {
  const scored = templates.map((t) => scoreTemplateMatch(t, approvedApps));
  if (approvedApps.size === 0) return scored;
  return [...scored].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return templates.indexOf(a.review) - templates.indexOf(b.review);
  });
}

/** Display label for a desktop connector name (e.g. "desktop_obsidian" → "Obsidian"). */
export function approvedAppDisplayLabel(connectorName: string): string {
  const stripped = connectorName.startsWith(DESKTOP_PREFIX)
    ? connectorName.slice(DESKTOP_PREFIX.length)
    : connectorName;
  if (!stripped) return connectorName;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}
