/**
 * Explore prototype — shared mock catalog.
 *
 * PROTOTYPE ONLY. Hardcoded English + invented data so the three Explore
 * variants can be compared on the SAME items organized by different hierarchies
 * (industry-first vs task-first vs characteristics-first). Real wiring to the
 * `gallery` hook (PersonaDesignReview[] / recipes / personas) happens once a
 * direction is chosen. i18n is deliberately deferred until then.
 */
import {
  Eye, MessageSquareReply, Search, PenLine, Workflow, BarChart3,
  type LucideIcon,
} from 'lucide-react';

// ── Taxonomies ──────────────────────────────────────────────────────────────

/** Industry verticals — the entry axis for Variant 1 (Industry Atlas). */
export interface Industry {
  id: string;
  label: string;
  /** Accent color (hex) — themable tint for tiles/nodes. */
  color: string;
  /** One-line "who you are". */
  blurb: string;
}

export const INDUSTRIES: Industry[] = [
  { id: 'saas',       label: 'SaaS & Software',   color: '#6366f1', blurb: 'Product, growth, and dev teams shipping software' },
  { id: 'ecommerce',  label: 'E-commerce',        color: '#f59e0b', blurb: 'Stores, marketplaces, and DTC brands' },
  { id: 'fintech',    label: 'Fintech & Finance', color: '#10b981', blurb: 'Payments, lending, accounting, and treasury' },
  { id: 'agency',     label: 'Agency & Marketing',color: '#ec4899', blurb: 'Studios running campaigns for many clients' },
  { id: 'healthcare', label: 'Healthcare',        color: '#06b6d4', blurb: 'Clinics, telehealth, and patient operations' },
  { id: 'realestate', label: 'Real Estate',       color: '#8b5cf6', blurb: 'Brokerages, property management, and PropTech' },
  { id: 'legal',      label: 'Legal & Compliance',color: '#0ea5e9', blurb: 'Firms and in-house teams handling contracts & risk' },
  { id: 'media',      label: 'Media & Creator',   color: '#ef4444', blurb: 'Publishers, newsrooms, and creators' },
];

/** Business function — the cluster axis inside an industry. */
export interface Fn {
  id: string;
  label: string;
  color: string;
}

export const FUNCTIONS: Fn[] = [
  { id: 'sales',     label: 'Sales',        color: '#f59e0b' },
  { id: 'support',   label: 'Support',      color: '#06b6d4' },
  { id: 'marketing', label: 'Marketing',    color: '#ec4899' },
  { id: 'ops',       label: 'Operations',   color: '#8b5cf6' },
  { id: 'finance',   label: 'Finance',      color: '#10b981' },
  { id: 'eng',       label: 'Engineering',  color: '#6366f1' },
  { id: 'people',    label: 'People & HR',  color: '#f43f5e' },
  { id: 'research',  label: 'Research',     color: '#0ea5e9' },
];

/** Job-to-be-done — the entry axis for Variant 2 (Task Flow). Verb-led. */
export interface Task {
  id: string;
  label: string;
  verb: string;
  icon: LucideIcon;
  color: string;
  blurb: string;
}

export const TASKS: Task[] = [
  { id: 'watch',      label: 'Watch & Alert',       verb: 'Watch',      icon: Eye,               color: '#06b6d4', blurb: 'Keep an eye on something and ping me when it matters' },
  { id: 'respond',    label: 'Respond & Resolve',   verb: 'Respond',    icon: MessageSquareReply, color: '#f59e0b', blurb: 'Handle incoming requests and close the loop' },
  { id: 'research',   label: 'Research & Summarize',verb: 'Research',   icon: Search,            color: '#0ea5e9', blurb: 'Gather signal from many sources into a brief' },
  { id: 'generate',   label: 'Generate & Draft',    verb: 'Generate',   icon: PenLine,           color: '#ec4899', blurb: 'Produce content, copy, or assets on demand' },
  { id: 'orchestrate',label: 'Orchestrate & Route', verb: 'Orchestrate',icon: Workflow,          color: '#8b5cf6', blurb: 'Move work between systems and people reliably' },
  { id: 'analyze',    label: 'Analyze & Report',    verb: 'Analyze',    icon: BarChart3,         color: '#10b981', blurb: 'Turn data into a decision-ready readout' },
];

/** The 9 archetypes — the entry axis for Variant 3 (Persona Constellation).
 *  Mirrors scripts/templates/_archetypes.json (id + tagline). */
