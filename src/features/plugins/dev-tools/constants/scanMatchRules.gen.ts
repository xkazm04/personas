// GENERATED FILE — do not edit.
// Source: src-tauri/src/commands/infrastructure/scan_agents.toml (`match` field
// per agent), emitted by scripts/skills/gen-scan-match-rules.mjs. One rule per
// scan lens, guaranteed complete: the generator fails if any agent lacks a
// `match` regex, so a lens can never silently become unrecommendable again.

/** Keyword patterns that map context attributes to relevant scan agents. */
export const SCAN_MATCH_RULES: { agentKey: string; keywords: RegExp }[] = [
  { agentKey: 'code-optimizer', keywords: /performance|render|bundle|query|slow|cache|optim/i },
  { agentKey: 'security-auditor', keywords: /auth|login|token|secret|password|credential|session|encrypt|permission/i },
  { agentKey: 'architecture-analyst', keywords: /architect|module|component|layer|service|pattern|coupling|abstract/i },
  { agentKey: 'test-strategist', keywords: /test|spec|coverage|mock|assert|e2e|integration|unit/i },
  { agentKey: 'dependency-auditor', keywords: /package|dependency|import|library|version|npm|cargo/i },
  { agentKey: 'ux-reviewer', keywords: /ui|ux|component|page|view|form|modal|button|layout|style/i },
  { agentKey: 'accessibility-checker', keywords: /a11y|accessibility|aria|wcag|screen.?reader|keyboard|contrast/i },
  { agentKey: 'mobile-specialist', keywords: /mobile|responsive|viewport|touch|swipe|tablet/i },
  { agentKey: 'error-handler', keywords: /error|exception|catch|boundary|fallback|retry|toast|alert/i },
  { agentKey: 'onboarding-designer', keywords: /onboard|wizard|setup|welcome|tutorial|getting.?started/i },
  { agentKey: 'feature-scout', keywords: /feature|roadmap|missing|todo|placeholder|future/i },
  { agentKey: 'monetization-advisor', keywords: /billing|payment|subscription|plan|pricing|tier|premium/i },
  { agentKey: 'analytics-planner', keywords: /analytics|tracking|event|metric|telemetry|log/i },
  { agentKey: 'documentation-auditor', keywords: /doc|readme|comment|api.?doc|jsdoc|guide/i },
  { agentKey: 'growth-hacker', keywords: /share|referral|invite|social|viral|notification/i },
  { agentKey: 'tech-debt-tracker', keywords: /debt|legacy|workaround|hack|deprecated|fixme|todo/i },
  { agentKey: 'innovation-catalyst', keywords: /ai|ml|machine.?learn|llm|agent|automat|innovat/i },
  { agentKey: 'risk-assessor', keywords: /risk|single.?point|scale|failover|backup|disaster|recovery/i },
  { agentKey: 'integration-planner', keywords: /api|webhook|integration|sync|external|third.?party|oauth/i },
  { agentKey: 'devops-optimizer', keywords: /ci|cd|deploy|docker|pipeline|build|monitor|infra/i },
  { agentKey: 'bounty-hunter', keywords: /exploit|vulnerab|race.?condition|edge.?case|logic.?flaw|inconsisten|data.?leak|bounty/i },
  { agentKey: 'business-strategist', keywords: /business.?value|monetiz|conversion|retention|competitor|workflow.?friction|revenue|value.?prop/i },
  { agentKey: 'registry-conformance', keywords: /registry|golden.?path|technique|convention|standard|doctrine|ai-registry/i },
];

