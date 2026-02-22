# 100 Persona Templates — Multi-Workflow Replacements

Each template below is designed to **replace multiple n8n workflows** with a single intelligent persona. Instead of rigid node-to-node chains, each persona uses reasoning to handle branching logic, edge cases, and multi-service orchestration autonomously.

**Legend**
- **Replaces**: The n8n workflows this single persona eliminates
- **Tools**: Builtin tools the persona uses
- **Connectors**: 3rd-party services accessed via `http_request` + injected credentials
- **Triggers**: How the persona activates
- **Protocols**: Communication protocols used (user_message, persona_action, emit_event, agent_memory, manual_review, execution_flow)

---

## 1 — Gmail → Slack → Notion Intake Processor

Monitors Gmail for important emails, posts summaries to relevant Slack channels based on sender/topic, and creates structured Notion database entries for tracking. Learns sender patterns over time via agent memory.

**Replaces**: Gmail trigger → Filter → Slack post workflow, Gmail → Notion database insert workflow, Gmail → Label + archive workflow
**Tools**: `gmail_read`, `gmail_search`, `gmail_mark_read`, `http_request`
**Connectors**: Google Workspace, Slack (Bot Token), Notion (Integration Token)
**Triggers**: polling (60s)
**Protocols**: user_message (urgent alerts), agent_memory (sender patterns), execution_flow

---

## 2 — GitHub → Jira → Slack Dev Lifecycle Manager

Watches GitHub for new PRs, issues, and releases. Auto-creates/updates linked Jira tickets, posts status updates to Slack dev channels, and flags PRs that exceed size thresholds for manual review.

**Replaces**: GitHub webhook → Jira create issue workflow, GitHub PR → Slack notification workflow, GitHub release → Jira version update workflow, GitHub → stale issue closer workflow
**Tools**: `http_request`
**Connectors**: GitHub (PAT), Jira (API Token), Slack (Bot Token)
**Triggers**: polling (120s), webhook
**Protocols**: user_message, manual_review (large PRs), agent_memory (repo patterns)

---

## 3 — Stripe → Airtable → Gmail Revenue Operations Hub

Processes Stripe webhook events (new subscriptions, cancellations, failed payments, refunds), updates an Airtable revenue tracker, sends personalized customer emails for payment failures, and posts daily revenue summaries.

**Replaces**: Stripe webhook → email notification workflow, Stripe → Airtable sync workflow, Stripe failed payment → retry email workflow, Stripe → daily revenue report workflow
**Tools**: `http_request`, `gmail_send`
**Connectors**: Stripe (API Key), Airtable (PAT), Google Workspace
**Triggers**: webhook (Stripe events), schedule (daily 8am for summaries)
**Protocols**: user_message (revenue alerts), agent_memory (churn patterns), emit_event (payment_failed)

---

## 4 — Linear → GitHub → Slack Engineering Workflow Orchestrator

Syncs Linear issues with GitHub issues and branches. When a Linear ticket moves to "In Progress", creates a feature branch. When a PR is merged, moves the Linear ticket to "Done" and notifies the Slack channel. Generates weekly velocity reports.

**Replaces**: Linear → GitHub branch creation workflow, GitHub PR merged → Linear status update workflow, Linear → Slack notification workflow, Linear → weekly report workflow
**Tools**: `http_request`, `file_write`
**Connectors**: Linear (API Key), GitHub (PAT), Slack (Bot Token)
**Triggers**: polling (120s), schedule (weekly Friday)
**Protocols**: user_message, execution_flow, agent_memory (velocity trends)

---

## 5 — Shopify → Slack → Google Sheets E-Commerce Command Center

Monitors Shopify for new orders, low inventory, and refund requests. Logs all orders to Google Sheets, sends Slack alerts for high-value orders and stock warnings, and generates daily sales digests.

**Replaces**: Shopify new order → Slack workflow, Shopify → Google Sheets order log workflow, Shopify low inventory → alert workflow, Shopify → daily sales report workflow, Shopify refund → notification workflow
**Tools**: `http_request`, `file_write`
**Connectors**: Shopify (Admin API Token), Slack (Bot Token), Google Sheets (Service Account)
**Triggers**: polling (60s), schedule (daily 9pm)
**Protocols**: user_message (stock alerts), agent_memory (best sellers, seasonal trends)

---

## 6 — Zendesk → Slack → Notion Support Intelligence Use Case

Triages incoming Zendesk tickets by analyzing content and sentiment. Routes urgent issues to Slack with context. Maintains a Notion knowledge base of common resolutions. Auto-suggests responses for known issues and escalates unknowns for manual review.

**Replaces**: Zendesk → Slack alert workflow, Zendesk → auto-tag workflow, Zendesk → SLA breach notification workflow, Zendesk → knowledge base lookup workflow
**Tools**: `http_request`
**Connectors**: Zendesk (API Token), Slack (Bot Token), Notion (Integration Token)
**Triggers**: polling (60s)
**Protocols**: user_message, manual_review (escalations), agent_memory (resolution patterns)

---

## 7 — HubSpot → Gmail → Slack Sales Pipeline Autopilot

Monitors HubSpot deal stage changes, sends personalized follow-up emails via Gmail at each stage, posts deal updates to Slack sales channels, and flags stale deals. Compiles weekly pipeline health reports.

**Replaces**: HubSpot deal stage → email sequence workflow, HubSpot → Slack deal notification workflow, HubSpot → stale deal reminder workflow, HubSpot → weekly pipeline report workflow
**Tools**: `http_request`, `gmail_send`, `gmail_search`, `file_write`
**Connectors**: HubSpot (API Key), Google Workspace, Slack (Bot Token)
**Triggers**: polling (300s), schedule (weekly Monday)
**Protocols**: user_message, agent_memory (deal history), emit_event (deal_won, deal_lost)

---

## 8 — Notion → Todoist → Slack Weekly Planning Automator

Reads your Notion project database every Monday, creates prioritized Todoist tasks from upcoming items, posts a weekly plan summary to Slack, and archives completed items in Notion at week's end.

**Replaces**: Notion → Todoist sync workflow, Notion → Slack weekly plan workflow, Todoist completed → Notion archive workflow
**Tools**: `http_request`
**Connectors**: Notion (Integration Token), Todoist (API Token), Slack (Bot Token)
**Triggers**: schedule (Monday 7am, Friday 5pm)
**Protocols**: user_message, agent_memory (task completion patterns)

---

## 9 — Intercom → Slack → Linear Customer Feedback Router

Captures new Intercom conversations, extracts feature requests and bug reports, creates Linear issues with proper labels, and posts a Slack summary. Deduplicates against existing Linear issues using agent memory.

**Replaces**: Intercom → Slack notification workflow, Intercom → Linear issue creation workflow, Intercom tag → route workflow, Intercom → weekly feedback digest workflow
**Tools**: `http_request`
**Connectors**: Intercom (Access Token), Slack (Bot Token), Linear (API Key)
**Triggers**: polling (120s), schedule (weekly Friday for digest)
**Protocols**: user_message, agent_memory (known issues), manual_review (ambiguous requests)

---

## 10 — Google Calendar → Gmail → Slack Meeting Lifecycle Manager

Monitors your Google Calendar for upcoming meetings. Sends prep reminders with agenda and attendee context 30 min before. Posts "in meeting" status to Slack. After meetings, prompts for notes and distributes action items via email.

**Replaces**: Calendar → reminder email workflow, Calendar → Slack status workflow, Calendar → meeting notes template workflow, Calendar → follow-up email workflow
**Tools**: `http_request`, `gmail_send`, `gmail_read`
**Connectors**: Google Calendar (OAuth), Google Workspace, Slack (Bot Token)
**Triggers**: polling (300s), schedule (every 15min during work hours)
**Protocols**: user_message (prep reminders), manual_review (confirm action items)

---

## 11 — Typeform → Airtable → Gmail → Slack Lead Capture Pipeline

Processes Typeform submissions in real-time, scores leads based on responses, adds them to Airtable with qualification status, sends personalized welcome emails, and notifies the sales team in Slack for hot leads.

**Replaces**: Typeform → Airtable insert workflow, Typeform → email autoresponder workflow, Typeform → Slack notification workflow, Typeform → lead scoring workflow
**Tools**: `http_request`, `gmail_send`
**Connectors**: Typeform (PAT), Airtable (PAT), Google Workspace, Slack (Bot Token)
**Triggers**: webhook (Typeform), polling (120s)
**Protocols**: user_message (hot leads), agent_memory (conversion patterns), emit_event (new_qualified_lead)

---

## 12 — Sentry → GitHub → Slack Error Response Coordinator

Receives Sentry error alerts, deduplicates and groups by root cause, creates GitHub issues with stack traces and reproduction context, and posts actionable summaries to Slack. Tracks recurring errors via memory.

**Replaces**: Sentry → Slack alert workflow, Sentry → GitHub issue workflow, Sentry → error grouping workflow, Sentry → weekly error report workflow
**Tools**: `http_request`
**Connectors**: Sentry (Auth Token), GitHub (PAT), Slack (Bot Token)
**Triggers**: webhook (Sentry), schedule (weekly for report)
**Protocols**: user_message (critical errors), agent_memory (known issues), execution_flow

---

