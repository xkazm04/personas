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
  Palette,
  ClipboardList,
  Boxes,
} from 'lucide-react';

export interface ConnectorMeta {
  label: string;
  color: string;
  iconUrl: string | null;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}

export const CONNECTOR_META: Record<string, ConnectorMeta> = {
  // â”€â”€ Google â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  gmail:              { label: 'Gmail',              color: '#EA4335', iconUrl: '/icons/connectors/gmail.svg',                        Icon: Mail },
  google_calendar:    { label: 'Google Calendar',    color: '#4285F4', iconUrl: 'https://cdn.simpleicons.org/googlecalendar/4285F4',  Icon: Calendar },
  google_drive:       { label: 'Google Drive',       color: '#0F9D58', iconUrl: 'https://cdn.simpleicons.org/googledrive/0F9D58',     Icon: HardDrive },
  google_workspace:   { label: 'Google Workspace',   color: '#4285F4', iconUrl: 'https://cdn.simpleicons.org/google/4285F4',          Icon: Mail },
  google_sheets:      { label: 'Google Sheets',      color: '#34A853', iconUrl: '/icons/connectors/google-sheets.svg',                Icon: Table },
  google_ads:         { label: 'Google Ads',         color: '#4285F4', iconUrl: 'https://cdn.simpleicons.org/googleads/4285F4',       Icon: Megaphone },
  google_analytics:   { label: 'Google Analytics',   color: '#E37400', iconUrl: 'https://cdn.simpleicons.org/googleanalytics/E37400', Icon: BarChart },

  // â”€â”€ Microsoft â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  microsoft_outlook:  { label: 'Microsoft Outlook',          color: '#0078D4', iconUrl: '/icons/connectors/microsoft-outlook.svg',  Icon: Mail },
  microsoft_excel:    { label: 'Microsoft Excel',            color: '#217346', iconUrl: '/icons/connectors/microsoft-excel.svg',    Icon: Table },
  microsoft_calendar: { label: 'Microsoft Outlook Calendar', color: '#0078D4', iconUrl: '/icons/connectors/microsoft-calendar.svg', Icon: Calendar },
  microsoft_teams:    { label: 'Microsoft Teams',            color: '#6264A7', iconUrl: '/icons/connectors/microsoft-teams.svg',    Icon: MessageSquare },
  onedrive:           { label: 'OneDrive',                   color: '#0078D4', iconUrl: '/icons/connectors/onedrive.svg',           Icon: HardDrive },
  sharepoint:         { label: 'SharePoint',                 color: '#038387', iconUrl: '/icons/connectors/sharepoint.svg',         Icon: Globe },

  // â”€â”€ Chat & Messaging â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  slack:              { label: 'Slack',              color: '#4A154B', iconUrl: '/icons/connectors/slack.svg',                          Icon: MessageSquare },
  discord:            { label: 'Discord',            color: '#5865F2', iconUrl: 'https://cdn.simpleicons.org/discord/5865F2',          Icon: MessageSquare },
  telegram:           { label: 'Telegram',           color: '#26A5E4', iconUrl: 'https://cdn.simpleicons.org/telegram/26A5E4',        Icon: MessageSquare },
  personas_messages:  { label: 'In-App Messages',    color: '#8B5CF6', iconUrl: null,                                                  Icon: Bell },
  personas_database:  { label: 'Built-in Database',  color: '#06B6D4', iconUrl: null,                                                  Icon: Database },

  // â”€â”€ Source Control & CI/CD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  azure_devops:       { label: 'Azure DevOps',       color: '#0078D7', iconUrl: '/icons/connectors/azure-devops.svg',                   Icon: GitBranch },
  github:             { label: 'GitHub',             color: '#24292e', iconUrl: 'https://cdn.simpleicons.org/github/f0f0f0',          Icon: Github },
  gitlab:             { label: 'GitLab',             color: '#FC6D26', iconUrl: 'https://cdn.simpleicons.org/gitlab/FC6D26',          Icon: GitBranch },
  circleci:           { label: 'CircleCI',           color: '#343434', iconUrl: 'https://cdn.simpleicons.org/circleci/f0f0f0',        Icon: Circle },

  // â”€â”€ Project Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  jira:               { label: 'Jira',               color: '#0052CC', iconUrl: 'https://cdn.simpleicons.org/jira/0052CC',            Icon: Globe },
  linear:             { label: 'Linear',             color: '#5E6AD2', iconUrl: 'https://cdn.simpleicons.org/linear/5E6AD2',          Icon: CheckSquare },
  clickup:            { label: 'ClickUp',            color: '#7B68EE', iconUrl: 'https://cdn.simpleicons.org/clickup/7B68EE',         Icon: CheckSquare },
  asana:              { label: 'Asana',              color: '#F06A6A', iconUrl: '/icons/connectors/asana.svg',                         Icon: CheckSquare },
  trello:             { label: 'Trello',             color: '#0052CC', iconUrl: 'https://cdn.simpleicons.org/trello/0052CC',           Icon: Kanban },
  monday:             { label: 'Monday.com',         color: '#6C3AEF', iconUrl: '/icons/connectors/monday.svg',                        Icon: Kanban },
  monday_com:         { label: 'Monday.com',         color: '#6C3AEF', iconUrl: '/icons/connectors/monday.svg',                        Icon: Kanban },
  todoist:            { label: 'Todoist',            color: '#E44332', iconUrl: 'https://cdn.simpleicons.org/todoist/E44332',          Icon: ListTodo },

  // â”€â”€ Knowledge & Productivity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  notion:             { label: 'Notion',             color: '#FFFFFF', iconUrl: 'https://cdn.simpleicons.org/notion/f0f0f0',          Icon: Globe },
  confluence:         { label: 'Confluence',         color: '#172B4D', iconUrl: 'https://cdn.simpleicons.org/confluence/172B4D',       Icon: BookOpen },
  airtable:           { label: 'Airtable',           color: '#18BFFF', iconUrl: 'https://cdn.simpleicons.org/airtable/18BFFF',        Icon: Table },
  coda:               { label: 'Coda',               color: '#F46A54', iconUrl: 'https://cdn.simpleicons.org/coda/F46A54',            Icon: FileText },

  // â”€â”€ Design â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  figma:              { label: 'Figma',              color: '#F24E1E', iconUrl: 'https://cdn.simpleicons.org/figma/F24E1E',            Icon: Layout },
  canva:              { label: 'Canva',              color: '#00C4CC', iconUrl: '/icons/connectors/canva.svg',                        Icon: Palette },
  penpot:             { label: 'Penpot',             color: '#0D1117', iconUrl: '/icons/connectors/penpot.svg',                       Icon: Layout },

  // â”€â”€ Cloud & DevOps â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  vercel:             { label: 'Vercel',             color: '#000000', iconUrl: 'https://cdn.simpleicons.org/vercel/f0f0f0',           Icon: Triangle },
  netlify:            { label: 'Netlify',            color: '#00C7B7', iconUrl: 'https://cdn.simpleicons.org/netlify/00C7B7',          Icon: Globe },
  cloudflare:         { label: 'Cloudflare',         color: '#F38020', iconUrl: 'https://cdn.simpleicons.org/cloudflare/F38020',       Icon: Shield },
  aws:                { label: 'AWS',                color: '#FF9900', iconUrl: '/icons/connectors/aws.svg',                            Icon: Cloud },
  firebase:           { label: 'Firebase',           color: '#DD2C00', iconUrl: 'https://cdn.simpleicons.org/firebase/DD2C00',         Icon: Flame },
  kubernetes:         { label: 'Kubernetes',         color: '#326CE5', iconUrl: '/icons/connectors/kubernetes.svg',                     Icon: Cloud },

  // â”€â”€ Database â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  supabase:           { label: 'Supabase',           color: '#3FCF8E', iconUrl: 'https://cdn.simpleicons.org/supabase/3FCF8E',         Icon: Database },
  neon:               { label: 'Neon',               color: '#00E599', iconUrl: '/icons/connectors/neon.svg',                           Icon: Database },
  postgres_proxy:     { label: 'PostgreSQL',         color: '#4169E1', iconUrl: 'https://cdn.simpleicons.org/postgresql/4169E1',       Icon: Database },
  convex:             { label: 'Convex',             color: '#EE342F', iconUrl: '/icons/connectors/convex.svg',                         Icon: Database },
  upstash:            { label: 'Upstash',            color: '#00E9A3', iconUrl: '/icons/connectors/upstash.svg',                        Icon: Database },

  // â”€â”€ Monitoring & Observability â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  sentry:             { label: 'Sentry',             color: '#362D59', iconUrl: 'https://cdn.simpleicons.org/sentry/f0f0f0',           Icon: AlertTriangle },
  datadog:            { label: 'Datadog',            color: '#632CA6', iconUrl: 'https://cdn.simpleicons.org/datadog/632CA6',          Icon: Activity },
  pagerduty:          { label: 'PagerDuty',          color: '#06AC38', iconUrl: 'https://cdn.simpleicons.org/pagerduty/06AC38',        Icon: Bell },
  betterstack:        { label: 'Better Stack',       color: '#4A154B', iconUrl: '/icons/connectors/betterstack.svg',                    Icon: MonitorCheck },
  uptime_robot:       { label: 'Uptime Robot',       color: '#3BD671', iconUrl: '/icons/connectors/uptimerobot.svg',                    Icon: MonitorCheck },
  snyk:               { label: 'Snyk',               color: '#4C4A73', iconUrl: 'https://cdn.simpleicons.org/snyk/f0f0f0',             Icon: Shield },

  // â”€â”€ Analytics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  mixpanel:           { label: 'Mixpanel',           color: '#7856FF', iconUrl: 'https://cdn.simpleicons.org/mixpanel/7856FF',         Icon: BarChart3 },
  posthog:            { label: 'PostHog',            color: '#1D4AFF', iconUrl: 'https://cdn.simpleicons.org/posthog/1D4AFF',          Icon: BarChart },
  amplitude:          { label: 'Amplitude',          color: '#003E82', iconUrl: '/icons/connectors/amplitude.svg',                      Icon: BarChart },
  segment:            { label: 'Segment',            color: '#52BD95', iconUrl: '/icons/connectors/segment.svg',                        Icon: BarChart },

  // â”€â”€ Email & SMS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  sendgrid:           { label: 'SendGrid',           color: '#1A82E2', iconUrl: '/icons/connectors/sendgrid.svg',                       Icon: Send },
  mailchimp:          { label: 'Mailchimp',          color: '#FFE01B', iconUrl: 'https://cdn.simpleicons.org/mailchimp/FFE01B',        Icon: Mail },
  twilio:             { label: 'Twilio',             color: '#F22F46', iconUrl: '/icons/connectors/twilio.svg',                         Icon: Phone },

  // â”€â”€ CRM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  hubspot:            { label: 'HubSpot',            color: '#FF7A59', iconUrl: 'https://cdn.simpleicons.org/hubspot/FF7A59',          Icon: Users },
  intercom:           { label: 'Intercom',           color: '#6AFDEF', iconUrl: 'https://cdn.simpleicons.org/intercom/6AFDEF',         Icon: MessageCircle },
  pipedrive:          { label: 'Pipedrive',          color: '#017737', iconUrl: '/icons/connectors/pipedrive.svg',                    Icon: Users },
  attio:              { label: 'Attio',              color: '#4F46E5', iconUrl: '/icons/connectors/attio.svg',                        Icon: Users },

  // â”€â”€ Support â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  zendesk:            { label: 'Zendesk',            color: '#03363D', iconUrl: 'https://cdn.simpleicons.org/zendesk/f0f0f0',          Icon: LifeBuoy },
  freshdesk:          { label: 'Freshdesk',          color: '#00A656', iconUrl: null,                                                   Icon: Headphones },
  crisp:              { label: 'Crisp',              color: '#4B60F5', iconUrl: '/icons/connectors/crisp.svg',                        Icon: MessageCircle },

  // â”€â”€ Social â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  buffer:             { label: 'Buffer',             color: '#231F20', iconUrl: 'https://cdn.simpleicons.org/buffer/f0f0f0',           Icon: Share2 },
  linkedin:           { label: 'LinkedIn',           color: '#0A66C2', iconUrl: '/icons/connectors/linkedin.svg',                      Icon: Users },
  twitter:            { label: 'X (Twitter)',        color: '#000000', iconUrl: 'https://cdn.simpleicons.org/x/f0f0f0',                Icon: MessageCircle },

  // â”€â”€ E-Commerce â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  shopify:            { label: 'Shopify',            color: '#7AB55C', iconUrl: 'https://cdn.simpleicons.org/shopify/7AB55C',          Icon: ShoppingBag },
  shipstation:        { label: 'ShipStation',        color: '#84C225', iconUrl: null,                                                   Icon: Truck },
  woocommerce:        { label: 'WooCommerce',        color: '#96588A', iconUrl: '/icons/connectors/woocommerce.svg',                  Icon: ShoppingBag },
  lemonsqueezy:       { label: 'Lemon Squeezy',      color: '#FFC233', iconUrl: '/icons/connectors/lemonsqueezy.svg',                 Icon: ShoppingBag },

  // â”€â”€ Finance & Payments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  stripe:             { label: 'Stripe',             color: '#635BFF', iconUrl: 'https://cdn.simpleicons.org/stripe/635BFF',           Icon: CreditCard },
  paddle:             { label: 'Paddle',             color: '#FDDD35', iconUrl: 'https://cdn.simpleicons.org/paddle/FDDD35',           Icon: CreditCard },
  quickbooks:         { label: 'QuickBooks',         color: '#2CA01C', iconUrl: 'https://cdn.simpleicons.org/quickbooks/2CA01C',       Icon: Calculator },
  xero:               { label: 'Xero',               color: '#13B5EA', iconUrl: 'https://cdn.simpleicons.org/xero/13B5EA',            Icon: Calculator },
  plaid:              { label: 'Plaid',              color: '#111111', iconUrl: null,                                                    Icon: Link },

  // â”€â”€ Scheduling â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  cal_com:            { label: 'Cal.com',             color: '#292929', iconUrl: '/icons/connectors/cal-com.svg',                        Icon: Calendar },
  calendly:           { label: 'Calendly',           color: '#006BFF', iconUrl: 'https://cdn.simpleicons.org/calendly/006BFF',         Icon: Calendar },

  // â”€â”€ CMS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  wordpress:          { label: 'WordPress',          color: '#21759B', iconUrl: 'https://cdn.simpleicons.org/wordpress/21759B',        Icon: Globe },
  webflow:            { label: 'Webflow',            color: '#4353FF', iconUrl: 'https://cdn.simpleicons.org/webflow/4353FF',          Icon: Layout },
  contentful:         { label: 'Contentful',         color: '#2478CC', iconUrl: 'https://cdn.simpleicons.org/contentful/2478CC',       Icon: FileText },

  // â”€â”€ Search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  algolia:            { label: 'Algolia',            color: '#003DFF', iconUrl: 'https://cdn.simpleicons.org/algolia/003DFF',          Icon: Search },

  // â”€â”€ Video â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  loom:               { label: 'Loom',               color: '#625DF5', iconUrl: 'https://cdn.simpleicons.org/loom/625DF5',             Icon: Video },

  // â”€â”€ Feature Flags â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  launchdarkly:       { label: 'LaunchDarkly',       color: '#3DD6F5', iconUrl: '/icons/connectors/launchdarkly.svg',                   Icon: Flag },

  // â”€â”€ Legal & Signatures â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  docusign:           { label: 'DocuSign',           color: '#FFCC22', iconUrl: '/icons/connectors/docusign.svg',                       Icon: FileSignature },

  // â”€â”€ Auth & Identity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  clerk:              { label: 'Clerk',              color: '#6C47FF', iconUrl: 'https://cdn.simpleicons.org/clerk/6C47FF',            Icon: KeyRound },

  // â”€â”€ HR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  greenhouse:         { label: 'Greenhouse',         color: '#24A47F', iconUrl: null,                                                   Icon: Sprout },

  // â”€â”€ AI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  leonardo_ai:        { label: 'Leonardo AI',        color: '#6C3AEF', iconUrl: '/icons/connectors/leonardo-ai.svg',                    Icon: Bot },
  openai:             { label: 'OpenAI',             color: '#412991', iconUrl: '/icons/connectors/openai.svg',                         Icon: Bot },
  replicate:          { label: 'Replicate',          color: '#3D3D3D', iconUrl: '/icons/connectors/replicate.svg',                      Icon: Bot },

  // â”€â”€ Cloud Storage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  dropbox:            { label: 'Dropbox',            color: '#0061FF', iconUrl: 'https://cdn.simpleicons.org/dropbox/0061FF',          Icon: HardDrive },

  // â”€â”€ Forms â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  typeform:           { label: 'Typeform',           color: '#262627', iconUrl: 'https://cdn.simpleicons.org/typeform/f0f0f0',         Icon: FormInput },
  tally:              { label: 'Tally',              color: '#3CCF91', iconUrl: '/icons/connectors/tally.svg',                        Icon: ClipboardList },
  formbricks:         { label: 'Formbricks',         color: '#00C4B8', iconUrl: '/icons/connectors/formbricks.svg',                   Icon: ClipboardList },

  // ── Storage ────────────────────────────────────────────────────
  aws_s3:             { label: 'AWS S3',             color: '#569A31', iconUrl: '/icons/connectors/aws-s3.svg',                       Icon: Boxes },
  cloudflare_r2:      { label: 'Cloudflare R2',      color: '#F38020', iconUrl: '/icons/connectors/cloudflare-r2.svg',                Icon: Boxes },
  backblaze_b2:       { label: 'Backblaze B2',       color: '#E21E29', iconUrl: '/icons/connectors/backblaze-b2.svg',                 Icon: Boxes },

  // ── Notifications ──────────────────────────────────────────────
  novu:               { label: 'Novu',               color: '#FF4981', iconUrl: '/icons/connectors/novu.svg',                         Icon: Bell },
  knock:              { label: 'Knock',              color: '#6C47FF', iconUrl: '/icons/connectors/knock.svg',                        Icon: Bell },
  ntfy:               { label: 'ntfy',               color: '#317F6E', iconUrl: '/icons/connectors/ntfy.svg',                         Icon: Bell },

  // â”€â”€ Automation Platforms â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  n8n:                { label: 'n8n',                color: '#EA4B71', iconUrl: '/icons/connectors/n8n.svg',                              Icon: Globe },
  zapier:             { label: 'Zapier',             color: '#FF4A00', iconUrl: '/icons/connectors/zapier.svg',                           Icon: Globe },
  github_actions:     { label: 'GitHub Actions',     color: '#2088FF', iconUrl: 'https://cdn.simpleicons.org/github/f0f0f0',             Icon: Github },

  // â”€â”€ Generic â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  http:               { label: 'HTTP / REST',        color: '#3B82F6', iconUrl: null,                                                   Icon: Globe },

  // â”€â”€ Built-in â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  'in-app-messaging': { label: 'In-app Messaging',   color: '#10B981', iconUrl: null,                                                   Icon: Bell },

  // â”€â”€ Desktop Apps â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  desktop_vscode:     { label: 'VS Code',            color: '#007ACC', iconUrl: '/icons/connectors/vscode.svg',                          Icon: MonitorCheck },
  desktop_docker:     { label: 'Docker',             color: '#2496ED', iconUrl: '/icons/connectors/docker.svg',                          Icon: HardDrive },
  desktop_terminal:   { label: 'Terminal',           color: '#4D4D4D', iconUrl: '/icons/connectors/terminal.svg',                        Icon: MonitorCheck },
  desktop_obsidian:   { label: 'Obsidian',           color: '#7C3AED', iconUrl: '/icons/connectors/obsidian.svg',                        Icon: FileText },
  desktop_browser:    { label: 'Browser',            color: '#4285F4', iconUrl: '/icons/connectors/chrome.svg',                          Icon: Globe },
};

