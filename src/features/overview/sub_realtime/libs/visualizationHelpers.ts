// -- Layout Constants (viewBox 0-100) -----------------------------------------

export const CX = 50;
export const CY = 50;
export const TOOL_RING_R = 42;
export const PERSONA_RING_R = 24;
export const TOOL_NODE_R_MIN = 2.5;
export const TOOL_NODE_R_MAX = 4.5;
export const TOOL_NODE_R = 3.5;
export const PERSONA_NODE_R = 4;
export const CORE_OUTER_R = 13;
export const CORE_INNER_R = 7;
export const PROGRESS_R = PERSONA_NODE_R + 1.8;
export const PROGRESS_CIRC = 2 * Math.PI * PROGRESS_R;

export const RETURN_FLOW_MS = 1800;

/** Sources fade to ghost opacity after this many ms without traffic. */
export const FADE_AFTER_MS = 30_000;

// -- Types --------------------------------------------------------------------

export interface SwarmNode {
  id: string;
  label: string;
  icon: string | null;
  color: string;
  x: number;
  y: number;
  sizeFactor?: number;
}

export interface ProcessingInfo {
  color: string;
  durationMs: number;
  startedAt: number;
}

export interface ReturnFlow {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
  startedAt: number;
}

/** Tracked source discovered from real event traffic. */
export interface DiscoveredSource {
  id: string;
  label: string;
  count: number;
  lastSeen: number;
}

// -- Known Source Colors ------------------------------------------------------

export const SOURCE_COLORS: Record<string, string> = {
  gmail: '#ea4335', slack: '#611f69', github: '#8b5cf6', calendar: '#06b6d4',
  jira: '#0052cc', drive: '#34a853', stripe: '#635bff', figma: '#f24e1e',
  notion: '#e0e0e0', discord: '#5865F2', sentry: '#8456a6', vercel: '#c8c8c8',
  datadog: '#632CA6', aws: '#FF9900', linear: '#5E6AD2', hubspot: '#FF7A59',
  webhook: '#06b6d4', system: '#8b5cf6', trigger: '#f59e0b', test: '#10b981',
  cloud: '#38bdf8', gitlab: '#FC6D26', deployment: '#38bdf8',
};

export function colorForSource(id: string): string {
  const lower = id.toLowerCase();
  for (const [key, color] of Object.entries(SOURCE_COLORS)) {
    if (lower.includes(key)) return color;
  }
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 60%, 55%)`;
}

export function labelForSource(id: string): string {
  const cleaned = id.replace(/[_-]/g, ' ');
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

// -- Default Nodes (fallback when no real traffic) ----------------------------

export const DEFAULT_TOOLS: Array<{ id: string; label: string; icon: null; color: string }> = [
  { id: 'def:gmail',     label: 'Gmail',     icon: null, color: '#ea4335' },
  { id: 'def:slack',     label: 'Slack',     icon: null, color: '#611f69' },
  { id: 'def:github',    label: 'GitHub',    icon: null, color: '#8b5cf6' },
  { id: 'def:calendar',  label: 'Calendar',  icon: null, color: '#06b6d4' },
  { id: 'def:jira',      label: 'Jira',      icon: null, color: '#0052cc' },
  { id: 'def:drive',     label: 'Drive',     icon: null, color: '#34a853' },
  { id: 'def:stripe',    label: 'Stripe',    icon: null, color: '#635bff' },
  { id: 'def:notion',    label: 'Notion',    icon: null, color: '#e0e0e0' },
  { id: 'def:cloud',     label: 'Cloud',     icon: null, color: '#38bdf8' },
  { id: 'def:gitlab',    label: 'GitLab',    icon: null, color: '#FC6D26' },
];

export const DEFAULT_PERSONAS = [
  { id: 'demo:inbox',    label: 'Inbox Triage',  icon: '📧', color: '#3b82f6' },
  { id: 'demo:reviewer', label: 'Code Review',   icon: '🔍', color: '#8b5cf6' },
  { id: 'demo:digest',   label: 'Slack Digest',  icon: '💬', color: '#06b6d4' },
  { id: 'demo:router',   label: 'Task Router',   icon: '🔀', color: '#f59e0b' },
  { id: 'demo:guard',    label: 'Deploy Guard',  icon: '🛡', color: '#10b981' },
  { id: 'demo:reporter', label: 'Report Gen',    icon: '📊', color: '#ec4899' },
];

export const EVENT_TYPE_LABELS: Record<string, string> = {
  webhook_received: 'Webhook',
  execution_completed: 'Execution',
  persona_action: 'Action',
  credential_event: 'Credential',
  task_created: 'Task',
  test_event: 'Test',
  custom: 'Custom',
  deploy_started: 'Deploy',
  deploy_succeeded: 'Deployed',
  deploy_failed: 'Deploy Fail',
  deploy_paused: 'Paused',
  deploy_resumed: 'Resumed',
  agent_undeployed: 'Undeployed',
  credential_provisioned: 'Cred Prov.',
};

// -- Geometry Helpers ---------------------------------------------------------

export function distributeOnRing(
  raw: { id: string; label: string; icon: string | null; color: string; sizeFactor?: number }[],
  radius: number,
  angleOffset = 0,
): SwarmNode[] {
  const count = raw.length;
  if (count === 0) return [];
  return raw.map((n, i) => {
    const angle = angleOffset + (i * 2 * Math.PI) / count;
    return { ...n, x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle), sizeFactor: n.sizeFactor };
  });
}

export function iconChar(node: SwarmNode): string {
  if (node.icon && node.icon.length <= 2) return node.icon;
  return node.label[0]?.toUpperCase() ?? '?';
}

export function clampLabel(label: string, max: number): string {
  return label.length > max ? label.slice(0, max - 1) + '\u2026' : label;
}