export interface Archetype {
  id: string;
  label: string;
  tagline: string;
  color: string;
}

export const ARCHETYPES: Archetype[] = [
  { id: 'guardian',       label: 'Guardian',       tagline: 'Nothing ships unverified',            color: '#ef4444' },
  { id: 'analyst',        label: 'Analyst',        tagline: 'Every claim cited, every number anchored', color: '#0ea5e9' },
  { id: 'scout',          label: 'Scout',          tagline: 'Signal over volume, always fresh',     color: '#06b6d4' },
  { id: 'operator',       label: 'Operator',       tagline: 'Never lose an event, never send twice', color: '#8b5cf6' },
  { id: 'sentinel',       label: 'Sentinel',       tagline: 'Silence means healthy',                color: '#10b981' },
  { id: 'curator',        label: 'Curator',        tagline: 'One source of truth, always current',  color: '#f59e0b' },
  { id: 'craftsman',      label: 'Craftsman',      tagline: 'Polish is a trust signal',             color: '#ec4899' },
  { id: 'shipper',        label: 'Shipper',        tagline: 'Ship to learn — speed is the edge',     color: '#f43f5e' },
  { id: 'chief-of-staff', label: 'Chief of Staff', tagline: 'Your attention, fiercely guarded',      color: '#6366f1' },
];

// ── Catalog items ────────────────────────────────────────────────────────────

export type ItemKind = 'template' | 'recipe' | 'persona';
export type Difficulty = 'starter' | 'intermediate' | 'advanced';

export interface ExploreItem {
  id: string;
  name: string;
  blurb: string;
  kind: ItemKind;
  industries: string[];
  fn: string;
  archetype: string;
  task: string;
  /** Adoption count — drives node size + ranking. */
  popularity: number;
  difficulty: Difficulty;
  connectors: string[];
  /** Credentials already satisfied on this machine (quick-start). */
  ready: boolean;
  /** Trait axes (0..1) for constellation positioning. */
  traits: { proactive: number; autonomy: number; depth: number };
}