## 13 — Confluence → Slack → Gmail Documentation Freshness Guardian

Scans Confluence pages for staleness (no edits in N days), checks if referenced APIs or tools still exist, notifies page owners via email, and posts a Slack digest of stale docs. Tracks update promises in memory.

**Replaces**: Confluence → stale page finder workflow, Confluence → owner notification workflow, Confluence → Slack digest workflow
**Tools**: `http_request`, `gmail_send`
**Connectors**: Confluence (API Token), Google Workspace, Slack (Bot Token)
**Triggers**: schedule (weekly Wednesday)
**Protocols**: user_message, agent_memory (owner commitments), manual_review (pages to archive)

---

## 14 — Datadog → PagerDuty → Slack Incident Commander

Ingests Datadog alerts via webhook, assesses severity using alert context and historical patterns, creates PagerDuty incidents for critical issues, posts status threads in Slack, and maintains an incident timeline. Auto-resolves alerts that self-heal.

**Replaces**: Datadog → PagerDuty workflow, Datadog → Slack alert workflow, PagerDuty → Slack status workflow, Alert → auto-resolve workflow, Incident → timeline log workflow
**Tools**: `http_request`
**Connectors**: Datadog (API + App Key), PagerDuty (API Key), Slack (Bot Token)
**Triggers**: webhook (Datadog)
**Protocols**: user_message (critical incidents), agent_memory (incident patterns), execution_flow, emit_event (incident_opened, incident_resolved)

---

## 15 — Figma → Linear → Slack Design Handoff Coordinator

Monitors Figma file version changes, extracts updated component names, creates or updates Linear tickets for the dev team with direct Figma links, and posts handoff summaries in the design Slack channel.

**Replaces**: Figma webhook → Linear task workflow, Figma → Slack notification workflow, Figma version → changelog workflow
**Tools**: `http_request`
**Connectors**: Figma (PAT), Linear (API Key), Slack (Bot Token)
**Triggers**: webhook (Figma), polling (600s)
**Protocols**: user_message, execution_flow

---

## 16 — Calendly → HubSpot → Gmail → Slack Appointment Orchestrator

Processes new Calendly bookings, creates/updates HubSpot contacts and deals, sends confirmation emails with custom prep materials, and notifies the team in Slack. Sends reminders 24h before and follow-ups 24h after.

**Replaces**: Calendly → HubSpot contact workflow, Calendly → confirmation email workflow, Calendly → Slack notification workflow, Calendly → reminder workflow, Calendly → follow-up workflow
**Tools**: `http_request`, `gmail_send`
**Connectors**: Calendly (PAT), HubSpot (API Key), Google Workspace, Slack (Bot Token)
**Triggers**: webhook (Calendly), schedule (daily for reminders/follow-ups)
**Protocols**: user_message, agent_memory (meeting history per contact)

---

## 17 — AWS CloudWatch → Slack → Jira Infrastructure Health Use Case

Monitors CloudWatch metrics and alarms, posts infrastructure health summaries to Slack, creates Jira ops tickets for persistent issues, and tracks cost anomalies. Compiles weekly infrastructure health reports.

**Replaces**: CloudWatch alarm → Slack workflow, CloudWatch → Jira ticket workflow, AWS cost → anomaly alert workflow, CloudWatch → weekly health report workflow
**Tools**: `http_request`, `file_write`
**Connectors**: AWS (Access Key + Secret), Slack (Bot Token), Jira (API Token)
**Triggers**: polling (120s), schedule (weekly Monday)
**Protocols**: user_message, agent_memory (baseline metrics), manual_review (cost spikes)

---

## 18 — Mailchimp → Airtable → Slack Campaign Performance Analyst

After each Mailchimp campaign send, pulls open/click stats over 24h and 72h windows, updates Airtable tracking sheet, compares against historical benchmarks stored in memory, and posts performance cards to Slack.

**Replaces**: Mailchimp → stats webhook workflow, Mailchimp → Airtable log workflow, Mailchimp → Slack results workflow, Mailchimp → benchmark comparison workflow
**Tools**: `http_request`
**Connectors**: Mailchimp (API Key), Airtable (PAT), Slack (Bot Token)
**Triggers**: schedule (daily, checking for recent sends)
**Protocols**: user_message, agent_memory (campaign benchmarks)

---

## 19 — Twilio → Airtable → Slack SMS Ops Manager

Receives inbound Twilio SMS via webhook, logs conversations to Airtable, classifies message intent (support, sales, opt-out), routes to Slack channels by type, and sends auto-replies for common requests. Handles opt-out compliance.

**Replaces**: Twilio → Slack notification workflow, Twilio → Airtable log workflow, Twilio → auto-reply workflow, Twilio → opt-out handler workflow
**Tools**: `http_request`
**Connectors**: Twilio (Account SID + Auth Token), Airtable (PAT), Slack (Bot Token)
**Triggers**: webhook (Twilio)
**Protocols**: user_message, agent_memory (conversation context), manual_review (escalations)

---

## 20 — QuickBooks → Google Sheets → Gmail → Slack Finance Controller

Syncs QuickBooks invoices and expenses to Google Sheets daily, detects overdue invoices and sends payment reminders via Gmail, flags unusual transactions for review, and posts weekly cash flow summaries to Slack.

**Replaces**: QuickBooks → Google Sheets sync workflow, QuickBooks → overdue reminder email workflow, QuickBooks → Slack summary workflow, QuickBooks → anomaly detection workflow
**Tools**: `http_request`, `gmail_send`, `file_write`
**Connectors**: QuickBooks (OAuth), Google Sheets (Service Account), Google Workspace, Slack (Bot Token)
**Triggers**: schedule (daily 7am), polling (600s for overdue checks)
**Protocols**: user_message (anomalies), agent_memory (spending patterns), manual_review (large transactions)

---

## 21 — WordPress → Buffer → Google Analytics Content Distribution Use Case

Detects new WordPress posts via the REST API, auto-schedules social media posts to Buffer with platform-optimized captions, checks Google Analytics performance after 48h, and adjusts future posting strategy based on engagement data.

**Replaces**: WordPress → Buffer schedule workflow, WordPress → social media workflow, GA → performance report workflow, Content → A/B caption testing workflow
**Tools**: `http_request`, `file_write`
**Connectors**: WordPress (App Password), Buffer (Access Token), Google Analytics (OAuth)
**Triggers**: polling (300s), schedule (daily for analytics review)
**Protocols**: agent_memory (engagement patterns), user_message (viral alerts)

---

## 22 — Trello → Google Calendar → Slack Deadline Synchronizer

Watches Trello boards for cards with due dates, creates/updates Google Calendar events for each, sends Slack reminders as deadlines approach, and moves overdue cards to a "Blocked" list with a comment explaining the delay.

**Replaces**: Trello → Google Calendar sync workflow, Trello → Slack deadline reminder workflow, Trello → overdue handler workflow
**Tools**: `http_request`
**Connectors**: Trello (API Key + Token), Google Calendar (OAuth), Slack (Bot Token)
**Triggers**: polling (300s)
**Protocols**: user_message (deadline warnings), agent_memory (recurring late patterns)

---

## 23 — Greenhouse → Gmail → Slack Recruiting Pipeline Use Case

Monitors Greenhouse for candidate stage transitions, sends personalized emails at each stage (acknowledgment, interview prep, rejection, offer), posts updates to hiring Slack channels, and compiles weekly recruiting funnel metrics.

**Replaces**: Greenhouse → email at each stage workflow (×5), Greenhouse → Slack notification workflow, Greenhouse → weekly funnel report workflow
**Tools**: `http_request`, `gmail_send`, `file_write`
**Connectors**: Greenhouse (API Key), Google Workspace, Slack (Bot Token)
**Triggers**: polling (300s), schedule (weekly Monday)
**Protocols**: user_message, agent_memory (hiring velocity), manual_review (offer approvals)

---

## 24 — Supabase → Slack → Gmail Real-Time Database Watcher

Subscribes to Supabase database webhooks for specific table changes (new users, order updates, flag changes). Posts enriched notifications to Slack, triggers welcome email sequences for new signups, and logs anomalous data patterns.

**Replaces**: Supabase → Slack new user workflow, Supabase → welcome email workflow, Supabase → data change notification workflow, Supabase → anomaly detection workflow
**Tools**: `http_request`, `gmail_send`
**Connectors**: Supabase (Service Role Key), Slack (Bot Token), Google Workspace
**Triggers**: webhook (Supabase)
**Protocols**: user_message, agent_memory (user patterns), emit_event (new_signup, anomaly_detected)

---

## 25 — Notion → Gmail → Slack Content Approval Workflow

Monitors a Notion "Ready for Review" database view. When items appear, emails the assigned reviewer, posts to a Slack approval channel with action context, and waits for approval. On approval, moves the item to "Published" and notifies the author.

**Replaces**: Notion → reviewer email workflow, Notion → Slack approval workflow, Notion → status update on approval workflow, Notion → author notification workflow
**Tools**: `http_request`, `gmail_send`, `gmail_read`
**Connectors**: Notion (Integration Token), Google Workspace, Slack (Bot Token)
**Triggers**: polling (120s)
**Protocols**: manual_review (approval gate), user_message, execution_flow

---

