import {
  Zap, Shield, Layers, FlaskConical, Package,
  Palette, Accessibility, Smartphone, AlertOctagon, Target,
  Telescope, DollarSign, BarChart3, FileText, Rocket,
  Landmark, Lightbulb, AlertTriangle, Link2, Wrench, Crosshair,
  type LucideIcon,
} from 'lucide-react';

export interface ScanAgentDef {
  key: string;
  label: string;
  emoji: string;
  icon: LucideIcon;
  abbreviation: string;
  color: string;
  categoryGroup: 'technical' | 'user' | 'business' | 'mastermind';
  description: string;
  examples: string[];
}

export const SCAN_AGENTS: ScanAgentDef[] = [
  // Technical
  { key: 'code-optimizer', label: 'Code Optimizer', emoji: '⚡', icon: Zap, abbreviation: 'OPT', color: '#3B82F6', categoryGroup: 'technical', description: 'Identifies performance bottlenecks and optimization opportunities', examples: ['Reduce bundle size', 'Optimize database queries', 'Improve render performance'] },
  { key: 'security-auditor', label: 'Security Auditor', emoji: '🔒', icon: Shield, abbreviation: 'SEC', color: '#EF4444', categoryGroup: 'technical', description: 'Identifies security vulnerabilities and best practice violations', examples: ['XSS prevention', 'SQL injection risks', 'Authentication gaps'] },
  { key: 'architecture-analyst', label: 'Architecture Analyst', emoji: '🏗️', icon: Layers, abbreviation: 'ARC', color: '#8B5CF6', categoryGroup: 'technical', description: 'Evaluates system architecture and suggests structural improvements', examples: ['Reduce coupling', 'Improve modularity', 'Better separation of concerns'] },
  { key: 'test-strategist', label: 'Test Strategist', emoji: '🧪', icon: FlaskConical, abbreviation: 'TST', color: '#10B981', categoryGroup: 'technical', description: 'Identifies gaps in test coverage and suggests testing strategies', examples: ['Missing edge cases', 'Integration test gaps', 'E2E scenarios'] },
  { key: 'dependency-auditor', label: 'Dependency Auditor', emoji: '📦', icon: Package, abbreviation: 'DEP', color: '#F59E0B', categoryGroup: 'technical', description: 'Analyzes dependencies for updates, vulnerabilities, and bloat', examples: ['Outdated packages', 'Unused dependencies', 'Version conflicts'] },
  // User
  { key: 'ux-reviewer', label: 'UX Reviewer', emoji: '🎨', icon: Palette, abbreviation: 'UXR', color: '#EC4899', categoryGroup: 'user', description: 'Reviews user experience patterns and suggests improvements', examples: ['Loading states', 'Error handling UX', 'Navigation clarity'] },
  { key: 'accessibility-checker', label: 'Accessibility Checker', emoji: '♿', icon: Accessibility, abbreviation: 'A11Y', color: '#6366F1', categoryGroup: 'user', description: 'Identifies accessibility issues and WCAG compliance gaps', examples: ['Missing ARIA labels', 'Color contrast', 'Keyboard navigation'] },
  { key: 'mobile-specialist', label: 'Mobile Specialist', emoji: '📱', icon: Smartphone, abbreviation: 'MOB', color: '#14B8A6', categoryGroup: 'user', description: 'Evaluates mobile experience and responsive design', examples: ['Touch targets', 'Viewport handling', 'Mobile performance'] },
  { key: 'error-handler', label: 'Error Handler', emoji: '🚨', icon: AlertOctagon, abbreviation: 'ERR', color: '#F97316', categoryGroup: 'user', description: 'Reviews error handling, recovery flows, and user messaging', examples: ['Graceful degradation', 'Retry logic', 'Error boundaries'] },
  { key: 'onboarding-designer', label: 'Onboarding Designer', emoji: '🎯', icon: Target, abbreviation: 'ONB', color: '#06B6D4', categoryGroup: 'user', description: 'Evaluates first-time user experience and onboarding flows', examples: ['Setup wizards', 'Progressive disclosure', 'Empty states'] },
  // Business
  { key: 'feature-scout', label: 'Feature Scout', emoji: '🔭', icon: Telescope, abbreviation: 'SCT', color: '#8B5CF6', categoryGroup: 'business', description: 'Identifies missing features and enhancement opportunities', examples: ['Competitive features', 'User-requested features', 'Market gaps'] },
  { key: 'monetization-advisor', label: 'Monetization Advisor', emoji: '💰', icon: DollarSign, abbreviation: 'MON', color: '#F59E0B', categoryGroup: 'business', description: 'Suggests revenue optimization and pricing strategies', examples: ['Premium features', 'Usage limits', 'Conversion funnels'] },
  { key: 'analytics-planner', label: 'Analytics Planner', emoji: '📊', icon: BarChart3, abbreviation: 'ANA', color: '#3B82F6', categoryGroup: 'business', description: 'Plans analytics instrumentation and data collection', examples: ['Event tracking', 'Funnel analysis', 'User behavior insights'] },
  { key: 'documentation-auditor', label: 'Documentation Auditor', emoji: '📝', icon: FileText, abbreviation: 'DOC', color: '#10B981', categoryGroup: 'business', description: 'Reviews documentation completeness and quality', examples: ['API docs', 'README quality', 'Code comments'] },
  { key: 'growth-hacker', label: 'Growth Hacker', emoji: '🚀', icon: Rocket, abbreviation: 'GRW', color: '#EC4899', categoryGroup: 'business', description: 'Identifies growth opportunities and viral mechanics', examples: ['Sharing features', 'Referral programs', 'Network effects'] },
  // Mastermind
  { key: 'tech-debt-tracker', label: 'Tech Debt Tracker', emoji: '🏦', icon: Landmark, abbreviation: 'TDT', color: '#EF4444', categoryGroup: 'mastermind', description: 'Catalogs technical debt and prioritizes repayment', examples: ['Legacy code', 'Missing abstractions', 'Workarounds'] },
  { key: 'innovation-catalyst', label: 'Innovation Catalyst', emoji: '💡', icon: Lightbulb, abbreviation: 'INN', color: '#F59E0B', categoryGroup: 'mastermind', description: 'Suggests innovative approaches and paradigm shifts', examples: ['AI integration', 'New architectures', 'Emerging patterns'] },
  { key: 'risk-assessor', label: 'Risk Assessor', emoji: '⚠️', icon: AlertTriangle, abbreviation: 'RSK', color: '#F97316', categoryGroup: 'mastermind', description: 'Identifies project risks and mitigation strategies', examples: ['Single points of failure', 'Scaling risks', 'Data loss scenarios'] },
  { key: 'integration-planner', label: 'Integration Planner', emoji: '🔗', icon: Link2, abbreviation: 'INT', color: '#6366F1', categoryGroup: 'mastermind', description: 'Plans system integrations and API design', examples: ['Third-party APIs', 'Webhook design', 'Data synchronization'] },
  { key: 'devops-optimizer', label: 'DevOps Optimizer', emoji: '🔧', icon: Wrench, abbreviation: 'OPS', color: '#14B8A6', categoryGroup: 'mastermind', description: 'Optimizes build, deploy, and operations workflows', examples: ['CI/CD pipelines', 'Docker optimization', 'Monitoring gaps'] },
  { key: 'bounty-hunter', label: 'Bounty Hunter', emoji: '🏴‍☠️', icon: Crosshair, abbreviation: 'BNT', color: '#DC2626', categoryGroup: 'technical', description: 'Scans for exploitable bugs, logic flaws, and edge cases that qualify for bug bounty programs', examples: ['Pricing calculation errors', 'Race conditions', 'Inconsistent validation', 'Data leaks between contexts'] },
];

export const AGENT_CATEGORIES = [
  { key: 'technical', label: 'Technical', color: '#3B82F6' },
  { key: 'user', label: 'User Experience', color: '#EC4899' },
  { key: 'business', label: 'Business', color: '#F59E0B' },
  { key: 'mastermind', label: 'Mastermind', color: '#8B5CF6' },
] as const;