// A compact, deliberately-spread mock catalog (~36 items) so every hierarchy
// has enough to feel populated. Popularity ~ [5..320].
export const ITEMS: ExploreItem[] = [
  it('lead-router',       'Inbound Lead Router',        'Route new leads to the right rep and log to CRM', 'template', ['saas','agency'], 'sales', 'operator', 'orchestrate', 210, 'starter', ['slack','hubspot'], true,  0.8, 0.7, 0.3),
  it('deal-desk',         'Deal Desk Analyst',          'Score and summarize deals for approval',          'template', ['saas','fintech'], 'sales', 'analyst', 'analyze', 140, 'intermediate', ['salesforce'], false, 0.4, 0.5, 0.8),
  it('churn-watch',       'Churn Signal Watcher',       'Flag at-risk accounts from usage drops',          'recipe',   ['saas'], 'sales', 'scout', 'watch', 95, 'intermediate', ['stripe','slack'], true,  0.9, 0.6, 0.6),
  it('quote-drafter',     'Quote & Proposal Drafter',   'Draft branded quotes from a brief',               'template', ['saas','agency','realestate'], 'sales', 'craftsman', 'generate', 60, 'starter', ['drive'], false, 0.3, 0.4, 0.5),

  it('ticket-triage',     'Support Ticket Triage',      'Classify and prioritize inbound tickets',         'template', ['saas','ecommerce'], 'support', 'operator', 'respond', 320, 'starter', ['zendesk','slack'], true,  0.7, 0.8, 0.4),
  it('kb-answerer',       'KB Auto-Answerer',           'Draft replies grounded in your help center',      'recipe',   ['saas','ecommerce'], 'support', 'curator', 'respond', 180, 'intermediate', ['zendesk','notion'], false, 0.5, 0.7, 0.6),
  it('escalation-sentry', 'Escalation Sentry',          'Watch SLAs and escalate before breach',           'template', ['saas'], 'support', 'sentinel', 'watch', 110, 'advanced', ['zendesk','slack'], true,  0.9, 0.7, 0.5),
  it('csat-reporter',     'CSAT Weekly Reporter',       'Roll up satisfaction into a weekly brief',        'recipe',   ['ecommerce','healthcare'], 'support', 'analyst', 'analyze', 45, 'starter', ['zendesk'], false, 0.3, 0.4, 0.7),

  it('campaign-planner',  'Campaign Planner',           'Plan multi-channel campaigns from a goal',        'template', ['agency','ecommerce'], 'marketing', 'chief-of-staff', 'orchestrate', 130, 'intermediate', ['notion','slack'], false, 0.6, 0.5, 0.6),
  it('content-factory',   'Content Draft Factory',      'Generate on-brand posts and emails',              'recipe',   ['agency','media'], 'marketing', 'craftsman', 'generate', 240, 'starter', ['drive'], true,  0.4, 0.5, 0.4),
  it('trend-scout',       'Trend Scout',                'Surface fresh topics from the web daily',         'template', ['media','agency'], 'marketing', 'scout', 'research', 160, 'starter', ['drive'], true,  0.95, 0.6, 0.5),
  it('seo-auditor',       'SEO Content Auditor',        'Audit pages and rank fixes by impact',            'recipe',   ['ecommerce','saas'], 'marketing', 'analyst', 'analyze', 70, 'advanced', ['drive'], false, 0.4, 0.5, 0.9),

  it('invoice-chaser',    'Invoice Chaser',             'Nudge overdue invoices on a schedule',            'template', ['fintech','agency'], 'finance', 'operator', 'orchestrate', 190, 'starter', ['stripe','gmail'], true,  0.7, 0.8, 0.4),
  it('spend-watch',       'Spend Anomaly Watch',        'Alert on unusual spend and burn',                 'recipe',   ['fintech','saas'], 'finance', 'sentinel', 'watch', 85, 'intermediate', ['stripe','slack'], true,  0.9, 0.6, 0.6),
  it('close-analyst',     'Month-End Close Analyst',    'Reconcile and summarize the close',               'template', ['fintech'], 'finance', 'analyst', 'analyze', 55, 'advanced', ['stripe'], false, 0.3, 0.5, 0.9),

  it('pr-reviewer',       'PR Review Companion',        'Review pull requests against your rules',         'template', ['saas'], 'eng', 'guardian', 'respond', 300, 'intermediate', ['github'], true,  0.6, 0.7, 0.8),
  it('incident-sentry',   'Incident Sentry',            'Watch alerts and open incidents cleanly',         'template', ['saas','fintech'], 'eng', 'sentinel', 'watch', 175, 'advanced', ['github','slack'], true,  0.95, 0.8, 0.6),
  it('release-notes',     'Release Notes Writer',       'Draft release notes from merged PRs',             'recipe',   ['saas'], 'eng', 'craftsman', 'generate', 120, 'starter', ['github'], false, 0.4, 0.6, 0.5),
  it('dep-curator',       'Dependency Curator',         'Track and summarize dependency updates',          'recipe',   ['saas'], 'eng', 'curator', 'research', 40, 'intermediate', ['github'], false, 0.6, 0.5, 0.7),

  it('order-ops',         'Order Ops Orchestrator',     'Handle order exceptions end-to-end',              'template', ['ecommerce','logistics'], 'ops', 'operator', 'orchestrate', 200, 'intermediate', ['slack','stripe'], true,  0.7, 0.9, 0.5),
  it('vendor-watch',      'Vendor SLA Watch',           'Monitor vendor performance and flag misses',      'recipe',   ['ecommerce','realestate'], 'ops', 'sentinel', 'watch', 65, 'intermediate', ['slack'], false, 0.9, 0.6, 0.5),
  it('sop-curator',       'SOP Curator',                'Keep runbooks current from changes',              'template', ['healthcare','saas'], 'ops', 'curator', 'orchestrate', 50, 'starter', ['notion'], true,  0.5, 0.5, 0.6),

  it('recruiter-scout',   'Candidate Scout',            'Surface and rank inbound candidates',             'template', ['saas','agency'], 'people', 'scout', 'research', 90, 'starter', ['gmail','notion'], false, 0.8, 0.6, 0.5),
  it('onboarding-cos',    'Onboarding Chief of Staff',  'Drive new-hire onboarding checklists',            'recipe',   ['saas','healthcare'], 'people', 'chief-of-staff', 'orchestrate', 75, 'starter', ['slack','notion'], true,  0.6, 0.7, 0.4),
  it('policy-guardian',   'Policy Compliance Guardian', 'Check docs against policy before sign-off',       'template', ['legal','healthcare','fintech'], 'people', 'guardian', 'respond', 60, 'advanced', ['drive'], false, 0.5, 0.6, 0.9),

  it('contract-analyst',  'Contract Intake & Analysis', 'Extract terms and flag risk in contracts',        'template', ['legal','realestate','fintech'], 'research', 'analyst', 'analyze', 150, 'intermediate', ['drive'], false, 0.4, 0.5, 0.95),
  it('market-scout',      'Market Research Scout',      'Compile competitive intel on demand',             'template', ['saas','media'], 'research', 'scout', 'research', 135, 'starter', ['drive'], true,  0.9, 0.6, 0.7),
  it('brief-curator',     'Daily Brief Curator',        'One clean brief from many feeds',                 'recipe',   ['media','fintech'], 'research', 'curator', 'research', 220, 'starter', ['drive'], true,  0.85, 0.6, 0.6),
  it('patient-intake',    'Patient Intake Assistant',   'Triage and route patient messages',               'template', ['healthcare'], 'support', 'operator', 'respond', 80, 'intermediate', ['gmail'], false, 0.7, 0.8, 0.5),

  it('listing-writer',    'Listing Copywriter',         'Write property listings from specs',              'recipe',   ['realestate'], 'marketing', 'craftsman', 'generate', 48, 'starter', ['drive'], true,  0.3, 0.4, 0.4),
  it('lead-nurture',      'Lead Nurture Sequencer',     'Warm leads with timed follow-ups',                'template', ['realestate','saas'], 'sales', 'operator', 'orchestrate', 100, 'intermediate', ['gmail','hubspot'], false, 0.7, 0.8, 0.4),
  it('fraud-sentry',      'Fraud Signal Sentry',        'Watch transactions for fraud patterns',           'template', ['fintech','ecommerce'], 'finance', 'sentinel', 'watch', 115, 'advanced', ['stripe','slack'], true,  0.95, 0.7, 0.8),
  it('growth-analyst',    'Growth Metrics Analyst',     'Explain what moved the funnel this week',         'recipe',   ['saas','ecommerce'], 'marketing', 'analyst', 'analyze', 105, 'intermediate', ['stripe'], false, 0.4, 0.5, 0.85),
  it('press-scout',       'Press & Mentions Scout',     'Track brand mentions across the web',             'recipe',   ['media','agency'], 'marketing', 'scout', 'watch', 58, 'starter', ['slack'], true,  0.9, 0.6, 0.4),
  it('helpdesk-cos',      'Helpdesk Chief of Staff',    'Balance the queue and staff the day',             'template', ['ecommerce','saas'], 'support', 'chief-of-staff', 'orchestrate', 42, 'advanced', ['zendesk','slack'], false, 0.6, 0.7, 0.6),
  it('docs-guardian',     'Docs Accuracy Guardian',     'Verify docs match shipped behavior',              'recipe',   ['saas'], 'eng', 'guardian', 'respond', 38, 'intermediate', ['github','notion'], false, 0.5, 0.6, 0.8),
];