## 26 — Vercel → GitHub → Slack Deployment Guardian

Monitors Vercel deployment webhooks, checks build logs for warnings and errors, cross-references with the GitHub commit that triggered the deploy, and posts deployment status cards to Slack. Auto-rolls back if error rate spikes post-deploy.

**Replaces**: Vercel → Slack deploy notification workflow, Vercel → error check workflow, Vercel → GitHub status update workflow, Vercel → rollback trigger workflow
**Tools**: `http_request`
**Connectors**: Vercel (Token), GitHub (PAT), Slack (Bot Token)
**Triggers**: webhook (Vercel)
**Protocols**: user_message (deploy alerts), agent_memory (deploy history), manual_review (rollback approval)

---

## 27 — Mixpanel → Slack → Notion Product Analytics Briefer

Pulls key Mixpanel metrics daily, compares against goals and historical trends, generates plain-English insights, posts a morning analytics briefing to Slack, and maintains a Notion analytics log for longitudinal tracking.

**Replaces**: Mixpanel → Slack daily metrics workflow, Mixpanel → Notion log workflow, Mixpanel → goal tracking workflow, Mixpanel → anomaly alert workflow
**Tools**: `http_request`
**Connectors**: Mixpanel (Service Account), Slack (Bot Token), Notion (Integration Token)
**Triggers**: schedule (daily 8am)
**Protocols**: user_message (metric anomalies), agent_memory (trend baselines)

---

## 28 — Asana → GitHub → Slack Cross-Platform Task Synchronizer

Keeps Asana tasks and GitHub issues in bidirectional sync. Status changes in either platform propagate to the other. Posts Slack summaries when tasks move between phases. Resolves sync conflicts intelligently using last-write-wins with human escalation.

**Replaces**: Asana → GitHub sync workflow, GitHub → Asana sync workflow, Asana → Slack notification workflow, Sync conflict → resolution workflow
**Tools**: `http_request`
**Connectors**: Asana (PAT), GitHub (PAT), Slack (Bot Token)
**Triggers**: polling (120s)
**Protocols**: agent_memory (sync state), manual_review (conflicts), user_message

---

## 29 — SendGrid → Airtable → Slack Email Deliverability Monitor

Processes SendGrid event webhooks (bounces, spam reports, unsubscribes, opens), maintains an Airtable deliverability dashboard, posts Slack alerts for bounce rate spikes, and auto-suppresses problematic addresses.

**Replaces**: SendGrid → bounce handler workflow, SendGrid → Airtable log workflow, SendGrid → Slack alert workflow, SendGrid → suppression list workflow, SendGrid → weekly deliverability report workflow
**Tools**: `http_request`
**Connectors**: SendGrid (API Key), Airtable (PAT), Slack (Bot Token)
**Triggers**: webhook (SendGrid events), schedule (weekly for report)
**Protocols**: user_message, agent_memory (deliverability baselines)

---

## 30 — Postgres → Slack → Gmail Database Health Sentinel

Connects to a Postgres instance via HTTP proxy, runs health queries (table sizes, slow queries, connection counts, replication lag), sends Slack alerts on anomalies, and emails a weekly DBA report.

**Replaces**: DB → slow query alert workflow, DB → disk usage monitor workflow, DB → replication check workflow, DB → weekly health report workflow
**Tools**: `http_request`, `gmail_send`, `file_write`
**Connectors**: Database HTTP Proxy (API Key), Slack (Bot Token), Google Workspace
**Triggers**: polling (300s), schedule (weekly Monday)
**Protocols**: user_message (critical alerts), agent_memory (baseline metrics)

---

## 31 — Clerk → Supabase → Slack → Gmail User Lifecycle Manager

Handles Clerk auth events (signup, email change, deletion), provisions user records in Supabase, sends onboarding email sequences via Gmail, and posts new user celebrations to Slack. Handles the full user lifecycle from sign-up to churn.

**Replaces**: Clerk signup → DB insert workflow, Clerk → welcome email workflow, Clerk → Slack notification workflow, Clerk deletion → cleanup workflow, User → onboarding sequence workflow
**Tools**: `http_request`, `gmail_send`
**Connectors**: Clerk (Secret Key), Supabase (Service Role Key), Slack (Bot Token), Google Workspace
**Triggers**: webhook (Clerk)
**Protocols**: user_message, agent_memory (user cohort data), emit_event (user_created, user_churned)

---

## 32 — ClickUp → GitHub → Gmail Sprint Automation Use Case

At sprint start, reads the ClickUp sprint backlog, creates GitHub tracking issues with labels, and emails the sprint plan to stakeholders. During the sprint, syncs status changes. At sprint end, generates a summary report and archives completed items.

**Replaces**: ClickUp → GitHub issue sync workflow, ClickUp → sprint kickoff email workflow, ClickUp → sprint close report workflow, ClickUp ↔ GitHub bidirectional status sync workflow
**Tools**: `http_request`, `gmail_send`, `file_write`
**Connectors**: ClickUp (API Token), GitHub (PAT), Google Workspace
**Triggers**: schedule (sprint boundaries), polling (300s during sprint)
**Protocols**: user_message, execution_flow, agent_memory (sprint metrics)

---

## 33 — CircleCI → Slack → GitHub Build Intelligence Use Case

Monitors CircleCI pipeline events, analyzes failed build logs to identify root causes, posts enriched Slack messages (not just "build failed" but "failed because X in file Y"), and comments on the GitHub PR with fix suggestions. Tracks flaky test patterns.

**Replaces**: CircleCI → Slack notification workflow, CircleCI → GitHub status workflow, CircleCI → failure analysis workflow, CircleCI → flaky test tracker workflow
**Tools**: `http_request`
**Connectors**: CircleCI (API Token), Slack (Bot Token), GitHub (PAT)
**Triggers**: webhook (CircleCI)
**Protocols**: user_message, agent_memory (flaky tests, common failures)

---

## 34 — Notion → Airtable → Gmail Editorial Calendar Manager

Reads the Notion editorial calendar, syncs deadlines and assignments to Airtable for tracking, sends reminder emails to writers approaching deadlines, posts status reports, and flags content gaps in the schedule.

**Replaces**: Notion → Airtable sync workflow, Notion → deadline reminder email workflow, Notion → content gap analysis workflow, Editorial → weekly status report workflow
**Tools**: `http_request`, `gmail_send`, `file_write`
**Connectors**: Notion (Integration Token), Airtable (PAT), Google Workspace
**Triggers**: schedule (daily 8am), polling (600s)
**Protocols**: user_message, agent_memory (writer reliability patterns)

---

## 35 — Plaid → Google Sheets → Slack → Gmail Personal Finance Use Case

Connects to bank accounts via Plaid, categorizes transactions, logs them to Google Sheets, sends weekly spending summaries to Slack/email, and alerts on unusual charges or when budget categories are exceeded.

**Replaces**: Plaid → Google Sheets transaction log workflow, Plaid → budget alert workflow, Plaid → weekly spending report workflow, Plaid → unusual transaction alert workflow
**Tools**: `http_request`, `gmail_send`, `file_write`
**Connectors**: Plaid (Client ID + Secret), Google Sheets (Service Account), Slack (Bot Token), Google Workspace
**Triggers**: schedule (daily), polling (3600s)
**Protocols**: user_message (budget alerts), agent_memory (spending patterns, merchant categories)

---

## 36 — Webflow → Slack → Airtable CMS Sync Use Case

Watches for Webflow CMS collection changes, syncs content to an Airtable backup/analytics table, posts Slack notifications for published content, and validates that published pages have required SEO fields populated.

**Replaces**: Webflow → Airtable sync workflow, Webflow → Slack publish notification workflow, Webflow → SEO validation workflow
**Tools**: `http_request`
**Connectors**: Webflow (API Token), Airtable (PAT), Slack (Bot Token)
**Triggers**: webhook (Webflow), polling (600s)
**Protocols**: user_message (SEO gaps), manual_review (missing metadata)

---

## 37 — Freshdesk → Slack → Notion → Gmail Support Escalation Engine

Monitors Freshdesk for tickets exceeding response time SLAs, escalates to Slack with full ticket context, logs escalation patterns in Notion, and emails the support lead with a daily escalation summary. Auto-prioritizes based on customer tier.

**Replaces**: Freshdesk → SLA breach alert workflow, Freshdesk → Slack escalation workflow, Freshdesk → escalation log workflow, Freshdesk → daily escalation report email workflow
**Tools**: `http_request`, `gmail_send`
**Connectors**: Freshdesk (API Key), Slack (Bot Token), Notion (Integration Token), Google Workspace
**Triggers**: polling (120s), schedule (daily 6pm for summary)
**Protocols**: user_message, agent_memory (customer tier info, SLA patterns)

---

## 38 — Loom → Notion → Slack Video Knowledge Base Builder

Detects new Loom recordings shared via webhook, transcribes key points using the Loom API, creates structured Notion pages with timestamps and summaries, and posts the video with summary to relevant Slack channels.

**Replaces**: Loom → Notion page creation workflow, Loom → Slack notification workflow, Loom → transcript extraction workflow
**Tools**: `http_request`
**Connectors**: Loom (Developer Token), Notion (Integration Token), Slack (Bot Token)
**Triggers**: webhook (Loom)
**Protocols**: user_message, agent_memory (topic taxonomy)

