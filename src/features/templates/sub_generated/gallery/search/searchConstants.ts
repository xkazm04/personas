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
  Settings,
  Briefcase,
  BarChart3,
  type LucideIcon,
} from 'lucide-react';

// ── Category icon/color mapping ──────────────────────────────────

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
  Other:                { icon: LayoutGrid,    color: '#71717a', label: 'Other' },
};

export function getCategoryMeta(name: string) {
  return CATEGORY_META[name] ?? { icon: LayoutGrid, color: '#71717a', label: name };
}

// ── Sort Options ─────────────────────────────────────────────────

export const SORT_OPTIONS = [
  { value: 'readiness', label: 'Ready to Deploy', dir: 'desc' },
  { value: 'created_at', label: 'Newest First', dir: 'desc' },
  { value: 'created_at_asc', label: 'Oldest First', dir: 'asc' },
  { value: 'name', label: 'Name A-Z', dir: 'asc' },
  { value: 'name_desc', label: 'Name Z-A', dir: 'desc' },
  { value: 'quality', label: 'Highest Quality', dir: 'desc' },
  { value: 'trending', label: 'Most Adopted', dir: 'desc' },
];

// ── Category Role Groups ─────────────────────────────────────────

export interface RoleGroup {
  role: string;
  label: string;
  icon: LucideIcon;
  description: string;
  categories: string[];
}

export const CATEGORY_ROLE_GROUPS: RoleGroup[] = [
  { role: 'software',   icon: Code2,     label: 'Software',        description: 'Development, CI/CD, testing & quality',        categories: ['development', 'devops', 'testing', 'quality'] },
  { role: 'operations', icon: Settings,  label: 'Operations',      description: 'Monitoring, security & maintenance',            categories: ['monitoring', 'security', 'maintenance', 'pipeline'] },
  { role: 'business',   icon: Briefcase, label: 'Business',        description: 'Sales, marketing, finance & HR',                categories: ['sales', 'marketing', 'finance', 'hr', 'legal'] },
  { role: 'content',    icon: FileText,  label: 'Content',         description: 'Content creation, docs & research',             categories: ['content', 'documentation', 'research'] },
  { role: 'customer',   icon: Users,     label: 'Customer',        description: 'Support, communication & email',                categories: ['support', 'communication', 'email'] },
  { role: 'data',       icon: BarChart3, label: 'Data & Analytics', description: 'Data, productivity & project management',      categories: ['data', 'productivity', 'project-management'] },
];
