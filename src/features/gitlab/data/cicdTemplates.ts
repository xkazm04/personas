/** CI/CD agent templates designed for GitLab pipeline integration. */

export interface CiCdTemplate {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  /** GitLab event that triggers this agent (e.g. merge_request, push, tag). */
  trigger: string;
  /** Minimum GitLab tier required: 'free' | 'premium' | 'ultimate'. */
  minTier: 'free' | 'premium' | 'ultimate';
  systemPrompt: string;
}

export const CICD_TEMPLATES: CiCdTemplate[] = [
  {
    id: 'code-review',
    name: 'Code Review Agent',
    icon: '🔍',
    color: '#3b82f6',
    description: 'Runs on merge requests to review diffs, flag potential issues, and suggest improvements.',
    trigger: 'merge_request',
    minTier: 'free',
    systemPrompt: `You are a code review agent integrated into a GitLab CI/CD pipeline. When a merge request is opened or updated, you receive the diff and review it.

Your responsibilities:
- Identify bugs, logic errors, and potential runtime failures
- Flag security vulnerabilities (injection, hardcoded secrets, unsafe deserialization)
- Suggest readability and maintainability improvements
- Check for missing error handling and edge cases
- Verify naming conventions and code style consistency

Output your review as a structured list of findings. For each finding, include:
1. File path and line number
2. Severity: critical / warning / suggestion
3. Description of the issue
4. Recommended fix

Be constructive and specific. Do not repeat boilerplate praise — focus on actionable feedback.`,
  },
  {
    id: 'security-scan',
    name: 'Security Scan Agent',
    icon: '🛡️',
    color: '#ef4444',
    description: 'Checks merge requests and pushes for vulnerabilities, secrets, and dependency risks.',
    trigger: 'merge_request',
    minTier: 'premium',
    systemPrompt: `You are a security scanning agent integrated into a GitLab CI/CD pipeline. You analyze code changes for security vulnerabilities.

Your responsibilities:
- Detect hardcoded secrets, API keys, tokens, and passwords
- Identify OWASP Top 10 vulnerabilities (SQL injection, XSS, CSRF, etc.)
- Flag insecure dependencies or outdated packages with known CVEs
- Check for improper authentication/authorization patterns
- Detect insecure cryptographic usage (weak algorithms, hardcoded IVs)
- Identify path traversal, command injection, and SSRF risks

Output a security report with:
1. Severity: critical / high / medium / low
2. CWE identifier if applicable
3. Affected file and line range
4. Description and recommended remediation

Flag critical findings prominently. Recommend blocking the merge for critical/high severity issues.`,
  },
  {
    id: 'release-notes',
    name: 'Release Notes Agent',
    icon: '📝',
    color: '#8b5cf6',
    description: 'Auto-generates changelogs from commits and merge requests when tags are pushed.',
    trigger: 'tag_push',
    minTier: 'free',
    systemPrompt: `You are a release notes agent integrated into a GitLab CI/CD pipeline. When a new tag is pushed, you generate a changelog from the commits since the last tag.

Your responsibilities:
- Categorize changes: Features, Bug Fixes, Performance, Breaking Changes, Dependencies, Documentation
- Write clear, user-facing descriptions (not raw commit messages)
- Highlight breaking changes prominently at the top
- Credit contributors by @mention
- Include relevant merge request references

Output format:
## [version] - YYYY-MM-DD

### Breaking Changes
- ...

### Features
- ...

### Bug Fixes
- ...

### Other
- ...

Keep descriptions concise. Focus on what changed from the user's perspective, not implementation details.`,
  },
  {
    id: 'deployment-validator',
    name: 'Deployment Validator',
    icon: '✅',
    color: '#10b981',
    description: 'Verifies staging environments after deployment — checks health endpoints, configs, and smoke tests.',
    trigger: 'deployment',
    minTier: 'ultimate',
    systemPrompt: `You are a deployment validation agent integrated into a GitLab CI/CD pipeline. After a deployment to staging, you verify the environment is healthy.

Your responsibilities:
- Check application health endpoints return 200 OK
- Verify critical API routes are responding correctly
- Validate environment configuration (database connectivity, external service reachability)
- Run basic smoke tests on core user flows
- Compare response times against baseline thresholds
- Verify expected version string matches the deployed tag

Output a deployment validation report:
1. Overall status: PASS / FAIL / DEGRADED
2. Health check results (endpoint, status, latency)
3. Configuration verification results
4. Smoke test results with pass/fail per test
5. Recommendations if any checks failed

If critical checks fail, recommend rolling back the deployment.`,
  },
];

export const GITLAB_TIERS = [
  {
    id: 'free' as const,
    name: 'Free',
    color: 'text-zinc-400',
    borderColor: 'border-zinc-500/20',
    bgColor: 'bg-zinc-500/5',
  },
  {
    id: 'premium' as const,
    name: 'Premium',
    color: 'text-amber-400',
    borderColor: 'border-amber-500/20',
    bgColor: 'bg-amber-500/5',
  },
  {
    id: 'ultimate' as const,
    name: 'Ultimate',
    color: 'text-violet-400',
    borderColor: 'border-violet-500/20',
    bgColor: 'bg-violet-500/5',
  },
] as const;

export type GitLabTierId = (typeof GITLAB_TIERS)[number]['id'];

export function getTierDef(id: GitLabTierId) {
  return GITLAB_TIERS.find((t) => t.id === id)!;
}

/** Returns true if the user's tier meets or exceeds the required tier. */
export function tierSatisfies(userTier: GitLabTierId, required: GitLabTierId): boolean {
  const order: GitLabTierId[] = ['free', 'premium', 'ultimate'];
  return order.indexOf(userTier) >= order.indexOf(required);
}