/** Display copy per scan lens (label, description, examples), from the same TOML. */
export const SCAN_LENS_COPY: Record<string, { label: string; description: string; examples: string[] }> = {
  "code-optimizer": {
    "label": "Code Optimizer",
    "description": "Identifies performance bottlenecks and optimization opportunities",
    "examples": [
      "Reduce bundle size",
      "Optimize database queries",
      "Improve render performance"
    ]
  },
  "security-auditor": {
    "label": "Security Auditor",
    "description": "Identifies security vulnerabilities and best practice violations",
    "examples": [
      "XSS prevention",
      "SQL injection risks",
      "Authentication gaps"
    ]
  },
  "architecture-analyst": {
    "label": "Architecture Analyst",
    "description": "Evaluates system architecture and suggests structural improvements",
    "examples": [
      "Reduce coupling",
      "Improve modularity",
      "Better separation of concerns"
    ]
  },
  "test-strategist": {
    "label": "Test Strategist",
    "description": "Identifies gaps in test coverage and suggests testing strategies",
    "examples": [
      "Missing edge cases",
      "Integration test gaps",
      "E2E scenarios"
    ]
  },
  "dependency-auditor": {
    "label": "Dependency Auditor",
    "description": "Analyzes dependencies for updates, vulnerabilities, and bloat",
    "examples": [
      "Outdated packages",
      "Unused dependencies",
      "Version conflicts"
    ]
  },
  "ux-reviewer": {
    "label": "UX Reviewer",
    "description": "Reviews user experience patterns and suggests improvements",
    "examples": [
      "Loading states",
      "Error handling UX",
      "Navigation clarity"
    ]
  },
  "accessibility-checker": {
    "label": "Accessibility Checker",
    "description": "Identifies accessibility issues and WCAG compliance gaps",
    "examples": [
      "Missing ARIA labels",
      "Color contrast",
      "Keyboard navigation"
    ]
  },
  "mobile-specialist": {
    "label": "Mobile Specialist",
    "description": "Evaluates mobile experience and responsive design",
    "examples": [
      "Touch targets",
      "Viewport handling",
      "Mobile performance"
    ]
  },
  "error-handler": {
    "label": "Error Handler",
    "description": "Reviews error handling, recovery flows, and user messaging",
    "examples": [
      "Graceful degradation",
      "Retry logic",
      "Error boundaries"
    ]
  },
  "onboarding-designer": {
    "label": "Onboarding Designer",
    "description": "Evaluates first-time user experience and onboarding flows",
    "examples": [
      "Setup wizards",
      "Progressive disclosure",
      "Empty states"
    ]
  },
  "feature-scout": {
    "label": "Feature Scout",
    "description": "Identifies missing features and enhancement opportunities",
    "examples": [
      "Competitive features",
      "User-requested features",
      "Market gaps"
    ]
  },
  "monetization-advisor": {
    "label": "Monetization Advisor",
    "description": "Suggests revenue optimization and pricing strategies",
    "examples": [
      "Premium features",
      "Usage limits",
      "Conversion funnels"
    ]
  },
  "analytics-planner": {
    "label": "Analytics Planner",
    "description": "Plans analytics instrumentation and data collection",
    "examples": [
      "Event tracking",
      "Funnel analysis",
      "User behavior insights"
    ]
  },
  "documentation-auditor": {
    "label": "Documentation Auditor",
    "description": "Reviews documentation completeness and quality",
    "examples": [
      "API docs",
      "README quality",
      "Code comments"
    ]
  },
  "growth-hacker": {
    "label": "Growth Hacker",
    "description": "Identifies growth opportunities and viral mechanics",
    "examples": [
      "Sharing features",
      "Referral programs",
      "Network effects"
    ]
  },
  "tech-debt-tracker": {
    "label": "Tech Debt Tracker",
    "description": "Catalogs technical debt and prioritizes repayment",
    "examples": [
      "Legacy code",
      "Missing abstractions",
      "Workarounds"
    ]
  },
  "innovation-catalyst": {
    "label": "Innovation Catalyst",
    "description": "Suggests innovative approaches and paradigm shifts",
    "examples": [
      "AI integration",
      "New architectures",
      "Emerging patterns"
    ]
  },
  "risk-assessor": {
    "label": "Risk Assessor",
    "description": "Identifies project risks and mitigation strategies",
    "examples": [
      "Single points of failure",
      "Scaling risks",
      "Data loss scenarios"
    ]
  },
  "integration-planner": {
    "label": "Integration Planner",
    "description": "Plans system integrations and API design",
    "examples": [
      "Third-party APIs",
      "Webhook design",
      "Data synchronization"
    ]
  },
  "devops-optimizer": {
    "label": "DevOps Optimizer",
    "description": "Optimizes build, deploy, and operations workflows",
    "examples": [
      "CI/CD pipelines",
      "Docker optimization",
      "Monitoring gaps"
    ]
  },
  "bounty-hunter": {
    "label": "Bounty Hunter",
    "description": "Scans for exploitable bugs, logic flaws, and edge cases that qualify for bug bounty programs — pricing anomalies, data inconsistencies, rule violations, race conditions, and UI/logic mismatches",
    "examples": [
      "Pricing calculation errors",
      "Race conditions in state updates",
      "Inconsistent validation rules",
      "Edge cases in boundary logic",
      "Data leaks between user contexts"
    ]
  },
  "business-strategist": {
    "label": "Business Strategist",
    "description": "Finds pure business-value opportunities: monetization, conversion, user retention, missing features competitors have, pricing/packaging surfaces, and workflow friction that costs users money or time. Thinks like a product manager, not an engineer — proposes WHAT to build for value, not refactors.",
    "examples": [
      "Add usage-based billing tier",
      "Reduce onboarding drop-off step",
      "Export reports customers ask for",
      "Surface ROI metrics on dashboard"
    ]
  },
  "registry-conformance": {
    "label": "Registry Conformance",
    "description": "Compares the code against the organization's AI-registry knowledge (golden paths, techniques, applications) that governs this context and turns each named deviation into a backlog item carrying the technique it violates and the prescribed fix. Only meaningful when the repo declares a registry; otherwise reports nothing",
    "examples": [
      "Adopt the registry's stale-response guard technique",
      "Replace hand-rolled retry with the governed pattern",
      "Record a deviation the standard names"
    ]
  }
};
