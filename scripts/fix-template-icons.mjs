/**
 * Assigns distinct Lucide icons to each template based on its purpose,
 * replacing the generic category-wide icons (e.g., all content = FileText).
 *
 *   node scripts/fix-template-icons.mjs
 */
import fs from 'fs';
import path from 'path';

// ── Per-template icon overrides ─────────────────────────────────
// Key = template filename (without .json), Value = Lucide icon name
const ICON_MAP = {
  // ── content ───────────────────────────────────────────────────
  'analytics-content-distribution-use-case': 'BarChart3',
  'cms-index-sync-use-case': 'RefreshCw',
  'cms-sync-use-case': 'ArrowLeftRight',
  'content-approval-workflow': 'CheckCircle2',
  'video-knowledge-base-builder': 'Video',

  // ── development ───────────────────────────────────────────────
  'build-intelligence-use-case': 'Cpu',
  'ci-cd-pipeline-manager': 'GitPullRequest',
  'design-handoff-coordinator': 'Figma',
  'dev-lifecycle-manager': 'GitBranch',
  'documentation-freshness-guardian': 'BookOpen',
  'documentation-publisher': 'BookMarked',
  'engineering-workflow-orchestrator': 'Workflow',
  'feature-flag-experiment-analyst': 'FlaskConical',
  'feature-flag-governance-use-case': 'Flag',
  'real-time-database-watcher': 'Database',
  'search-quality-monitor': 'Search',
  'sprint-automation-use-case': 'Zap',
  'sprint-documentation-use-case': 'FileText',
  'user-lifecycle-manager': 'UserCog',

  // ── devops ────────────────────────────────────────────────────
  'app-performance-guardian': 'Gauge',
  'database-health-sentinel': 'HeartPulse',
  'deployment-guardian': 'Rocket',
  'error-response-coordinator': 'AlertTriangle',
  'incident-commander': 'Siren',
  'infrastructure-health-use-case': 'ServerCog',
  'sre-runbook-executor': 'Terminal',
  'status-page-manager': 'MonitorCheck',

  // ── email ─────────────────────────────────────────────────────
  'email-deliverability-monitor': 'MailCheck',
  'intake-processor': 'Inbox',

  // ── finance ───────────────────────────────────────────────────
  'accounting-reconciliation-use-case': 'Calculator',
  'finance-controller': 'Landmark',
  'personal-finance-use-case': 'Wallet',
  'revenue-operations-hub': 'TrendingUp',
  'subscription-billing-use-case': 'CreditCard',

  // ── hr ────────────────────────────────────────────────────────
  'recruiting-pipeline-use-case': 'UserPlus',

  // ── legal ─────────────────────────────────────────────────────
  'contract-lifecycle-use-case': 'FileSignature',
  'editorial-calendar-manager': 'CalendarDays',

  // ── marketing ─────────────────────────────────────────────────
  'ad-campaign-optimizer': 'Target',
  'campaign-performance-analyst': 'BarChart',
  'marketing-audience-sync-use-case': 'UsersRound',
  'sms-ops-manager': 'Smartphone',

  // ── pipeline ──────────────────────────────────────────────────
  'competitive-intelligence-pipeline-3-use-case-team': 'Eye',
  'customer-onboarding-pipeline-5-use-case-team': 'UserCheck',
  'financial-close-pipeline-4-use-case-team': 'Landmark',
  'multi-channel-support-triage-pipeline-5-use-case-team': 'Route',
  'multi-region-e-commerce-fulfillment-pipeline-4-use-case-team': 'PackageCheck',

  // ── productivity ──────────────────────────────────────────────
  'ai-cost-usage-monitor': 'Bot',
  'appointment-orchestrator': 'CalendarCheck',
  'cross-platform-task-synchronizer': 'ArrowLeftRight',
  'meeting-lifecycle-manager': 'Video',
  'operational-playbook-executor': 'Play',
  'personal-capture-bot': 'MessageSquarePlus',
  'router': 'Route',
  'survey-processor': 'ClipboardList',
  'team-decision-logger': 'Vote',

  // ── project-management ────────────────────────────────────────
  'deadline-synchronizer': 'Timer',
  'sheets-project-portfolio-manager': 'LayoutDashboard',
  'weekly-planning-automator': 'CalendarRange',

  // ── research ──────────────────────────────────────────────────
  'customer-event-intelligence': 'Radar',
  'industry-intelligence-aggregator': 'Globe',
  'product-analytics-briefer': 'PieChart',
  'product-signal-detector': 'Radio',

  // ── sales ─────────────────────────────────────────────────────
  'lead-capture-pipeline': 'UserPlus',
  'sales-pipeline-autopilot': 'Handshake',
  'sheets-e-commerce-command-center': 'ShoppingCart',

  // ── security ──────────────────────────────────────────────────
  'edge-security-monitor': 'ShieldAlert',
  'security-vulnerability-pipeline': 'Bug',

  // ── support ───────────────────────────────────────────────────
  'customer-feedback-router': 'MessageSquare',
  'knowledge-base-review-cycle-manager': 'BookOpen',
  'support-escalation-engine': 'ArrowUpCircle',
  'support-intelligence-use-case': 'BrainCircuit',
};

// ── Walk & patch ────────────────────────────────────────────────

function walkDir(dir) {
  let results = [];
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (!file.startsWith('_')) results = results.concat(walkDir(full));
    } else if (file.endsWith('.json')) {
      results.push(full);
    }
  }
  return results;
}

const files = walkDir('scripts/templates');
let updated = 0;

for (const f of files) {
  const basename = path.basename(f, '.json');
  const newIcon = ICON_MAP[basename];
  if (!newIcon) continue;

  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (data.icon === newIcon) continue;

  data.icon = newIcon;
  fs.writeFileSync(f, JSON.stringify(data, null, 2) + '\n', 'utf8');
  updated++;
  console.log(`${basename}: ${data.icon || '(none)'} -> ${newIcon}`);
}

console.log(`\nDone. Updated icons in ${updated} templates.`);