---

## 39 — GitLab → Slack → Gmail → Jira CI/CD Pipeline Manager

Manages the full GitLab CI/CD lifecycle: monitors pipeline status, posts Slack updates per stage, creates Jira deploy tickets for production releases, emails release notes to stakeholders, and tracks deployment frequency metrics.

**Replaces**: GitLab → Slack pipeline notification workflow, GitLab → Jira deploy ticket workflow, GitLab → release notes email workflow, GitLab → deployment frequency tracker workflow
**Tools**: `http_request`, `gmail_send`, `file_write`
**Connectors**: GitLab (PAT), Slack (Bot Token), Google Workspace, Jira (API Token)
**Triggers**: webhook (GitLab), schedule (weekly for metrics)
**Protocols**: user_message, agent_memory (deploy frequency), execution_flow

---

## 40 — Slack → Notion → Gmail Team Decision Logger

Monitors Slack channels for messages tagged with a specific emoji or keyword (e.g., 📋 or /decision), extracts the decision context, creates a structured Notion decision log entry, and emails stakeholders a weekly decisions digest.

**Replaces**: Slack reaction → Notion log workflow, Slack → decision capture workflow, Decision log → weekly email digest workflow
**Tools**: `http_request`, `gmail_send`
**Connectors**: Slack (Bot Token), Notion (Integration Token), Google Workspace
**Triggers**: polling (120s), schedule (weekly Friday)
**Protocols**: user_message, agent_memory (decision patterns)

---

## 41 — Paddle → Airtable → Slack → Gmail Subscription Billing Use Case

Processes Paddle subscription events (new, renewal, cancellation, payment failure), maintains customer records in Airtable, sends dunning emails for failed payments, posts revenue events to Slack, and generates monthly MRR reports.

**Replaces**: Paddle → Airtable customer sync workflow, Paddle → dunning email workflow, Paddle → Slack revenue notification workflow, Paddle → MRR report workflow
**Tools**: `http_request`, `gmail_send`, `file_write`
**Connectors**: Paddle (API Key), Airtable (PAT), Slack (Bot Token), Google Workspace
**Triggers**: webhook (Paddle), schedule (monthly 1st)
**Protocols**: user_message, agent_memory (churn signals), emit_event (mrr_change)

---

## 42 — Cloudflare → Slack → PagerDuty Edge Security Monitor

Monitors Cloudflare analytics and firewall events for DDoS attempts, bot surges, and WAF triggers. Posts real-time security alerts to Slack, escalates critical events to PagerDuty, and generates daily security posture reports.

**Replaces**: Cloudflare → Slack alert workflow, Cloudflare → PagerDuty escalation workflow, Cloudflare → daily security report workflow, Cloudflare → DDoS detection workflow
**Tools**: `http_request`, `file_write`
**Connectors**: Cloudflare (API Token), Slack (Bot Token), PagerDuty (API Key)
**Triggers**: polling (60s), schedule (daily)
**Protocols**: user_message (attack alerts), agent_memory (traffic baselines), emit_event (security_incident)

---

## 43 — DocuSign → Airtable → Slack → Gmail Contract Lifecycle Use Case

Tracks DocuSign envelope events (sent, viewed, signed, declined), updates Airtable contract tracker, posts Slack notifications on status changes, sends reminder emails for unsigned documents, and flags contracts approaching renewal.

**Replaces**: DocuSign → Airtable sync workflow, DocuSign → Slack notification workflow, DocuSign → reminder email workflow, DocuSign → renewal alert workflow
**Tools**: `http_request`, `gmail_send`
**Connectors**: DocuSign (OAuth), Airtable (PAT), Slack (Bot Token), Google Workspace
**Triggers**: webhook (DocuSign), schedule (daily for renewal checks)
**Protocols**: user_message, agent_memory (signer response times), manual_review (declined contracts)

---

## 44 — OpenAI → Notion → Slack AI Cost & Usage Monitor

Polls the OpenAI usage API for daily token consumption and costs, logs entries to a Notion tracking database, compares against budget thresholds, and posts Slack alerts when spending exceeds limits. Generates monthly usage optimization recommendations.

**Replaces**: OpenAI → cost alert workflow, OpenAI → Notion usage log workflow, OpenAI → budget threshold workflow, OpenAI → monthly report workflow
**Tools**: `http_request`
**Connectors**: OpenAI (API Key), Notion (Integration Token), Slack (Bot Token)
**Triggers**: schedule (daily 7am), schedule (monthly 1st for report)
**Protocols**: user_message (budget alerts), agent_memory (usage trends)

---

## 45 — Posthog → Slack → Linear Feature Flag & Experiment Analyst

Monitors PostHog feature flag changes and experiment results, posts summaries to Slack product channels, creates Linear follow-up tickets for winning experiment variants, and archives flags that haven't been modified in 30+ days.

**Replaces**: PostHog → Slack experiment results workflow, PostHog → Linear task workflow, PostHog → stale flag cleanup workflow
**Tools**: `http_request`
**Connectors**: PostHog (API Key), Slack (Bot Token), Linear (API Key)
**Triggers**: schedule (daily), polling (600s)
**Protocols**: user_message, agent_memory (experiment history)

---

## 46 — RSS → Notion → Gmail → Slack Industry Intelligence Aggregator

Fetches multiple RSS feeds (industry blogs, competitors, news), extracts and deduplicates articles, creates structured Notion entries with AI-generated summaries, emails a daily intelligence briefing, and posts breaking news to Slack.

**Replaces**: RSS → email digest workflow, RSS → Notion database workflow, RSS → Slack notification workflow, RSS → deduplication workflow, Multiple separate RSS monitor workflows
**Tools**: `http_request`, `gmail_send`
**Connectors**: Notion (Integration Token), Google Workspace, Slack (Bot Token)
**Triggers**: schedule (daily 7am), polling (1800s for breaking news)
**Protocols**: user_message (breaking news), agent_memory (seen articles, topic taxonomy)

---

## 47 — Zapier Webhook → Multi-Service Router

Acts as a universal webhook receiver that replaces Zapier entirely for simple automations. Accepts any webhook payload, uses AI reasoning to classify the event type, and routes to the appropriate service (Slack, email, Notion, Airtable, etc.) based on configurable rules.

**Replaces**: Any single-trigger Zapier zap, Webhook → conditional routing workflows, Webhook → multi-destination fan-out workflows
**Tools**: `http_request`, `gmail_send`, `file_write`
**Connectors**: Slack (Bot Token), Notion (Integration Token), Airtable (PAT), Google Workspace
**Triggers**: webhook
**Protocols**: user_message, agent_memory (routing rules), execution_flow

---

## 48 — Jira → Confluence → Slack Sprint Documentation Use Case

At sprint close, reads all completed Jira issues, generates a structured Confluence sprint review page with acceptance criteria, screenshots links, and metrics. Posts the review link to Slack and archives the sprint board.

**Replaces**: Jira → Confluence sprint review workflow, Jira → sprint metrics workflow, Jira → Slack sprint close notification workflow
**Tools**: `http_request`
**Connectors**: Jira (API Token), Confluence (API Token), Slack (Bot Token)
**Triggers**: schedule (bi-weekly sprint boundary), manual
**Protocols**: user_message, execution_flow, agent_memory (sprint velocity)

---

## 49 — Algolia → Slack → Notion Search Quality Monitor

Monitors Algolia search analytics for zero-result queries, low-click-through searches, and trending search terms. Posts weekly search quality reports to Slack, creates Notion tickets for content gaps, and suggests index tuning.

**Replaces**: Algolia → zero results alert workflow, Algolia → Slack analytics workflow, Algolia → content gap tracker workflow
**Tools**: `http_request`
**Connectors**: Algolia (Admin API Key), Slack (Bot Token), Notion (Integration Token)
**Triggers**: schedule (daily)
**Protocols**: user_message, agent_memory (search trends)

---

## 50 — Monday.com → Slack → Gmail → Google Sheets Project Portfolio Manager

Monitors multiple Monday.com boards for status changes, aggregates cross-project health into a Google Sheets dashboard, sends executive summary emails weekly, and posts real-time alerts to Slack for blocked or at-risk items.

**Replaces**: Monday.com → Slack notification workflow, Monday.com → Google Sheets sync workflow, Monday.com → executive report email workflow, Monday.com → blocked item alert workflow
**Tools**: `http_request`, `gmail_send`, `file_write`
**Connectors**: Monday.com (API Token), Slack (Bot Token), Google Sheets (Service Account), Google Workspace
**Triggers**: polling (300s), schedule (weekly Monday)
**Protocols**: user_message, agent_memory (project health trends), manual_review (at-risk projects)

---

## 51 — Amplitude → Slack → Linear Product Signal Detector

Analyzes Amplitude user behavior data for significant changes (drop-offs, feature adoption spikes, funnel breakages), posts insight cards to Slack product channels, and auto-creates Linear investigation tickets for anomalies.

**Replaces**: Amplitude → Slack alert workflow, Amplitude → issue tracker workflow, Amplitude → funnel analysis workflow
**Tools**: `http_request`
**Connectors**: Amplitude (API Key), Slack (Bot Token), Linear (API Key)
**Triggers**: schedule (daily 9am)
**Protocols**: user_message, agent_memory (behavioral baselines)

