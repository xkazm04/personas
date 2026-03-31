/**
 * Template → Agent Icon Resolver
 *
 * Maps template IDs and categories to agent-icon values so that
 * adopted personas automatically get a themed icon.
 */
import { TEMPLATE_CATALOG } from '@/lib/personas/templates/templateCatalog';
import { iconIdForCategories, toAgentIconValue, getAgentIconEntry } from './agentIconCatalog';

interface ResolvedIcon {
  icon: string;   // e.g. "agent-icon:finance"
  color: string;  // suggested hex color
}

/**
 * Given a template name or ID, resolve the best agent-icon value and color.
 * Returns null if the template can't be found in the catalog.
 */
export function resolveTemplateAgentIcon(templateNameOrId: string): ResolvedIcon | null {
  // Find the template in the catalog by ID or name
  const template = TEMPLATE_CATALOG.find(
    (t) => t.id === templateNameOrId || t.name === templateNameOrId,
  );
  if (!template) return null;

  const iconId = iconIdForCategories(template.category);
  const entry = getAgentIconEntry(iconId);
  return {
    icon: toAgentIconValue(iconId),
    color: template.color || entry?.suggestedColor || '#8b5cf6',
  };
}

/**
 * Given free-form categories (e.g. from matrix generation), resolve icon + color.
 */
export function resolveIconForCategories(categories: string[]): ResolvedIcon {
  const iconId = iconIdForCategories(categories);
  const entry = getAgentIconEntry(iconId);
  return {
    icon: toAgentIconValue(iconId),
    color: entry?.suggestedColor || '#8b5cf6',
  };
}
