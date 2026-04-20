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

// -- Category icon/color mapping ----------------------------------

export const CATEGORY_META: Record<string, { icon: LucideIcon; color: string; label: string }> = {
  communication:        { icon: MessageSquare, color: '#6366f1', label: 'Communication' },
  content:              { icon: FileText,      color: '#f59e0b', label: 'Content' },
  data:                 { icon: Database,      color: '#06b6d4', label: 'Data' },
  development:          { icon: Code2,         color: '#8b5cf6', label: 'Development' },
  devops:               { icon: Container,     color: '#3b82f6', label: 'DevOps' },
  documentation:        { icon: BookOpen,      color: '#a78bfa', label: 'Documentation' },
  email:                { icon: Mail,          color: '#ef4444', label: 'Email' },
  finance:              { icon: DollarSign,    color: '#10b981', label: 'Finance' },
  hr:                   { icon: Users,         color: '#f97316', label: 'HR' },
  legal:                { icon: Scale,         color: '#64748b', label: 'Legal' },
  maintenance:          { icon: Wrench,        color: '#78716c', label: 'Maintenance' },
  marketing:            { icon: Megaphone,     color: '#ec4899', label: 'Marketing' },
  monitoring:           { icon: Activity,      color: '#14b8a6', label: 'Monitoring' },
  pipeline:             { icon: GitBranch,     color: '#2563eb', label: 'Pipeline' },
  productivity:         { icon: Zap,           color: '#eab308', label: 'Productivity' },
  'project-management': { icon: Kanban,        color: '#0ea5e9', label: 'Project Mgmt' },
  quality:              { icon: BadgeCheck,     color: '#22c55e', label: 'Quality' },
  research:             { icon: FlaskConical,  color: '#a855f7', label: 'Research' },
  sales:                { icon: TrendingUp,    color: '#f43f5e', label: 'Sales' },
  security:             { icon: Shield,        color: '#ef4444', label: 'Security' },
  support:              { icon: LifeBuoy,      color: '#0891b2', label: 'Support' },
  testing:              { icon: TestTube2,     color: '#84cc16', label: 'Testing' },
  ai:                   { icon: Bot,           color: '#6C3AEF', label: 'AI' },
  automation:           { icon: Workflow,      color: '#0ea5e9', label: 'Automation' },
  ecommerce:            { icon: ShoppingBag,   color: '#7AB55C', label: 'E-Commerce' },
  scheduling:           { icon: Calendar,      color: '#006BFF', label: 'Scheduling' },
  education:            { icon: GraduationCap, color: '#6366f1', label: 'Education' },
  analytics:            { icon: BarChart3,     color: '#7856FF', label: 'Analytics' },
  integration:          { icon: Globe,         color: '#3b82f6', label: 'Integration' },
  operations:           { icon: Cog,           color: '#78716c', label: 'Operations' },
};

/**
 * Alias map: normalizes common category variations to canonical keys
 * so templates with e.g. "Other", "project_management", "ci-cd" resolve properly.
 */
const CATEGORY_ALIASES: Record<string, string> = {
  // Case variants / common mismatches
  'project_management': 'project-management',
  'project management': 'project-management',
  'projectmanagement':  'project-management',
  'project-mgmt':      'project-management',
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

export function getCategoryMeta(name: string) {
  if (CATEGORY_META[name]) return CATEGORY_META[name];
  // Try alias lookup (case-insensitive)
  const normalized = name.toLowerCase().trim();
  const aliasKey = CATEGORY_ALIASES[normalized];
  if (aliasKey && CATEGORY_META[aliasKey]) return CATEGORY_META[aliasKey];
  // Try direct lowercase match
  if (CATEGORY_META[normalized]) return CATEGORY_META[normalized];
  return { icon: LayoutGrid, color: '#71717a', label: name };
}

// -- Sort Options -------------------------------------------------

export const SORT_OPTIONS = [
  { value: 'readiness', label: 'Ready to Deploy', dir: 'desc' },
  { value: 'created_at', label: 'Newest First', dir: 'desc' },
  { value: 'created_at_asc', label: 'Oldest First', dir: 'asc' },
  { value: 'name', label: 'Name A-Z', dir: 'asc' },
  { value: 'name_desc', label: 'Name Z-A', dir: 'desc' },
  { value: 'quality', label: 'Highest Quality', dir: 'desc' },
  { value: 'trending', label: 'Most Adopted', dir: 'desc' },
];

// -- Category Role Groups -----------------------------------------

export interface RoleGroup {
  role: string;
  label: string;
  icon: LucideIcon;
  description: string;
  categories: string[];
}

export const CATEGORY_ROLE_GROUPS: RoleGroup[] = [
  { role: 'software',     icon: Code2,        label: 'Software',     description: '', categories: ['development', 'devops', 'security', 'testing', 'quality'] },
  { role: 'business',     icon: Briefcase,    label: 'Business',     description: '', categories: ['sales', 'marketing', 'finance', 'hr', 'legal'] },
  { role: 'research',     icon: FlaskConical, label: 'Research',     description: '', categories: ['research', 'content', 'documentation'] },
  { role: 'customer',     icon: Users,        label: 'Customer',     description: '', categories: ['support', 'email', 'communication'] },
  { role: 'productivity', icon: Zap,          label: 'Productivity', description: '', categories: ['productivity', 'project-management', 'operations', 'monitoring'] },
];