---

## 52 — Airtable → Mailchimp → Slack Marketing Audience Sync Use Case

Monitors Airtable contact records for tag or segment changes, syncs audiences to Mailchimp lists, triggers targeted campaigns for new segments, and posts sync status to Slack. Handles unsubscribes bidirectionally.

**Replaces**: Airtable → Mailchimp list sync workflow, Airtable → campaign trigger workflow, Mailchimp unsubscribe → Airtable update workflow, Sync → Slack status workflow
**Tools**: `http_request`
**Connectors**: Airtable (PAT), Mailchimp (API Key), Slack (Bot Token)
**Triggers**: polling (300s)
**Protocols**: user_message, agent_memory (segment definitions)

---

## 53 — Notion → GitHub Pages → Slack Documentation Publisher

Watches a Notion database for pages marked "Ready to Publish", converts content to Markdown, commits to a GitHub Pages repository, triggers a rebuild, and posts the live URL to Slack. Handles image uploads and link resolution.

**Replaces**: Notion → Markdown conversion workflow, Notion → GitHub commit workflow, GitHub → deploy trigger workflow, Deploy → Slack notification workflow
**Tools**: `http_request`
**Connectors**: Notion (Integration Token), GitHub (PAT), Slack (Bot Token)
**Triggers**: polling (300s)
**Protocols**: user_message, execution_flow

---

## 54 — Xero → Google Sheets → Slack → Gmail Accounting Reconciliation Use Case

Pulls Xero transactions daily, reconciles against bank feeds, logs discrepancies to Google Sheets, sends Slack alerts for unmatched transactions, and emails a weekly reconciliation summary to the finance team.

**Replaces**: Xero → Google Sheets sync workflow, Xero → reconciliation check workflow, Xero → Slack alert workflow, Xero → weekly report email workflow
**Tools**: `http_request`, `gmail_send`, `file_write`
**Connectors**: Xero (OAuth), Google Sheets (Service Account), Slack (Bot Token), Google Workspace
**Triggers**: schedule (daily 6am)
**Protocols**: user_message, agent_memory (recurring transactions), manual_review (large discrepancies)

---

## 55 — Telegram → Notion → Airtable Personal Capture Bot

Receives messages from your Telegram bot (ideas, bookmarks, tasks, notes), classifies them by type using AI, routes tasks to Airtable, saves notes/ideas to Notion, and sends a confirmation reply. Compiles a daily capture digest.

**Replaces**: Telegram → Notion quick capture workflow, Telegram → Airtable task creation workflow, Telegram → classification + routing workflow, Daily capture → digest workflow
**Tools**: `http_request`
**Connectors**: Telegram (Bot Token), Notion (Integration Token), Airtable (PAT)
**Triggers**: polling (30s)
**Protocols**: user_message (daily digest), agent_memory (capture categories)

---

## 56 — Google Ads → Google Sheets → Slack → Gmail Ad Campaign Optimizer

Pulls Google Ads campaign performance data, logs to Google Sheets, identifies underperforming ad groups, sends optimization recommendations to Slack, and emails a weekly performance report. Pauses ads that exceed cost-per-conversion thresholds.

**Replaces**: Google Ads → Google Sheets report workflow, Google Ads → Slack performance alert workflow, Google Ads → pause underperformers workflow, Google Ads → weekly report email workflow
**Tools**: `http_request`, `gmail_send`, `file_write`
**Connectors**: Google Ads (OAuth), Google Sheets (Service Account), Slack (Bot Token), Google Workspace
**Triggers**: schedule (daily), schedule (weekly for full report)
**Protocols**: user_message, agent_memory (performance benchmarks), manual_review (budget changes)

---

## 57 — Pipedrive → Gmail → Slack → Google Sheets Sales CRM Autopilot

Monitors Pipedrive deal movements, sends staged email sequences at each pipeline phase, posts deal wins/losses to Slack, and maintains a Google Sheets forecast model. Detects ghosted deals and triggers re-engagement.

**Replaces**: Pipedrive → email sequence workflows (×5 stages), Pipedrive → Slack deal notification workflow, Pipedrive → Google Sheets forecast workflow, Pipedrive → stale deal handler workflow
**Tools**: `http_request`, `gmail_send`, `file_write`
**Connectors**: Pipedrive (API Token), Google Workspace, Slack (Bot Token), Google Sheets (Service Account)
**Triggers**: polling (300s), schedule (weekly for forecasting)
**Protocols**: user_message, agent_memory (deal patterns), emit_event (deal_won, deal_lost)

---

## 58 — Coda → Slack → Gmail Operational Playbook Executor

Reads operational playbook steps from Coda documents, monitors for trigger conditions, executes checklist items sequentially, posts progress to Slack, and emails completion summaries. Handles branching logic based on step outcomes.

**Replaces**: Coda → Slack checklist notification workflow, Coda → conditional step execution workflow, Checklist → email summary workflow
**Tools**: `http_request`, `gmail_send`
**Connectors**: Coda (API Token), Slack (Bot Token), Google Workspace
**Triggers**: schedule (configurable), manual
**Protocols**: user_message, execution_flow, manual_review (approval steps)

---

## 59 — Contentful → Algolia → Slack CMS Index Sync Use Case

Watches Contentful webhooks for content publish/unpublish events, updates the Algolia search index accordingly, validates index consistency daily, and posts sync status to Slack. Handles partial failures with retry logic.

**Replaces**: Contentful → Algolia index update workflow, Contentful → Slack publish notification workflow, Algolia → consistency check workflow
**Tools**: `http_request`
**Connectors**: Contentful (CMA Token), Algolia (Admin API Key), Slack (Bot Token)
**Triggers**: webhook (Contentful), schedule (daily consistency check)
**Protocols**: user_message (sync errors), agent_memory (index state)

---

## 60 — Segment → Slack → Notion Customer Event Intelligence

Receives Segment events via webhook, enriches user profiles with behavioral data, detects high-intent signals (pricing page visits, feature activation), notifies sales in Slack with context, and logs signal patterns in Notion.

**Replaces**: Segment → Slack event notification workflow, Segment → lead scoring workflow, Segment → Notion log workflow, Segment → intent signal detection workflow
**Tools**: `http_request`
**Connectors**: Segment (Write Key for API), Slack (Bot Token), Notion (Integration Token)
**Triggers**: webhook (Segment)
**Protocols**: user_message (hot signals), agent_memory (behavioral patterns), emit_event (high_intent_detected)

---

## 61 — LaunchDarkly → Slack → Linear → Notion Feature Flag Governance Use Case

Monitors LaunchDarkly for flag changes, posts change audit logs to Slack, creates Linear cleanup tickets for flags older than 90 days, and maintains a Notion feature flag registry. Prevents flag naming collisions.

**Replaces**: LaunchDarkly → Slack change notification workflow, LaunchDarkly → stale flag cleanup workflow, LaunchDarkly → documentation sync workflow, LaunchDarkly → naming convention enforcer workflow
**Tools**: `http_request`
**Connectors**: LaunchDarkly (API Token), Slack (Bot Token), Linear (API Key), Notion (Integration Token)
**Triggers**: webhook (LaunchDarkly), schedule (weekly for stale flag scan)
**Protocols**: user_message, agent_memory (flag inventory), manual_review (flag removal)

---

## 62 — Uptime Robot → Slack → PagerDuty → Notion Status Page Manager

Receives Uptime Robot alerts, updates a Notion-based status page, escalates to PagerDuty for critical downtime, maintains a Slack incident thread with updates, and generates monthly uptime reports.

**Replaces**: Uptime Robot → Slack alert workflow, Uptime Robot → PagerDuty workflow, Uptime Robot → status page update workflow, Uptime Robot → monthly uptime report workflow
**Tools**: `http_request`
**Connectors**: Uptime Robot (API Key), Slack (Bot Token), PagerDuty (API Key), Notion (Integration Token)
**Triggers**: webhook (Uptime Robot), schedule (monthly for report)
**Protocols**: user_message, agent_memory (incident history), emit_event (service_down, service_restored)

---

## 63 — Harvest → Google Sheets → Slack → Gmail Time Tracking Analyst

Pulls Harvest time entries daily, logs to Google Sheets by project and team member, posts Slack summaries of billable vs. non-billable ratios, and emails weekly utilization reports to managers. Flags under-logged days.

**Replaces**: Harvest → Google Sheets sync workflow, Harvest → Slack summary workflow, Harvest → email report workflow, Harvest → missing time entry alert workflow
**Tools**: `http_request`, `gmail_send`, `file_write`
**Connectors**: Harvest (PAT), Google Sheets (Service Account), Slack (Bot Token), Google Workspace
**Triggers**: schedule (daily 7pm), schedule (weekly Friday)
**Protocols**: user_message (missing entries), agent_memory (utilization trends)

---

## 64 — Ghost → Buffer → Slack → Airtable Blog Distribution Use Case

Detects new Ghost CMS publications via API, schedules social posts to Buffer with platform-optimized formatting, posts internal announcements to Slack, and logs the article to an Airtable content library with metadata.