export function getConnectorMeta(name: string): ConnectorMeta {
  if (!name) return { label: 'Unknown', color: '#6B7280', iconUrl: null, Icon: Plug };
  if (CONNECTOR_META[name]) return CONNECTOR_META[name];
  return { label: name, color: '#6B7280', iconUrl: null, Icon: Plug };
}

/**
 * Render a connector icon as a themed mask-image (local SVGs) or plain img (remote CDN).
 *
 * Local SVGs use `fill="currentColor"` so we render them via CSS `mask-image`
 * with `backgroundColor` set to the brand color â€” this keeps them readable on
 * any theme because the color never relies on the SVG's own fill.
 *
 * Shared across ConnectorMeta and vault components via `ThemedConnectorIcon`.
 */
const isLocalSvg = (url: string) => url.startsWith('/') && url.endsWith('.svg');

export function ThemedConnectorIcon({
  url,
  label,
  color,
  size = 'w-3.5 h-3.5',
  onError,
}: {
  url: string;
  label: string;
  color: string;
  size?: string;
  onError?: () => void;
}) {
  if (isLocalSvg(url)) {
    return (
      <span
        role="img"
        aria-label={label}
        className={`${size} inline-block shrink-0`}
        style={{
          maskImage: `url(${url})`,
          maskSize: 'contain',
          maskRepeat: 'no-repeat',
          maskPosition: 'center',
          WebkitMaskImage: `url(${url})`,
          WebkitMaskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          backgroundColor: color,
        }}
      />
    );
  }
  return (
    <img
      src={url}
      alt={label}
      className={size}
      onError={onError}
      referrerPolicy="no-referrer"
      crossOrigin="anonymous"
    />
  );
}

export function ConnectorIcon({ meta, size = 'w-3.5 h-3.5' }: { meta: ConnectorMeta; size?: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const FallbackIcon = meta.Icon;
  if (meta.iconUrl && !imgFailed) {
    return (
      <ThemedConnectorIcon
        url={meta.iconUrl}
        label={meta.label}
        color={meta.color}
        size={size}
        onError={() => setImgFailed(true)}
      />
    );
  }
  return <FallbackIcon className={size} style={{ color: meta.color }} />;
}
