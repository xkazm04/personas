import { useState } from 'react';
import {
  Plug,
  Mail,
  Calendar,
  HardDrive,
  MessageSquare,
  MessageCircle,
  Github,
  Globe,
  CheckSquare,
  Database,
  BookOpen,
  Circle,
  Triangle,
  Shield,
  AlertTriangle,
  CreditCard,
  Users,
  Send,
  BarChart3,
  BarChart,
  Share2,
  ShoppingBag,
  Phone,
  Headphones,
  Activity,
  Bell,
  Flame,
  Bot,
  GitBranch,
  Layout,
  FileText,
  Search,
  Video,
  Flag,
  FileSignature,
  Calculator,
  Link,
  KeyRound,
  Sprout,
  Truck,
  MonitorCheck,
  Cloud,
  FormInput,
  LifeBuoy,
  Kanban,
  ListTodo,
  Megaphone,
  Table,
} from 'lucide-react';

export interface ConnectorMeta {
  label: string;
  color: string;
  iconUrl: string | null;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}

export const CONNECTOR_META: Record<string, ConnectorMeta> = {
  // ── Google ────────────────────────────────────────────────────
  gmail:              { label: 'Gmail',              color: '#EA4335', iconUrl: 'https://cdn.simpleicons.org/gmail/EA4335',           Icon: Mail },
  google_calendar:    { label: 'Google Calendar',    color: '#4285F4', iconUrl: 'https://cdn.simpleicons.org/googlecalendar/4285F4',  Icon: Calendar },
  google_drive:       { label: 'Google Drive',       color: '#0F9D58', iconUrl: 'https://cdn.simpleicons.org/googledrive/0F9D58',     Icon: HardDrive },
  google_workspace:   { label: 'Google Workspace',   color: '#4285F4', iconUrl: 'https://cdn.simpleicons.org/google/4285F4',          Icon: Mail },
  google_sheets:      { label: 'Google Sheets',      color: '#34A853', iconUrl: 'https://cdn.simpleicons.org/googlesheets/34A853',    Icon: Table },
  google_ads:         { label: 'Google Ads',         color: '#4285F4', iconUrl: 'https://cdn.simpleicons.org/googleads/4285F4',       Icon: Megaphone },
  google_analytics:   { label: 'Google Analytics',   color: '#E37400', iconUrl: 'https://cdn.simpleicons.org/googleanalytics/E37400', Icon: BarChart },

  // ── Chat & Messaging ─────────────────────────────────────────
  slack:              { label: 'Slack',              color: '#4A154B', iconUrl: 'https://cdn.simpleicons.org/slack/4A154B',            Icon: MessageSquare },
  discord:            { label: 'Discord',            color: '#5865F2', iconUrl: 'https://cdn.simpleicons.org/discord/5865F2',          Icon: MessageSquare },
  telegram:           { label: 'Telegram',           color: '#26A5E4', iconUrl: 'https://cdn.simpleicons.org/telegram/26A5E4',        Icon: MessageSquare },

  // ── Source Control & CI/CD ────────────────────────────────────
  github:             { label: 'GitHub',             color: '#24292e', iconUrl: 'https://cdn.simpleicons.org/github/f0f0f0',          Icon: Github },
  gitlab:             { label: 'GitLab',             color: '#FC6D26', iconUrl: 'https://cdn.simpleicons.org/gitlab/FC6D26',          Icon: GitBranch },
  circleci:           { label: 'CircleCI',           color: '#343434', iconUrl: 'https://cdn.simpleicons.org/circleci/f0f0f0',        Icon: Circle },

  // ── Project Management ────────────────────────────────────────
  jira:               { label: 'Jira',               color: '#0052CC', iconUrl: 'https://cdn.simpleicons.org/jira/0052CC',            Icon: Globe },
  linear:             { label: 'Linear',             color: '#5E6AD2', iconUrl: 'https://cdn.simpleicons.org/linear/5E6AD2',          Icon: CheckSquare },
  clickup:            { label: 'ClickUp',            color: '#7B68EE', iconUrl: 'https://cdn.simpleicons.org/clickup/7B68EE',         Icon: CheckSquare },
  asana:              { label: 'Asana',              color: '#F06A6A', iconUrl: 'https://cdn.simpleicons.org/asana/F06A6A',            Icon: CheckSquare },
  trello:             { label: 'Trello',             color: '#0052CC', iconUrl: 'https://cdn.simpleicons.org/trello/0052CC',           Icon: Kanban },
  monday_com:         { label: 'Monday.com',         color: '#6C3AEF', iconUrl: 'https://cdn.simpleicons.org/mondaydotcom/6C3AEF',    Icon: Kanban },
  todoist:            { label: 'Todoist',            color: '#E44332', iconUrl: 'https://cdn.simpleicons.org/todoist/E44332',          Icon: ListTodo },

  // ── Knowledge & Productivity ──────────────────────────────────
  notion:             { label: 'Notion',             color: '#FFFFFF', iconUrl: 'https://cdn.simpleicons.org/notion/f0f0f0',          Icon: Globe },
  confluence:         { label: 'Confluence',         color: '#172B4D', iconUrl: 'https://cdn.simpleicons.org/confluence/172B4D',       Icon: BookOpen },
  airtable:           { label: 'Airtable',           color: '#18BFFF', iconUrl: 'https://cdn.simpleicons.org/airtable/18BFFF',        Icon: Table },
  coda:               { label: 'Coda',               color: '#F46A54', iconUrl: 'https://cdn.simpleicons.org/coda/F46A54',            Icon: FileText },

  // ── Design ────────────────────────────────────────────────────
  figma:              { label: 'Figma',              color: '#F24E1E', iconUrl: 'https://cdn.simpleicons.org/figma/F24E1E',            Icon: Layout },

  // ── Cloud & DevOps ────────────────────────────────────────────
  vercel:             { label: 'Vercel',             color: '#000000', iconUrl: 'https://cdn.simpleicons.org/vercel/f0f0f0',           Icon: Triangle },
  netlify:            { label: 'Netlify',            color: '#00C7B7', iconUrl: 'https://cdn.simpleicons.org/netlify/00C7B7',          Icon: Globe },
  cloudflare:         { label: 'Cloudflare',         color: '#F38020', iconUrl: 'https://cdn.simpleicons.org/cloudflare/F38020',       Icon: Shield },
  aws:                { label: 'AWS',                color: '#FF9900', iconUrl: 'https://cdn.simpleicons.org/amazonaws/FF9900',        Icon: Cloud },
  firebase:           { label: 'Firebase',           color: '#DD2C00', iconUrl: 'https://cdn.simpleicons.org/firebase/DD2C00',         Icon: Flame },

  // ── Database ──────────────────────────────────────────────────
  supabase:           { label: 'Supabase',           color: '#3FCF8E', iconUrl: 'https://cdn.simpleicons.org/supabase/3FCF8E',         Icon: Database },
  postgres_proxy:     { label: 'PostgreSQL',         color: '#4169E1', iconUrl: 'https://cdn.simpleicons.org/postgresql/4169E1',       Icon: Database },

  // ── Monitoring & Observability ────────────────────────────────
  sentry:             { label: 'Sentry',             color: '#362D59', iconUrl: 'https://cdn.simpleicons.org/sentry/f0f0f0',           Icon: AlertTriangle },
  datadog:            { label: 'Datadog',            color: '#632CA6', iconUrl: 'https://cdn.simpleicons.org/datadog/632CA6',          Icon: Activity },
  pagerduty:          { label: 'PagerDuty',          color: '#06AC38', iconUrl: 'https://cdn.simpleicons.org/pagerduty/06AC38',        Icon: Bell },
  uptime_robot:       { label: 'Uptime Robot',       color: '#3BD671', iconUrl: 'https://cdn.simpleicons.org/uptimerobot/3BD671',     Icon: MonitorCheck },
  snyk:               { label: 'Snyk',               color: '#4C4A73', iconUrl: 'https://cdn.simpleicons.org/snyk/f0f0f0',             Icon: Shield },

  // ── Analytics ─────────────────────────────────────────────────
  mixpanel:           { label: 'Mixpanel',           color: '#7856FF', iconUrl: 'https://cdn.simpleicons.org/mixpanel/7856FF',         Icon: BarChart3 },
  posthog:            { label: 'PostHog',            color: '#1D4AFF', iconUrl: 'https://cdn.simpleicons.org/posthog/1D4AFF',          Icon: BarChart },
  amplitude:          { label: 'Amplitude',          color: '#003E82', iconUrl: 'https://cdn.simpleicons.org/amplitude/f0f0f0',        Icon: BarChart },
  segment:            { label: 'Segment',            color: '#52BD95', iconUrl: 'https://cdn.simpleicons.org/segment/52BD95',          Icon: BarChart },

  // ── Email & SMS ───────────────────────────────────────────────
  sendgrid:           { label: 'SendGrid',           color: '#1A82E2', iconUrl: 'https://cdn.simpleicons.org/twilio/1A82E2',           Icon: Send },
  mailchimp:          { label: 'Mailchimp',          color: '#FFE01B', iconUrl: 'https://cdn.simpleicons.org/mailchimp/FFE01B',        Icon: Mail },
  twilio:             { label: 'Twilio',             color: '#F22F46', iconUrl: 'https://cdn.simpleicons.org/twilio/F22F46',           Icon: Phone },

  // ── CRM ───────────────────────────────────────────────────────
  hubspot:            { label: 'HubSpot',            color: '#FF7A59', iconUrl: 'https://cdn.simpleicons.org/hubspot/FF7A59',          Icon: Users },
  intercom:           { label: 'Intercom',           color: '#6AFDEF', iconUrl: 'https://cdn.simpleicons.org/intercom/6AFDEF',         Icon: MessageCircle },

  // ── Support ───────────────────────────────────────────────────
  zendesk:            { label: 'Zendesk',            color: '#03363D', iconUrl: 'https://cdn.simpleicons.org/zendesk/f0f0f0',          Icon: LifeBuoy },
  freshdesk:          { label: 'Freshdesk',          color: '#00A656', iconUrl: 'https://cdn.simpleicons.org/freshdesk/00A656',        Icon: Headphones },

  // ── Social ────────────────────────────────────────────────────
  buffer:             { label: 'Buffer',             color: '#231F20', iconUrl: 'https://cdn.simpleicons.org/buffer/f0f0f0',           Icon: Share2 },
  twitter:            { label: 'X (Twitter)',        color: '#000000', iconUrl: 'https://cdn.simpleicons.org/x/f0f0f0',                Icon: MessageCircle },

  // ── E-Commerce ────────────────────────────────────────────────
  shopify:            { label: 'Shopify',            color: '#7AB55C', iconUrl: 'https://cdn.simpleicons.org/shopify/7AB55C',          Icon: ShoppingBag },
  shipstation:        { label: 'ShipStation',        color: '#84C225', iconUrl: null,                                                   Icon: Truck },

  // ── Finance & Payments ────────────────────────────────────────
  stripe:             { label: 'Stripe',             color: '#635BFF', iconUrl: 'https://cdn.simpleicons.org/stripe/635BFF',           Icon: CreditCard },
  paddle:             { label: 'Paddle',             color: '#FDDD35', iconUrl: 'https://cdn.simpleicons.org/paddle/FDDD35',           Icon: CreditCard },
  quickbooks:         { label: 'QuickBooks',         color: '#2CA01C', iconUrl: 'https://cdn.simpleicons.org/quickbooks/2CA01C',       Icon: Calculator },
  xero:               { label: 'Xero',               color: '#13B5EA', iconUrl: 'https://cdn.simpleicons.org/xero/13B5EA',            Icon: Calculator },
  plaid:              { label: 'Plaid',              color: '#111111', iconUrl: 'https://cdn.simpleicons.org/plaid/f0f0f0',             Icon: Link },

  // ── Scheduling ────────────────────────────────────────────────
  calendly:           { label: 'Calendly',           color: '#006BFF', iconUrl: 'https://cdn.simpleicons.org/calendly/006BFF',         Icon: Calendar },

  // ── CMS ───────────────────────────────────────────────────────
  wordpress:          { label: 'WordPress',          color: '#21759B', iconUrl: 'https://cdn.simpleicons.org/wordpress/21759B',        Icon: Globe },
  webflow:            { label: 'Webflow',            color: '#4353FF', iconUrl: 'https://cdn.simpleicons.org/webflow/4353FF',          Icon: Layout },
  contentful:         { label: 'Contentful',         color: '#2478CC', iconUrl: 'https://cdn.simpleicons.org/contentful/2478CC',       Icon: FileText },

  // ── Search ────────────────────────────────────────────────────
  algolia:            { label: 'Algolia',            color: '#003DFF', iconUrl: 'https://cdn.simpleicons.org/algolia/003DFF',          Icon: Search },

  // ── Video ─────────────────────────────────────────────────────
  loom:               { label: 'Loom',               color: '#625DF5', iconUrl: 'https://cdn.simpleicons.org/loom/625DF5',             Icon: Video },

  // ── Feature Flags ─────────────────────────────────────────────
  launchdarkly:       { label: 'LaunchDarkly',       color: '#3DD6F5', iconUrl: 'https://cdn.simpleicons.org/launchdarkly/3DD6F5',     Icon: Flag },

  // ── Legal & Signatures ────────────────────────────────────────
  docusign:           { label: 'DocuSign',           color: '#FFCC22', iconUrl: 'https://cdn.simpleicons.org/docusign/FFCC22',         Icon: FileSignature },

  // ── Auth & Identity ───────────────────────────────────────────
  clerk:              { label: 'Clerk',              color: '#6C47FF', iconUrl: 'https://cdn.simpleicons.org/clerk/6C47FF',            Icon: KeyRound },

  // ── HR ────────────────────────────────────────────────────────
  greenhouse:         { label: 'Greenhouse',         color: '#24A47F', iconUrl: null,                                                   Icon: Sprout },

  // ── AI ────────────────────────────────────────────────────────
  openai:             { label: 'OpenAI',             color: '#412991', iconUrl: 'https://cdn.simpleicons.org/openai/f0f0f0',           Icon: Bot },

  // ── Cloud Storage ─────────────────────────────────────────────
  dropbox:            { label: 'Dropbox',            color: '#0061FF', iconUrl: 'https://cdn.simpleicons.org/dropbox/0061FF',          Icon: HardDrive },

  // ── Forms ─────────────────────────────────────────────────────
  typeform:           { label: 'Typeform',           color: '#262627', iconUrl: 'https://cdn.simpleicons.org/typeform/f0f0f0',         Icon: FormInput },

  // ── Generic ───────────────────────────────────────────────────
  http:               { label: 'HTTP / REST',        color: '#3B82F6', iconUrl: null,                                                   Icon: Globe },
};

export function getConnectorMeta(name: string): ConnectorMeta {
  if (CONNECTOR_META[name]) return CONNECTOR_META[name];
  const slug = name.toLowerCase().replace(/[_\s]/g, '');
  return { label: name, color: '#6B7280', iconUrl: `https://cdn.simpleicons.org/${slug}/9ca3af`, Icon: Plug };
}

export function ConnectorIcon({ meta, size = 'w-3.5 h-3.5' }: { meta: ConnectorMeta; size?: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const FallbackIcon = meta.Icon;
  if (meta.iconUrl && !imgFailed) {
    return <img src={meta.iconUrl} alt={meta.label} className={size} onError={() => setImgFailed(true)} />;
  }
  return <FallbackIcon className={size} style={{ color: meta.color }} />;
}
