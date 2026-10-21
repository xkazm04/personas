import {
  LayoutGrid,
  MessageSquare,
  FileText,
  Database,
  Code2,
  Container,
  BookOpen,
  Mail,
  DollarSign,
  Users,
  Scale,
  Wrench,
  Megaphone,
  Activity,
  GitBranch,
  Zap,
  Kanban,
  BadgeCheck,
  FlaskConical,
  TrendingUp,
  Shield,
  LifeBuoy,
  TestTube2,
  Briefcase,
  BarChart3,
  Bot,
  ShoppingBag,
  Calendar,
  GraduationCap,
  Workflow,
  Globe,
  Cog,
  type LucideIcon,
} from 'lucide-react';
import type { Translations } from '@/i18n/useTranslation';

type SearchKey = keyof Translations['templates']['search'];

// -- Category icon/color mapping ----------------------------------

export const CATEGORY_META: Record<string, { icon: LucideIcon; color: string; labelKey: SearchKey }> = {
  communication:        { icon: MessageSquare, color: '#6366f1', labelKey: 'cat_communication' },
  content:              { icon: FileText,      color: '#f59e0b', labelKey: 'cat_content' },
  data:                 { icon: Database,      color: '#06b6d4', labelKey: 'cat_data' },
  development:          { icon: Code2,         color: '#8b5cf6', labelKey: 'cat_development' },
  devops:               { icon: Container,     color: '#3b82f6', labelKey: 'cat_devops' },
  documentation:        { icon: BookOpen,      color: '#a78bfa', labelKey: 'cat_documentation' },
  email:                { icon: Mail,          color: '#ef4444', labelKey: 'cat_email' },
  finance:              { icon: DollarSign,    color: '#10b981', labelKey: 'cat_finance' },
  hr:                   { icon: Users,         color: '#f97316', labelKey: 'cat_hr' },
  legal:                { icon: Scale,         color: '#64748b', labelKey: 'cat_legal' },
  maintenance:          { icon: Wrench,        color: '#78716c', labelKey: 'cat_maintenance' },
  marketing:            { icon: Megaphone,     color: '#ec4899', labelKey: 'cat_marketing' },
  monitoring:           { icon: Activity,      color: '#14b8a6', labelKey: 'cat_monitoring' },
  pipeline:             { icon: GitBranch,     color: '#2563eb', labelKey: 'cat_pipeline' },
  productivity:         { icon: Zap,           color: '#eab308', labelKey: 'cat_productivity' },
  project_management:   { icon: Kanban,        color: '#0ea5e9', labelKey: 'cat_project_management' },
  quality:              { icon: BadgeCheck,     color: '#22c55e', labelKey: 'cat_quality' },
  research:             { icon: FlaskConical,  color: '#a855f7', labelKey: 'cat_research' },
  sales:                { icon: TrendingUp,    color: '#f43f5e', labelKey: 'cat_sales' },
  security:             { icon: Shield,        color: '#ef4444', labelKey: 'cat_security' },
  support:              { icon: LifeBuoy,      color: '#0891b2', labelKey: 'cat_support' },
  testing:              { icon: TestTube2,     color: '#84cc16', labelKey: 'cat_testing' },
  ai:                   { icon: Bot,           color: '#6C3AEF', labelKey: 'cat_ai' },
  automation:           { icon: Workflow,      color: '#0ea5e9', labelKey: 'cat_automation' },
  ecommerce:            { icon: ShoppingBag,   color: '#7AB55C', labelKey: 'cat_ecommerce' },
  scheduling:           { icon: Calendar,      color: '#006BFF', labelKey: 'cat_scheduling' },
  education:            { icon: GraduationCap, color: '#6366f1', labelKey: 'cat_education' },
  analytics:            { icon: BarChart3,     color: '#7856FF', labelKey: 'cat_analytics' },
  integration:          { icon: Globe,         color: '#3b82f6', labelKey: 'cat_integration' },
  operations:           { icon: Cog,           color: '#78716c', labelKey: 'cat_operations' },
};