**Replaces**: Ghost → Buffer social scheduling workflow, Ghost → Slack announcement workflow, Ghost → Airtable log workflow
**Tools**: `http_request`
**Connectors**: Ghost (Admin API Key), Buffer (Access Token), Slack (Bot Token), Airtable (PAT)
**Triggers**: polling (300s)
**Protocols**: user_message, agent_memory (content performance)

---

## 65 — Salesforce → Slack → Gmail → Google Sheets Enterprise CRM Brain

Monitors Salesforce opportunity changes, posts deal updates to Slack channels organized by region, sends personalized outreach emails from Gmail based on lead scoring, and syncs pipeline data to Google Sheets for board reporting.

**Replaces**: Salesforce → Slack deal notification workflow, Salesforce → email sequence workflow, Salesforce → Google Sheets pipeline sync workflow, Salesforce → lead scoring and routing workflow
**Tools**: `http_request`, `gmail_send`, `file_write`
**Connectors**: Salesforce (OAuth), Slack (Bot Token), Google Workspace, Google Sheets (Service Account)
**Triggers**: polling (300s), schedule (weekly for pipeline report)
**Protocols**: user_message, agent_memory (account history), emit_event (deal_stage_change)

---

## 66 — Grafana → Slack → Jira → Gmail Alert Consolidator

Receives Grafana alert webhooks, deduplicates and correlates related alerts into incidents, posts consolidated Slack threads (not one message per metric), creates Jira tickets for persistent issues, and emails daily infrastructure summaries.

**Replaces**: Grafana → Slack alert workflow (×many), Grafana → Jira ticket workflow, Alert → deduplication workflow, Grafana → daily summary email workflow
**Tools**: `http_request`, `gmail_send`
**Connectors**: Grafana (Service Account Token), Slack (Bot Token), Jira (API Token), Google Workspace
**Triggers**: webhook (Grafana)
**Protocols**: user_message, agent_memory (alert correlations, baseline metrics)

---

## 67 — Discourse → Slack → Linear Community Engagement Use Case

Monitors Discourse forum for new topics, popular threads, and unanswered questions. Routes feature requests to Linear, posts community highlights to Slack, and flags urgent support questions for team response.

**Replaces**: Discourse → Slack notification workflow, Discourse → Linear issue creation workflow, Discourse → unanswered question alert workflow, Discourse → weekly community digest workflow
**Tools**: `http_request`
**Connectors**: Discourse (API Key), Slack (Bot Token), Linear (API Key)
**Triggers**: polling (300s), schedule (weekly for digest)
**Protocols**: user_message, agent_memory (community members, frequent topics)

---

## 68 — Brevo → Airtable → Slack Transactional Email Monitor

Monitors Brevo (Sendinblue) transactional email events (delivered, opened, bounced, complained), maintains delivery metrics in Airtable, posts Slack alerts for delivery rate drops, and generates weekly deliverability health reports.

**Replaces**: Brevo → Airtable event log workflow, Brevo → Slack alert workflow, Brevo → weekly report workflow, Brevo → bounce management workflow
**Tools**: `http_request`
**Connectors**: Brevo (API Key), Airtable (PAT), Slack (Bot Token)
**Triggers**: webhook (Brevo), schedule (weekly)
**Protocols**: user_message, agent_memory (deliverability baselines)

---

## 69 — Notion → Google Slides → Gmail → Slack Report Auto-Compiler

Reads data tables from Notion databases, generates summary statistics, creates a Google Slides presentation via the API, emails the deck to stakeholders, and posts a summary with the link to Slack.

**Replaces**: Notion → data extraction workflow, Data → Google Slides generation workflow, Slides → email distribution workflow, Report → Slack notification workflow
**Tools**: `http_request`, `gmail_send`
**Connectors**: Notion (Integration Token), Google Slides (OAuth), Google Workspace, Slack (Bot Token)
**Triggers**: schedule (weekly/monthly), manual
**Protocols**: user_message, execution_flow

---

## 70 — WooCommerce → Slack → Google Sheets → Gmail Store Operations Use Case

Processes WooCommerce orders, refunds, and inventory changes. Posts high-value order alerts to Slack, logs all transactions to Google Sheets, emails customers for order status updates, and generates daily sales summaries.

**Replaces**: WooCommerce → Slack order notification workflow, WooCommerce → Google Sheets log workflow, WooCommerce → customer email workflow, WooCommerce → daily sales report workflow, WooCommerce → low inventory alert workflow
**Tools**: `http_request`, `gmail_send`, `file_write`
**Connectors**: WooCommerce (Consumer Key + Secret), Slack (Bot Token), Google Sheets (Service Account), Google Workspace
**Triggers**: webhook (WooCommerce), schedule (daily)
**Protocols**: user_message (inventory alerts), agent_memory (sales patterns)

---

## 71 — Okta → Slack → Jira Security Access Governance Use Case

Monitors Okta system log events for suspicious login attempts, privilege escalations, and MFA changes. Posts security alerts to Slack, creates Jira security tickets for investigation, and maintains an access audit trail.

**Replaces**: Okta → Slack alert workflow, Okta → Jira ticket workflow, Okta → audit log analysis workflow, Okta → weekly security report workflow
**Tools**: `http_request`
**Connectors**: Okta (API Token), Slack (Bot Token), Jira (API Token)
**Triggers**: polling (60s), schedule (weekly for audit report)
**Protocols**: user_message (security alerts), agent_memory (normal access patterns), manual_review (privilege escalations)

---

## 72 — Notion → Slack → Gmail Multi-Tenant Client Portal Use Case

Monitors per-client Notion databases for task updates and deliverable completions. Sends automated client update emails, posts internal status to Slack, and generates client-facing progress reports. Handles multiple client contexts simultaneously.

**Replaces**: Per-client Notion → email update workflows (×N clients), Notion → Slack internal status workflow, Notion → progress report generation workflow
**Tools**: `http_request`, `gmail_send`, `file_write`
**Connectors**: Notion (Integration Token), Slack (Bot Token), Google Workspace
**Triggers**: polling (300s), schedule (weekly per client)
**Protocols**: user_message, agent_memory (client preferences, project status)

---

## 73 — Prometheus → Slack → GitHub → Notion SRE Runbook Executor

Receives Prometheus alerts via Alertmanager webhook, matches them against runbook entries stored in Notion, executes diagnostic steps via HTTP, posts findings to Slack, and creates GitHub issues for unresolved incidents.

**Replaces**: Prometheus → Slack alert workflow, Alert → runbook lookup workflow, Runbook → auto-diagnostic workflow, Diagnostic → GitHub issue workflow
**Tools**: `http_request`
**Connectors**: Prometheus/Alertmanager (webhook), Slack (Bot Token), GitHub (PAT), Notion (Integration Token)
**Triggers**: webhook (Alertmanager)
**Protocols**: user_message, execution_flow (diagnostic steps), agent_memory (runbook context)

---

## 74 — HubSpot → Slack → Gmail → Calendly Inbound Lead Concierge

When a new HubSpot contact is created (form fill, import), enriches the profile with company data, sends a personalized welcome email with a Calendly link, posts the lead to the appropriate Slack sales channel based on segment, and schedules follow-ups.

**Replaces**: HubSpot → welcome email workflow, HubSpot → Slack lead notification workflow, HubSpot → Calendly link insertion workflow, HubSpot → lead enrichment workflow, HubSpot → follow-up sequence workflow
**Tools**: `http_request`, `gmail_send`
**Connectors**: HubSpot (API Key), Slack (Bot Token), Google Workspace, Calendly (PAT)
**Triggers**: polling (120s)
**Protocols**: user_message, agent_memory (lead segments), emit_event (lead_qualified)

---

## 75 — Vercel + Checkly → Slack → Notion Production Quality Gate

After Vercel deploys, triggers Checkly synthetic monitoring checks, waits for results, posts pass/fail status to Slack with performance metrics, logs deploy quality scores to Notion, and initiates rollback flow if critical checks fail.

**Replaces**: Vercel → Checkly trigger workflow, Checkly → Slack results workflow, Deploy → Notion log workflow, Check failure → rollback workflow
**Tools**: `http_request`
**Connectors**: Vercel (Token), Checkly (API Key), Slack (Bot Token), Notion (Integration Token)
**Triggers**: webhook (Vercel deploy)
**Protocols**: user_message, manual_review (rollback decisions), execution_flow, agent_memory (deploy quality trends)

---

## 76 — Calendly → Zoom → Notion → Gmail Meeting Automation Suite

When a Calendly meeting is booked, creates a Zoom meeting link, updates the Notion meeting tracker, sends a confirmation email with Zoom link and prep materials. Post-meeting, creates a Notion notes page and sends a follow-up email.

**Replaces**: Calendly → Zoom creation workflow, Calendly → email confirmation workflow, Calendly → Notion tracking workflow, Post-meeting → notes template workflow, Post-meeting → follow-up email workflow
**Tools**: `http_request`, `gmail_send`
**Connectors**: Calendly (PAT), Zoom (OAuth), Notion (Integration Token), Google Workspace
**Triggers**: webhook (Calendly), schedule (daily for post-meeting follow-ups)
**Protocols**: user_message, agent_memory (contact meeting history)

---

## 77 — Webflow → Stripe → Airtable → Gmail Membership Site Manager

