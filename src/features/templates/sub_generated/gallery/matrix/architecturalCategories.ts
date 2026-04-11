import {
  MessageSquare,
  Database,
  Users,
  Kanban,
  Code2,
  Activity,
  BarChart3,
  Mail,
  CreditCard,
  LifeBuoy,
  Share2,
  ShoppingBag,
  Calendar,
  FileText,
  Cloud,
  Layout,
  Bot,
  Globe,
  HardDrive,
  ClipboardList,
  Bell,
  type LucideIcon,
} from 'lucide-react';

// -- Single source of truth: connector-categories.json ---------------
// The JSON config in scripts/templates/ is the canonical mapping.
// We import and hydrate it with Lucide icons (which can't live in JSON).
import connectorCatalog from '@/lib/config/connector-categories.json';

// -- Architectural categories -------------------------------------

export interface ArchCategory {
  key: string;
  label: string;
  icon: LucideIcon;
  color: string;
}

const ICON_MAP: Record<string, LucideIcon> = {
  MessageSquare, Database, Users, Kanban, Code2, Activity, BarChart3,
  Mail, CreditCard, LifeBuoy, Share2, ShoppingBag, Calendar,
  FileText, Cloud, Layout, Bot, Globe, HardDrive, ClipboardList, Bell,
};

interface CatalogCategoryDef {
  label: string;
  color: string;
  icon: string;
  builtIn?: boolean;
}

const catalogCategories = connectorCatalog.categories as Record<string, CatalogCategoryDef>;

/** Build ARCH_CATEGORIES from the JSON config, adding Lucide icon references. */
export const ARCH_CATEGORIES: Record<string, ArchCategory> = Object.fromEntries(
  Object.entries(catalogCategories).map(([key, meta]) => [
    key,
    {
      key,
      label: meta.label,
      icon: ICON_MAP[meta.icon] ?? Globe,
      color: meta.color,
    },
  ]),
);

/** Connector → category key mapping (from JSON config). */
const CONNECTOR_TO_CATEGORY: Record<string, string> = connectorCatalog.connectors as Record<string, string>;

/**
 * Heuristic fallback: infer a category from the connector name when
 * it is not explicitly mapped.  Never returns 'Other'.
 */
function inferCategory(name: string): ArchCategory {
  const n = name.toLowerCase();
  if (n.includes('db') || n.includes('sql') || n.includes('database') || n.includes('mongo') || n.includes('redis') || n.includes('dynamo'))
    return ARCH_CATEGORIES['database']!;
  if (n.includes('mail') || n.includes('smtp') || n.includes('inbox'))
    return ARCH_CATEGORIES['email']!;
  if (n.includes('slack') || n.includes('chat') || n.includes('message') || n.includes('discord'))
    return ARCH_CATEGORIES['messaging']!;
  if (n.includes('git') || n.includes('ci') || n.includes('deploy') || n.includes('docker') || n.includes('kube'))
    return ARCH_CATEGORIES['devops']!;
  if (n.includes('analytics') || n.includes('metric') || n.includes('track'))
    return ARCH_CATEGORIES['analytics']!;
  if (n.includes('pay') || n.includes('invoice') || n.includes('billing') || n.includes('stripe'))
    return ARCH_CATEGORIES['finance']!;
  if (n.includes('shop') || n.includes('store') || n.includes('commerce') || n.includes('cart'))
    return ARCH_CATEGORIES['ecommerce']!;
  if (n.includes('ai') || n.includes('llm') || n.includes('gpt') || n.includes('model'))
    return ARCH_CATEGORIES['ai']!;
  if (n.includes('calendar') || n.includes('schedule') || n.includes('booking'))
    return ARCH_CATEGORIES['scheduling']!;
  if (n.includes('monitor') || n.includes('alert') || n.includes('sentry') || n.includes('log'))
    return ARCH_CATEGORIES['monitoring']!;
  if (n.includes('storage') || n.includes('s3') || n.includes('bucket') || n.includes('file'))
    return ARCH_CATEGORIES['storage']!;
  if (n.includes('crm') || n.includes('lead') || n.includes('contact'))
    return ARCH_CATEGORIES['crm']!;
  if (n.includes('cms') || n.includes('content') || n.includes('blog'))
    return ARCH_CATEGORIES['cms']!;
  if (n.includes('form') || n.includes('survey'))
    return ARCH_CATEGORIES['forms']!;
  if (n.includes('notify') || n.includes('push') || n.includes('bell'))
    return ARCH_CATEGORIES['notifications']!;
  if (n.includes('support') || n.includes('ticket') || n.includes('helpdesk'))
    return ARCH_CATEGORIES['support']!;
  if (n.includes('social') || n.includes('twitter') || n.includes('linkedin'))
    return ARCH_CATEGORIES['social']!;
  if (n.includes('api') || n.includes('http') || n.includes('webhook') || n.includes('cloud') || n.includes('server'))
    return ARCH_CATEGORIES['cloud']!;
  if (n.includes('design') || n.includes('figma') || n.includes('sketch'))
    return ARCH_CATEGORIES['design']!;
  if (n.includes('project') || n.includes('task') || n.includes('board') || n.includes('kanban'))
    return ARCH_CATEGORIES['project-mgmt']!;
  // Ultimate fallback: productivity (generic tool)
  return ARCH_CATEGORIES['productivity']!;
}

/** Get the architectural category for a connector name. Never returns 'Other'. */
export function getArchCategory(connectorName: string): ArchCategory {
  const key = CONNECTOR_TO_CATEGORY[connectorName];
  if (key && ARCH_CATEGORIES[key]) return ARCH_CATEGORIES[key];
  return inferCategory(connectorName);
}

/** Derive unique architectural categories from a list of connector names. */
export function deriveArchCategories(connectors: string[]): ArchCategory[] {
  const seen = new Set<string>();
  const result: ArchCategory[] = [];
  for (const c of connectors) {
    if (!c) continue;
    const cat = getArchCategory(c);
    if (!seen.has(cat.key)) {
      seen.add(cat.key);
      result.push(cat);
    }
  }
  return result;
}

/**
 * Check if user has ANY credential in a given architectural category.
 * @param categoryKey - e.g. 'messaging'
 * @param userCredentialServiceTypes - Set of service_type strings user has credentials for
 */
export function userHasCategoryCredential(
  categoryKey: string,
  userCredentialServiceTypes: Set<string>,
): boolean {
  // Built-in components -- always available without external credentials
  const catDef = catalogCategories[categoryKey];
  if (catDef?.builtIn) return true;

  for (const [connector, cat] of Object.entries(CONNECTOR_TO_CATEGORY)) {
    if (cat === categoryKey && userCredentialServiceTypes.has(connector)) {
      return true;
    }
  }
  return false;
}

/**
 * Compute category-level readiness for a template.
 * Returns { total, ready } counts.
 */
export function computeCategoryReadiness(
  connectors: string[],
  userCredentialServiceTypes: Set<string>,
): { total: number; ready: number } {
  const categories = deriveArchCategories(connectors);
  let ready = 0;
  for (const cat of categories) {
    if (userHasCategoryCredential(cat.key, userCredentialServiceTypes)) {
      ready++;
    }
  }
  return { total: categories.length, ready };
}