/**
 * Alias map: normalizes common category variations to canonical keys
 * so templates with e.g. "Other", "project_management", "ci-cd" resolve properly.
 */
const CATEGORY_ALIASES: Record<string, string> = {
  // Case variants / common mismatches
  'project-management': 'project_management',
  'project management': 'project_management',
  'projectmanagement':  'project_management',
  'project-mgmt':       'project_management',
  'e-commerce':         'ecommerce',
  'e_commerce':         'ecommerce',
  'ci-cd':              'devops',
  'ci/cd':              'devops',
  'cicd':               'devops',
  'customer-support':   'support',
  'customer_support':   'support',
  'customer support':   'support',
  'customer-service':   'support',
  'helpdesk':           'support',
  'crm':                'sales',
  'social':             'marketing',
  'social-media':       'marketing',
  'social_media':       'marketing',
  'notifications':      'communication',
  'messaging':          'communication',
  'chat':               'communication',
  'design':             'content',
  'media':              'content',
  'engineering':        'development',
  'coding':             'development',
  'infrastructure':     'devops',
  'deployment':         'devops',
  'observability':      'monitoring',
  'logging':            'monitoring',
  'accounting':         'finance',
  'billing':            'finance',
  'payments':           'finance',
  'recruiting':         'hr',
  'hiring':             'hr',
  'compliance':         'legal',
  'onboarding':         'hr',
  'workflow':           'automation',
  'general':            'productivity',
  'utility':            'productivity',
  'misc':               'productivity',
  'other':              'productivity',
};

/** Localized display name for a category; unknown categories show their raw name. */
export function categoryLabel(t: Translations, name: string): string {
  const key = getCategoryMeta(name).labelKey;
  return key ? t.templates.search[key] : name;
}

export function getCategoryMeta(name: string) {
  if (CATEGORY_META[name]) return CATEGORY_META[name];
  // Try alias lookup (case-insensitive)
  const normalized = name.toLowerCase().trim();
  const aliasKey = CATEGORY_ALIASES[normalized];
  if (aliasKey && CATEGORY_META[aliasKey]) return CATEGORY_META[aliasKey];
  // Try direct lowercase match
  if (CATEGORY_META[normalized]) return CATEGORY_META[normalized];
  return { icon: LayoutGrid, color: '#71717a', labelKey: undefined };
}

// -- Sort Options -------------------------------------------------

export const SORT_OPTIONS: ReadonlyArray<{ value: string; labelKey: SearchKey; dir: string }> = [
  { value: 'readiness', labelKey: 'sort_ready', dir: 'desc' },
  { value: 'created_at', labelKey: 'sort_newest', dir: 'desc' },
  { value: 'created_at_asc', labelKey: 'sort_oldest', dir: 'asc' },
  { value: 'name', labelKey: 'sort_name_asc', dir: 'asc' },
  { value: 'name_desc', labelKey: 'sort_name_desc', dir: 'desc' },
  { value: 'quality', labelKey: 'sort_quality', dir: 'desc' },
  { value: 'trending', labelKey: 'sort_adopted', dir: 'desc' },
];

// -- Category Role Groups -----------------------------------------

export interface RoleGroup {
  role: string;
  labelKey: SearchKey;
  icon: LucideIcon;
  description: string;
  categories: string[];
}

export const CATEGORY_ROLE_GROUPS: RoleGroup[] = [
  { role: 'software',     icon: Code2,        labelKey: 'role_software',     description: '', categories: ['development', 'devops', 'security', 'testing', 'quality'] },
  { role: 'business',     icon: Briefcase,    labelKey: 'role_business',     description: '', categories: ['sales', 'marketing', 'finance', 'hr', 'legal'] },
  { role: 'research',     icon: FlaskConical, labelKey: 'role_research',     description: '', categories: ['research', 'content', 'documentation'] },
  { role: 'customer',     icon: Users,        labelKey: 'role_customer',     description: '', categories: ['support', 'email', 'communication'] },
  { role: 'productivity', icon: Zap,          labelKey: 'role_productivity', description: '', categories: ['productivity', 'project_management', 'operations', 'monitoring'] },
];