Monitors Webflow form submissions for membership signups, creates Stripe subscriptions, adds members to Airtable, sends welcome emails with access credentials, and handles cancellation/downgrade flows end-to-end.

**Replaces**: Webflow → Stripe subscription workflow, Stripe → Airtable member sync workflow, Signup → welcome email workflow, Cancellation → cleanup workflow
**Tools**: `http_request`, `gmail_send`
**Connectors**: Webflow (API Token), Stripe (API Key), Airtable (PAT), Google Workspace
**Triggers**: webhook (Webflow, Stripe), polling (300s)
**Protocols**: user_message, agent_memory (member lifecycle), emit_event (member_joined, member_churned)

---

## 78 — Terraform Cloud → Slack → GitHub → Jira Infrastructure Change Manager

Monitors Terraform Cloud run events (plan, apply, error), posts diff summaries to Slack, creates GitHub review PRs for infrastructure changes, and logs approved changes as Jira tickets. Blocks risky applies for manual review.

**Replaces**: Terraform → Slack notification workflow, Terraform → GitHub PR workflow, Terraform → Jira log workflow, Terraform → risky change blocker workflow
**Tools**: `http_request`
**Connectors**: Terraform Cloud (API Token), Slack (Bot Token), GitHub (PAT), Jira (API Token)
**Triggers**: webhook (Terraform Cloud)
**Protocols**: user_message, manual_review (risky changes), execution_flow, agent_memory (infra change patterns)

---

## 79 — Google Forms → Airtable → Slack → Gmail Survey Processor

Polls Google Forms for new responses, processes and scores answers, adds structured records to Airtable, posts response summaries to Slack, and sends personalized thank-you/follow-up emails based on responses.

**Replaces**: Google Forms → Airtable sync workflow, Google Forms → Slack notification workflow, Google Forms → conditional email workflow, Google Forms → response scoring workflow
**Tools**: `http_request`, `gmail_send`
**Connectors**: Google Forms (OAuth), Airtable (PAT), Slack (Bot Token), Google Workspace
**Triggers**: polling (120s)
**Protocols**: user_message, agent_memory (response patterns)

---

## 80 — Notion → Slack → Gmail Knowledge Base Review Cycle Manager

Scans a Notion knowledge base for articles due for periodic review. Assigns reviewers from a rotation, sends email reminders, posts review status to Slack, tracks completion, and updates the "Last Reviewed" date on completion.

**Replaces**: Notion → review due date scanner workflow, Notion → reviewer assignment workflow, Review → email reminder workflow, Review → Slack status workflow, Review completion → Notion update workflow
**Tools**: `http_request`, `gmail_send`
**Connectors**: Notion (Integration Token), Slack (Bot Token), Google Workspace
**Triggers**: schedule (daily)
**Protocols**: user_message, agent_memory (reviewer rotation), manual_review

---

## 81 — Braintree → Airtable → Slack → Gmail Payment Fraud Detector

Processes Braintree transaction webhooks, runs risk scoring heuristics (velocity checks, amount anomalies, geography mismatches), logs suspicious transactions to Airtable, alerts the fraud team in Slack, and emails customers for verification.

**Replaces**: Braintree → fraud detection workflow, Braintree → Airtable log workflow, Fraud alert → Slack workflow, Fraud → customer verification email workflow
**Tools**: `http_request`, `gmail_send`
**Connectors**: Braintree (API Key), Airtable (PAT), Slack (Bot Token), Google Workspace
**Triggers**: webhook (Braintree)
**Protocols**: user_message (fraud alerts), agent_memory (fraud patterns), manual_review (flagged transactions)

---

## 82 — GitHub → Snyk → Slack → Jira Security Vulnerability Pipeline

Monitors GitHub repos for new commits, triggers Snyk vulnerability scans, correlates results with existing Jira security tickets, posts new findings to Slack, and creates Jira tickets for untracked vulnerabilities with severity-based priority.

**Replaces**: GitHub → Snyk scan trigger workflow, Snyk → Slack alert workflow, Snyk → Jira ticket creation workflow, Vulnerability → deduplication workflow
**Tools**: `http_request`
**Connectors**: GitHub (PAT), Snyk (API Token), Slack (Bot Token), Jira (API Token)
**Triggers**: webhook (GitHub push), schedule (weekly full scan)
**Protocols**: user_message (critical vulns), agent_memory (known vulnerabilities), execution_flow

---

## 83 — Airtable → Notion → Gmail → Slack Vendor Management Use Case

Maintains vendor records in Airtable, syncs contract details to Notion, sends automated review reminders before contract renewals, posts vendor performance summaries to Slack, and generates quarterly vendor scorecards.

**Replaces**: Airtable → Notion vendor sync workflow, Airtable → renewal reminder email workflow, Airtable → Slack vendor alert workflow, Vendor → quarterly scorecard workflow
**Tools**: `http_request`, `gmail_send`, `file_write`
**Connectors**: Airtable (PAT), Notion (Integration Token), Google Workspace, Slack (Bot Token)
**Triggers**: schedule (daily for renewals, quarterly for scorecards)
**Protocols**: user_message, agent_memory (vendor history), manual_review (renewal decisions)

---

## 84 — Firebase → Slack → Linear → Gmail App Performance Guardian

Monitors Firebase Crashlytics and Performance Monitoring APIs for crash spikes, slow screens, and ANRs. Posts real-time alerts to Slack, creates Linear bugs for new crash clusters, and emails a weekly app health report.

**Replaces**: Firebase → Slack crash alert workflow, Firebase → Linear issue workflow, Firebase → weekly performance report workflow, Firebase → ANR detection workflow
**Tools**: `http_request`, `gmail_send`
**Connectors**: Firebase (Service Account), Slack (Bot Token), Linear (API Key), Google Workspace
**Triggers**: polling (120s), schedule (weekly)
**Protocols**: user_message, agent_memory (crash baselines)

---

## 85 — Snowflake → Google Sheets → Slack → Gmail Data Warehouse Health Use Case

Queries Snowflake information schema for failed jobs, long-running queries, and warehouse credit usage. Logs metrics to Google Sheets, posts Slack alerts for anomalies, and emails weekly cost optimization recommendations.

**Replaces**: Snowflake → failed job alert workflow, Snowflake → Google Sheets metrics workflow, Snowflake → Slack cost alert workflow, Snowflake → weekly report email workflow
**Tools**: `http_request`, `gmail_send`, `file_write`
**Connectors**: Snowflake (Key Pair Auth), Google Sheets (Service Account), Slack (Bot Token), Google Workspace
**Triggers**: schedule (hourly for health, weekly for report)
**Protocols**: user_message, agent_memory (query patterns, cost baselines)

---

## 86 — Lemlist → HubSpot → Slack Outbound Sales Intelligence Use Case

Monitors Lemlist campaign engagement (opens, clicks, replies), updates HubSpot contact records with engagement scores, routes hot leads to Slack sales channels with full interaction history, and adjusts campaign sequences based on performance.

**Replaces**: Lemlist → HubSpot sync workflow, Lemlist → Slack hot lead alert workflow, Lemlist → engagement scoring workflow, Campaign → performance adjustment workflow
**Tools**: `http_request`
**Connectors**: Lemlist (API Key), HubSpot (API Key), Slack (Bot Token)
**Triggers**: polling (300s), schedule (daily for performance review)
**Protocols**: user_message, agent_memory (outreach patterns), emit_event (reply_received)

---

## 87 — Retool → Slack → Gmail Internal Tool Audit Use Case

Monitors Retool app usage analytics, tracks which internal tools are being used (and by whom), posts weekly usage reports to Slack, emails app owners about unused tools, and flags permission changes for security review.

**Replaces**: Retool → Slack usage report workflow, Retool → unused app alert workflow, Retool → permission change audit workflow
**Tools**: `http_request`, `gmail_send`
**Connectors**: Retool (API Key), Slack (Bot Token), Google Workspace
**Triggers**: schedule (weekly), polling (600s for permission changes)
**Protocols**: user_message, agent_memory (usage baselines), manual_review (permission changes)

---

## 88 — GitHub → Notion → Slack Open Source Community Manager

Monitors GitHub repo activity (stars, forks, issues, discussions, PRs from external contributors), maintains a Notion contributor CRM, posts community highlights to Slack, and sends thank-you messages on first-time contributions.

**Replaces**: GitHub → Slack notification workflow, GitHub → contributor tracking workflow, GitHub → first-time contributor welcome workflow, GitHub → community metrics report workflow
**Tools**: `http_request`
**Connectors**: GitHub (PAT), Notion (Integration Token), Slack (Bot Token)
**Triggers**: polling (300s), schedule (weekly for metrics)
**Protocols**: user_message, agent_memory (contributor history)

---

## 89 — Buildkite → Slack → GitHub → Notion Build Pipeline Intelligence Use Case

Processes Buildkite build events, correlates failures across pipeline steps, posts root-cause analysis to Slack (not just "failed"), comments on GitHub PRs with specific fix hints, and logs build performance trends in Notion.

**Replaces**: Buildkite → Slack notification workflow, Buildkite → GitHub PR status workflow, Build failure → root cause analysis workflow, Build → performance trend logging workflow
**Tools**: `http_request`
**Connectors**: Buildkite (API Token), Slack (Bot Token), GitHub (PAT), Notion (Integration Token)
**Triggers**: webhook (Buildkite)
**Protocols**: user_message, agent_memory (build patterns, common failures), execution_flow