function it(
  id: string, name: string, blurb: string, kind: ItemKind,
  industries: string[], fn: string, archetype: string, task: string,
  popularity: number, difficulty: Difficulty, connectors: string[], ready: boolean,
  proactive: number, autonomy: number, depth: number,
): ExploreItem {
  return { id, name, blurb, kind, industries, fn, archetype, task, popularity, difficulty, connectors, ready, traits: { proactive, autonomy, depth } };
}

// ── Lookups + selectors ──────────────────────────────────────────────────────

export const industryById = (id: string) => INDUSTRIES.find((i) => i.id === id);
export const fnById = (id: string) => FUNCTIONS.find((f) => f.id === id);
export const taskById = (id: string) => TASKS.find((t) => t.id === id);
export const archetypeById = (id: string) => ARCHETYPES.find((a) => a.id === id);

export const itemsForIndustry = (industryId: string) =>
  ITEMS.filter((i) => i.industries.includes(industryId));
export const itemsForTask = (taskId: string) =>
  ITEMS.filter((i) => i.task === taskId);
export const itemsForArchetype = (archetypeId: string) =>
  ITEMS.filter((i) => i.archetype === archetypeId);

/** Count of items per grouping value — drives tile badges. */
export function countBy(getKey: (i: ExploreItem) => string | string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of ITEMS) {
    const k = getKey(item);
    for (const key of Array.isArray(k) ? k : [k]) out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}