---

## 90 — Notion → Airtable → Slack → Gmail Quarterly OKR Tracker

Reads OKR definitions from Notion, tracks key results progress in Airtable, sends weekly Slack check-in summaries, emails monthly OKR status reports to leadership, and flags at-risk objectives for intervention.

**Replaces**: Notion → Airtable OKR sync workflow, OKR → Slack weekly check-in workflow, OKR → monthly email report workflow, OKR → at-risk alert workflow
**Tools**: `http_request`, `gmail_send`, `file_write`
**Connectors**: Notion (Integration Token), Airtable (PAT), Slack (Bot Token), Google Workspace
**Triggers**: schedule (weekly Monday, monthly 1st)
**Protocols**: user_message, agent_memory (OKR history), manual_review (at-risk objectives)

---

## Multi-Use Case Pipeline Templates (91–100)

---

## 91 — Full-Stack Deploy Pipeline (4-Use Case Team)

**Use Case A — Code Validator** (worker): Runs linters and tests via GitHub API on new PRs.
**Use Case B — Security Scanner** (worker): Runs Snyk/Dependabot checks in parallel with Use Case A.
**Use Case C — Deploy Orchestrator** (orchestrator): Waits for both validators to pass, triggers Vercel/AWS deploy, monitors health post-deploy.
**Use Case D — Stakeholder Notifier** (worker): Sends Slack updates, emails release notes, and updates Notion changelog.

**Replaces**: PR → lint workflow, PR → security scan workflow, Merge → deploy workflow, Deploy → notification workflow, Deploy → health check workflow, Deploy → changelog workflow
**Connectors**: GitHub, Snyk, Vercel/AWS, Slack, Google Workspace, Notion

---

## 92 — Customer Onboarding Pipeline (5-Use Case Team)

**Use Case A — Welcome Concierge** (worker): Sends welcome email, creates Notion client page.
**Use Case B — Account Provisioner** (worker): Creates accounts in Stripe, adds to Slack Connect channel.
**Use Case C — Data Migrator** (worker): Imports customer data from provided CSV/API into Airtable.
**Use Case D — Training Scheduler** (worker): Books onboarding calls via Calendly, sends prep materials.
**Use Case E — Onboarding Coordinator** (orchestrator): Sequences all agents and tracks completion.

**Replaces**: Signup → welcome email workflow, Signup → Stripe setup workflow, Signup → data import workflow, Signup → training schedule workflow, Onboarding → status tracking workflow (×5+ workflows total)
**Connectors**: Google Workspace, Notion, Stripe, Slack, Airtable, Calendly

---

## 93 — Content Creation & Distribution Pipeline (4-Use Case Team)

**Use Case A — Research & Outline** (worker): Gathers industry data via HTTP and creates structured outlines in files.
**Use Case B — Writer** (worker): Expands outlines into full drafts with proper formatting.
**Use Case C — Editor & SEO** (reviewer): Reviews for quality, adds SEO optimization, flags issues for manual review.
**Use Case D — Publisher** (worker): Posts to WordPress/Ghost, schedules Buffer social posts, notifies Slack.

**Replaces**: Research → outline workflow, Outline → draft workflow, Draft → review workflow, Review → publish workflow, Publish → social media workflow, Publish → team notification workflow
**Connectors**: WordPress/Ghost, Buffer, Slack, Google Workspace

---

## 94 — Incident Management Pipeline (4-Use Case Team)

**Use Case A — Alert Triager** (router): Receives Datadog/PagerDuty alerts and classifies severity.
**Use Case B — Diagnostician** (worker): Runs health checks, queries logs, identifies root cause.
**Use Case C — Communicator** (worker): Posts Slack incident threads, emails stakeholders, updates Notion status page.
**Use Case D — Resolution Tracker** (reviewer): Monitors fix progress, prompts for post-mortem, and closes incidents.

**Replaces**: Alert → triage workflow, Alert → diagnostic workflow, Incident → Slack thread workflow, Incident → email notification workflow, Incident → status page workflow, Incident → post-mortem workflow
**Connectors**: Datadog, PagerDuty, Slack, Google Workspace, Notion

---

## 95 — Hiring Pipeline Automator (5-Use Case Team)

**Use Case A — Application Screener** (worker): Reads Greenhouse applications, scores against job criteria.
**Use Case B — Interview Scheduler** (worker): Coordinates availability via Google Calendar and Calendly.
**Use Case C — Reference Checker** (worker): Sends reference check emails and collects responses.
**Use Case D — Offer Manager** (worker): Generates offer letters, manages DocuSign envelope flow.
**Use Case E — Pipeline Coordinator** (orchestrator): Manages candidate progression and posts updates to Slack.

**Replaces**: Application → screening workflow, Screening → schedule workflow, Interview → reference check workflow, Reference → offer workflow, All stages → Slack notification workflows
**Connectors**: Greenhouse, Google Calendar, Calendly, Google Workspace, DocuSign, Slack

---

## 96 — Multi-Region E-Commerce Fulfillment Pipeline (4-Use Case Team)

**Use Case A — Order Router** (router): Receives Shopify orders, determines fulfillment warehouse by region.
**Use Case B — Inventory Manager** (worker): Checks and reserves stock in Airtable, alerts on low inventory.
**Use Case C — Shipping Coordinator** (worker): Creates shipping labels via ShipStation API, updates tracking.
**Use Case D — Customer Communicator** (worker): Sends order confirmation, shipping, and delivery emails.

**Replaces**: Order → routing workflow, Order → inventory check workflow, Order → shipping label workflow, Order → confirmation email workflow, Shipping → tracking update workflow, Inventory → restock alert workflow
**Connectors**: Shopify, Airtable, ShipStation, Google Workspace, Slack

---

## 97 — Financial Close Pipeline (4-Use Case Team)

**Use Case A — Transaction Reconciler** (worker): Pulls Stripe + QuickBooks data, identifies discrepancies.
**Use Case B — Expense Classifier** (worker): Categorizes unclassified expenses using historical patterns.
**Use Case C — Report Generator** (worker): Compiles P&L, balance sheet summaries into Google Sheets.
**Use Case D — Close Manager** (orchestrator): Sequences tasks, tracks completion, emails final reports.

**Replaces**: Stripe → QuickBooks reconciliation workflow, Expense → categorization workflow, Data → financial report workflow, Close → checklist tracking workflow, Report → distribution workflow
**Connectors**: Stripe, QuickBooks, Google Sheets, Google Workspace, Slack

---

## 98 — Competitive Intelligence Pipeline (3-Use Case Team)

**Use Case A — Data Collectors** (worker, ×3 instances): Each monitors a different competitor via their public API, website, and social presence.
**Use Case B — Analyst** (reviewer): Compares findings, identifies strategic implications, and cross-references with internal data from Notion.
**Use Case C — Reporter** (worker): Compiles weekly intelligence briefings into Notion, emails executives, and posts key findings to Slack.

**Replaces**: Per-competitor monitoring workflows (×N), Competitor → comparison workflow, Analysis → report workflow, Report → distribution workflow
**Connectors**: Notion, Slack, Google Workspace

---

## 99 — Multi-Channel Support Triage Pipeline (5-Use Case Team)

**Use Case A — Email Support** (worker): Processes Zendesk email tickets, classifies and enriches.
**Use Case B — Chat Support** (worker): Monitors Intercom conversations for handoff triggers.
**Use Case C — Social Support** (worker): Tracks Twitter/X mentions via API for support requests.
**Use Case D — Knowledge Use Case** (worker): Searches Notion KB and suggests responses for all channels.
**Use Case E — Triage Coordinator** (orchestrator): Routes across channels, prevents duplicate handling, escalates VIP customers.

**Replaces**: Email → triage workflow, Chat → escalation workflow, Social → capture workflow, KB → search + suggest workflow, Cross-channel → deduplication workflow, VIP → priority routing workflow
**Connectors**: Zendesk, Intercom, Twitter/X, Notion, Slack, Google Workspace

---

## 100 — Full Business Operations Pipeline (6-Use Case Team)

**Use Case A — Revenue Monitor** (worker): Tracks Stripe payments, Shopify orders, and sends daily revenue snapshots.
**Use Case B — Customer Success** (worker): Monitors Intercom + Zendesk for at-risk accounts and churn signals.
**Use Case C — Engineering Ops** (worker): Watches GitHub, Sentry, and Vercel for production health.
**Use Case D — People Ops** (worker): Manages Greenhouse pipeline updates and team Slack announcements.
**Use Case E — Finance Ops** (worker): Reconciles QuickBooks, tracks budgets, and flags variances.
**Use Case F — COO Brain** (orchestrator): Synthesizes all agents' outputs into a daily executive briefing (Slack + email + Notion), escalates cross-functional issues, and maintains company health metrics via agent memory.

**Replaces**: 15-25 individual n8n workflows spanning revenue, support, engineering, HR, and finance — unified into a single intelligent operations layer.
**Connectors**: Stripe, Shopify, Intercom, Zendesk, GitHub, Sentry, Vercel, Greenhouse, QuickBooks, Slack, Google Workspace, Notion