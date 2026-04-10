# Codebase Catalogs — personas

> Generated: 2026-04-07T21:51:27.173Z
> Templates: 92 across 14 categories
> Connectors: 87 across 23 categories
>
> **DO NOT EDIT MANUALLY.** Re-run `/refresh-context` to regenerate.
> Consumed by `/research` for template/credential bucket dedup and gap analysis.

---

## How /research Uses This File

When an idea is bucketed as a **template** or **credential** proposal:
1. **Dedup** — does a template/credential with this scope already exist? Drop the idea if yes.
2. **Gap fit** — does the idea fill a sparse category? Boost priority if yes.
3. **Service compatibility** — for template ideas, are required connectors in the catalog? If not, the credential must be added first.

---

## Template Catalog (92)

### content (8)

- **ai-document-intelligence-hub** — Monitors Google Drive folders for new and updated documents, uses AI to extract summaries, tags, and metadata, then builds a searchable Notion knowledge base and local index. Responds to natural-language search queries via Telegram and posts weekly knowledge growth reports to Slack. — flow: Google Drive -> Notion -> Telegram -> Slack (uses: google_drive,notion,telegram,slack) [trigger: polling,polling,schedule]
- **analytics-content-distribution-use-case** — Detects new WordPress posts via the REST API, auto-schedules social media posts to Buffer with platform-optimized captions, checks Google Analytics performance after 48h, and adjusts future posting strategy based on engagement data. — flow: WordPress -> Buffer -> Google (uses: wordpress,buffer,google_analytics) [trigger: polling,schedule,schedule]
- **autonomous-art-director** — Periodically conceives and generates unique art concepts using Leonardo AI, saves them to the in-app 2D gallery, and presents each piece for human curation. Learns from approvals and rejections to refine its creative direction over time. — flow: Leonardo AI -> Artist Gallery -> Messages (uses: image_ai) [trigger: schedule]
- **content-approval-workflow** — Monitors a Notion "Ready for Review" database view. When items appear, emails the assigned reviewer, posts to a Slack approval channel with action context, and waits for approval. On approval, moves the item to "Published" and notifies the author. — flow: Notion -> Gmail -> Slack (uses: notion,gmail,slack) [trigger: polling]
- **content-performance-reporter** — Analyzes page views, session duration, and bounce rate metrics from a local database to generate weekly trend reports with week-over-week comparisons, content rankings, and anomaly detection. Delivers structured insights via in-app messaging and progressively learns baseline patterns through agent memory. — flow: Local Database -> In-App Messaging [trigger: schedule,schedule]
- **demo-recorder** — Creates short demo recordings and step-by-step visual guides from running web applications by analyzing the codebase to understand features, autonomously navigating the app in a browser, and capturing annotated screenshots or video walkthroughs. Uses a tiered recording system (CDP screenshots → Windows Game Bar → Playwright) requiring zero mandatory installs. — flow: Codebase -> Desktop Browser -> Desktop Terminal -> Messages (uses: desktop_browser,desktop_terminal)
- **feature-video-creator** — Automates production of short feature announcement videos by generating scripts, voiceover audio via TTS API, and composing final videos via a cloud video API. Uses a 2-stage human review cycle (script approval, then final video approval) with Memory-driven learning to improve script style, visual choices, and narration tone over time. — flow: TTS API -> Video Composition API -> Messages (uses: tts_api,video_composition_api)
- **newsletter-curator** — Scans web sources and RSS feeds on a weekly schedule, curates the most relevant articles using editorial intelligence, assembles themed newsletter issues with original commentary, and delivers polished HTML emails to subscribers via SMTP. Learns from engagement signals and editorial feedback to progressively refine source selection, topic weighting, and writing tone. — flow: Web Sources -> RSS Feeds -> Editorial Engine -> SMTP Email (uses: email_smtp,rss_web_sources) [trigger: schedule]

### development (12)

- **autonomous-issue-resolver** — Polls Jira for stale issues, classifies their state, analyzes reporter sentiment from comments, searches Notion docs and a local knowledge base for matching solutions, auto-posts resolution suggestions with confidence scoring, escalates angry or high-priority reporters to engineering managers via Slack, auto-closes confirmed or abandoned issues, and learns from successful resolutions to grow the knowledge base over time. — flow: Jira -> Notion -> Slack (uses: jira,notion,slack) [trigger: polling,schedule,schedule]
- **build-intelligence-use-case** — Monitors CircleCI pipeline events, analyzes failed build logs to identify root causes, posts enriched Slack messages (not just "build failed" but "failed because X in file Y"), and comments on the GitHub PR with fix suggestions. Tracks flaky test patterns. — flow: CircleCI -> Slack -> GitHub (uses: circleci,slack,github) [trigger: webhook,schedule]
- **codebase-health-scanner** — Monthly automated codebase health scanner that reviews context map freshness, runs multi-agent scans (security, quality, tech debt, test coverage), scores each context group, reports issues via built-in messages, and persists health snapshots for trend analysis in the Dev Tools plugin. — flow: Codebase
- **design-handoff-coordinator** — Monitors Figma file version changes, extracts updated component names, creates or updates Linear tickets for the dev team with direct Figma links, and posts handoff summaries in the design Slack channel. — flow: Figma -> Linear -> Slack (uses: figma,linear,slack) [trigger: webhook,polling]
- **dev-clone** — Autonomous software developer persona that gathers backlog from multiple sources, implements features via the codebases connector, creates GitHub PRs, reacts to PR review comments via webhook, and manages release cycles. Learns architecture patterns and triage decisions via Memory to become a progressively more reliable development clone. — flow: Codebases -> GitHub -> Messages (uses: github) [trigger: schedule,webhook]
- **dev-lifecycle-manager** — Watches GitHub for new PRs, issues, and releases. Auto-creates/updates linked Jira tickets, posts status updates to Slack dev channels, and flags PRs that exceed size thresholds for manual review. — flow: GitHub -> Jira -> Slack (uses: github,jira,slack) [trigger: polling,webhook,manual]
- **documentation-freshness-guardian** — Scans Confluence pages for staleness (no edits in N days), checks if referenced APIs or tools still exist, notifies page owners via email, and posts a Slack digest of stale docs. Tracks update promises in memory. — flow: Confluence -> Slack -> Gmail (uses: confluence,gmail,slack) [trigger: schedule]
- **feature-flag-experiment-analyst** — Monitors PostHog feature flag changes and experiment results, posts summaries to Slack product channels, creates Linear follow-up tickets for winning experiment variants, and archives flags that haven't been modified in 30+ days. — flow: Posthog -> Slack -> Linear (uses: posthog,slack,linear) [trigger: schedule,polling]
- **feature-flag-governance-use-case** — Monitors LaunchDarkly for flag changes, posts change audit logs to Slack, creates Linear cleanup tickets for flags older than 90 days, and maintains a Notion feature flag registry. Prevents flag naming collisions. — flow: LaunchDarkly -> Slack -> Linear -> Notion (uses: launchdarkly,slack,linear,notion) [trigger: webhook,schedule,manual]
- **qa-guardian** — Autonomous code reviewer that reacts to pull requests, analyzes code quality and security via the codebases connector, runs tests, scores PRs on a 1-10 scale, posts structured review comments on GitHub, and writes missing tests when coverage is poor. Designed as a companion to Dev Clone but works with any PR workflow. — flow: GitHub -> Codebases -> Messages (uses: github) [trigger: webhook]
- **real-time-database-watcher** — Subscribes to Supabase database webhooks for specific table changes (new users, order updates, flag changes). Posts enriched notifications to Slack, triggers welcome email sequences for new signups, and logs anomalous data patterns. — flow: Supabase -> Slack -> Gmail (uses: supabase,slack,gmail) [trigger: webhook,schedule,schedule]
- **user-lifecycle-manager** — Handles Clerk auth events (signup, email change, deletion), provisions user records in Supabase, sends onboarding email sequences via Gmail, and posts new user celebrations to Slack. Handles the full user lifecycle from sign-up to churn. — flow: Clerk -> Supabase -> Slack -> Gmail (uses: clerk,supabase,slack,gmail) [trigger: webhook,schedule]

### devops (5)

- **devops-guardian** — Unified daily DevOps monitoring agent that scans application errors, infrastructure metrics, database health, and deployment status from your connected monitoring tools, triages incidents for human review, delivers structured reports via Messages, and learns from review decisions to improve alert quality over time. — flow: Monitoring Tool -> Database -> Deployment Platform -> Messages (uses: monitoring_tool,database,deployment_platform) [trigger: schedule]
- **incident-logger** — Comprehensive incident management agent that handles intake, severity-based triage, status tracking, escalation timers, and post-incident review generation -- the single source of truth for every operational incident from first report through resolution and retrospective. — flow: Local Database -> In-App Messaging [trigger: manual,event,schedule]
- **sentry-production-monitor** — Daily production issue monitor that fetches unresolved Sentry errors across all configured projects, analyzes root causes using the codebases connector for cross-project investigation, generates Jira-format issue reports via Messages, and presents incidents for human triage. Learns from triage decisions to distinguish actionable issues from noise over time. — flow: Sentry -> Codebases -> Messages (uses: sentry) [trigger: schedule]
- **telegram-ops-command-center** — Turns Telegram into an AI-powered operational control plane -- team members send natural language commands to check service health, trigger deployments, rollback releases, and broadcast alerts, with destructive actions gated by confirmation prompts and critical alerts routed to Slack. — flow: Telegram -> Slack (uses: telegram,slack,operations_api) [trigger: webhook,schedule]
- **workflow-error-intelligence** — Monitors all persona executions for errors, uses AI to classify root causes, detect failure patterns across workflows, suggest remediations, and deliver daily error digests and weekly reliability reports -- the agent that watches the agents. — flow: Slack (uses: slack) [trigger: event,polling,schedule,schedule]

### email (1)

- **intake-processor** — Monitors Gmail for important emails, posts summaries to relevant Slack channels based on sender/topic, and creates structured Notion database entries for tracking. Learns sender patterns over time via agent memory. — flow: Gmail -> Slack -> Notion (uses: gmail,slack,notion) [trigger: polling]

### finance (11)

- **accounting-reconciliation-use-case** — Pulls Xero transactions daily, reconciles against bank feeds, logs discrepancies to Google Sheets, sends Slack alerts for unmatched transactions, and emails a weekly reconciliation summary to the finance team. — flow: Xero -> Google Sheets -> Slack -> Gmail (uses: xero,gmail,google_sheets,slack) [trigger: schedule]
- **budget-spending-monitor** — Monitors cloud service spending weekly by pulling billing data from your cloud provider API, comparing against configurable threshold parameters, and alerting via Messages only when unusual spending is detected. Learns from past budget exceedances via Memory to recognize recurring cost patterns. — flow: Cloud Billing API -> Messages (uses: cloud_billing) [trigger: schedule]
- **expense-receipt-processor** — Monitors Gmail for receipt and invoice attachments, uses AI to extract vendor, amount, date, and category from documents, logs expenses to Google Sheets, posts weekly summaries to Slack, and flags anomalies like duplicates or unusual amounts. — flow: Gmail -> Google Sheets -> Slack (uses: gmail,google_sheets,slack) [trigger: polling,schedule]
- **finance-controller** — Syncs QuickBooks invoices and expenses to Google Sheets daily, detects overdue invoices and sends payment reminders via Gmail, flags unusual transactions for review, and posts weekly cash flow summaries to Slack. — flow: QuickBooks -> Google Sheets -> Gmail -> Slack (uses: quickbooks,gmail,google_sheets,slack) [trigger: schedule,polling,schedule]
- **financial-stocks-signaller** — Analyzes stock market data weekly using technical indicators (RSI, MACD) and news sentiment from Alpha Vantage, generates Buy/Sell/Hold signals, delivers structured reports via Messages, and learns from human review to improve signal quality over time. — flow: Alpha Vantage -> Messages (uses: alpha_vantage) [trigger: schedule]
- **freelancer-invoice-autopilot** — Generates professional invoices monthly by pulling time entries from your time tracking tool, applying your hourly rate and tax settings, rendering an HTML invoice from a template artifact, and saving the output for delivery. The building process creates a custom HTML invoice template based on your business details. — flow: Time Tracking Tool -> Messages (uses: time_tracking) [trigger: schedule]
- **invoice-tracker** — Automatically detects invoices arriving in Gmail, extracts structured data (vendor, amount, due date, invoice number), maintains a payment tracking database, monitors upcoming and overdue payments, and sends timely alerts. Learns vendor-specific patterns over time to improve extraction accuracy. — flow: Gmail -> Local Database -> Messages (uses: gmail) [trigger: polling,schedule]
- **personal-finance-use-case** — Connects to bank accounts via Plaid, categorizes transactions, logs them to Google Sheets, sends weekly spending summaries to Slack/email, and alerts on unusual charges or when budget categories are exceeded. — flow: Plaid -> Google Sheets -> Slack -> Gmail (uses: plaid,gmail,google_sheets,slack) [trigger: schedule,schedule]
- **revenue-intelligence-copilot** — Connects Stripe payment events with HubSpot CRM context to power AI-driven churn prediction, expansion signal detection, and account health scoring. Monitors payment failures, subscription changes, and refunds while cross-referencing customer engagement data to surface actionable revenue intelligence via Slack alerts and Gmail outreach. — flow: Stripe -> HubSpot -> Gmail -> Slack (uses: stripe,hubspot,gmail,slack) [trigger: polling,schedule]
- **revenue-operations-hub** — Processes Stripe webhook events (new subscriptions, cancellations, failed payments, refunds), updates an Airtable revenue tracker, sends personalized customer emails for payment failures, and posts daily revenue summaries. — flow: Stripe -> Airtable -> Gmail (uses: stripe,airtable,gmail) [trigger: webhook,schedule]
- **subscription-billing-use-case** — Processes Paddle subscription events (new, renewal, cancellation, payment failure), maintains customer records in Airtable, sends dunning emails for failed payments, posts revenue events to Slack, and generates monthly MRR reports. — flow: Paddle -> Airtable -> Slack -> Gmail (uses: paddle,airtable,slack,gmail) [trigger: webhook,schedule]

### hr (2)

- **onboarding-tracker** — Automates the full new hire onboarding lifecycle through Notion-based checklists -- detects new employees, generates role-adaptive task lists with milestone deadlines (30/60/90 days), sends proactive reminders before tasks go overdue, tracks completion progress across stakeholders, and celebrates successful onboarding completion with summary reports. — flow: Notion -> Local Database -> In-App Messaging (uses: notion) [trigger: polling,schedule,schedule]
- **recruiting-pipeline-use-case** — Monitors Greenhouse for candidate stage transitions, sends personalized emails at each stage (acknowledgment, interview prep, rejection, offer), posts updates to hiring Slack channels, and compiles weekly recruiting funnel metrics. — flow: Greenhouse -> Gmail -> Slack (uses: greenhouse,gmail,slack) [trigger: polling,schedule]

### legal (3)

- **ai-contract-reviewer** — Analyzes contract documents using AI to extract key terms, financial obligations, risk factors, and red flags, creates structured review reports in Notion, alerts on high-risk clauses, and sends deadline reminders for renewals and obligations. — flow: Gmail -> Notion -> Slack (uses: gmail,notion,slack) [trigger: polling,webhook,schedule]
- **contract-lifecycle-use-case** — Tracks DocuSign envelope events (sent, viewed, signed, declined), updates Airtable contract tracker, posts Slack notifications on status changes, sends reminder emails for unsigned documents, and flags contracts approaching renewal. — flow: DocuSign -> Airtable -> Slack -> Gmail (uses: docusign,airtable,slack,gmail) [trigger: webhook,schedule,schedule]
- **editorial-calendar-manager** — Reads the Notion editorial calendar, syncs deadlines and assignments to Airtable for tracking, sends reminder emails to writers approaching deadlines, posts status reports, and flags content gaps in the schedule. — flow: Notion -> Airtable -> Gmail (uses: notion,airtable,gmail) [trigger: schedule,polling]

### marketing (2)

- **visual-brand-asset-factory** — Generates on-brand visual assets by analyzing your codebase for brand/visual philosophy, generating images via an AI image connector, evaluating results with a multimodal AI connector in a quality loop, and presenting final assets for human review. Learns visual preferences from approval/rejection patterns over time. — flow: Codebase -> Image AI -> Multimodal AI -> Messages (uses: image_ai,multimodal_ai)
- **web-marketing** — Weekly marketing intelligence agent that pulls campaign performance data from your ad platform, SEO metrics from your analytics tool, and cross-references with historical memory to generate optimization proposals. Delivers structured reports via Messages and learns from accepted/rejected proposals to improve recommendations over time. — flow: Ad Platform -> Analytics Tool -> Messages (uses: ad_platform,analytics_tool) [trigger: schedule]

### productivity (12)

- **appointment-orchestrator** — Processes new Calendly bookings, creates/updates HubSpot contacts and deals, sends confirmation emails with custom prep materials, and notifies the team in Slack. Sends reminders 24h before and follow-ups 24h after. — flow: Calendly -> HubSpot -> Gmail -> Slack (uses: calendly,hubspot,gmail,slack) [trigger: webhook,schedule]
- **daily-standup-compiler** — Connects to Notion project databases daily to compile team standup reports from task status changes. Groups updates by team member, detects blockers and stalled tasks, tracks velocity trends over time, and delivers structured reports via Messages. Learns team rhythm patterns to surface anomalies like missing contributors, sprint bottlenecks, and capacity imbalances. — flow: Notion (uses: notion) [trigger: schedule]
- **digital-clone** — Multi-channel communication proxy across Gmail, Slack, and Telegram that reads incoming messages, drafts context-aware replies matching your personal style, and routes drafts for human approval before sending. Logs all conversations to a local database and learns your tone, formality, and vocabulary per recipient over time -- graduating to auto-send after 20 consecutive unadjusted approvals per contact. — flow: Gmail -> Slack -> Telegram -> Built-in Database (uses: gmail,slack,telegram,personas_database) [trigger: polling,schedule,manual]
- **email-follow-up-tracker** — Monitors outbound Gmail threads and sends Slack reminders when emails go unanswered past a configurable threshold. Supports VIP prioritization, automatic resolution on reply detection, and scheduled scanning with on-demand checks for time-sensitive threads. — flow: Gmail -> Slack (uses: gmail,slack) [trigger: schedule,manual]
- **email-morning-digest** — Fetches unread emails each morning, scores them by adaptive sender importance and content signals, summarizes the top messages into a structured digest, and delivers it as a notification. Learns sender patterns over time to progressively personalize what surfaces first. — flow: Gmail (uses: gmail) [trigger: schedule,manual]
- **email-task-extractor** — Intelligent email-to-task agent that scans Gmail for actionable content, extracts tasks with due dates and assignees using NLP pattern matching, creates structured Notion database entries, and progressively learns your team's communication patterns to improve extraction accuracy over time. — flow: Gmail -> Notion -> Messages (uses: gmail,notion) [trigger: schedule,manual]
- **idea-harvester** — Extracts, analyzes, and categorizes ideas from any source (blog posts, web resources, YouTube transcriptions, documents) into structured backlog items. Uses the codebase connector to assess feasibility, effort, and benefit of each idea, then generates backlog items for human triage with per-item Messages and Memory-driven learning. — flow: Input Source -> Codebase -> Messages
- **meeting-lifecycle-manager** — Monitors your Google Calendar for upcoming meetings. Sends prep reminders with agenda and attendee context 30 min before. Posts "in meeting" status to Slack. After meetings, prompts for notes and distributes action items via email. — flow: Google Calendar -> Gmail -> Slack (uses: gmail,google_calendar,slack) [trigger: polling,schedule,manual]
- **personal-capture-bot** — Receives messages from your Telegram bot (ideas, bookmarks, tasks, notes), classifies them by type using AI, routes tasks to Airtable, saves notes/ideas to Notion, and sends a confirmation reply. Compiles a daily capture digest. — flow: Telegram -> Notion -> Airtable (uses: telegram,notion,airtable) [trigger: polling,schedule]
- **router** — Acts as a universal webhook receiver that replaces Zapier entirely for simple automations. Accepts any webhook payload, uses AI reasoning to classify the event type, and routes to the appropriate service (Slack, email, Notion, Airtable, etc.) based on configurable rules. — flow: Zapier Webhook -> Multi-Service (uses: slack,notion,airtable,gmail,google_sheets) [trigger: webhook]
- **survey-insights-analyzer** — Processes new survey responses from a local database on a configurable schedule, applies sentiment analysis and theme extraction, compares trends across periods, and delivers structured insight reports via in-app messaging with optional Notion archival. — flow: Local Database -> In-App Messaging [trigger: schedule,manual]
- **survey-processor** — Polls Google Forms for new responses, processes and scores answers, adds structured records to Airtable, posts response summaries to Slack, and sends personalized thank-you/follow-up emails based on responses. — flow: Google Forms -> Airtable -> Slack -> Gmail (uses: gmail,google_sheets,airtable,slack) [trigger: polling,manual]

### project-management (3)

- **client-portal-orchestrator** — Manages the full client lifecycle from signup to project completion. Captures new client signups via webhook, runs email verification, builds a relational project hub in Notion with linked Client and Project databases, sends AI-generated milestone emails at every project phase, posts team updates to Telegram, flags stalled projects via Slack, and generates monthly portfolio reports. — flow: Notion -> Gmail -> Telegram -> Slack (uses: notion,gmail,telegram,slack) [trigger: webhook,webhook,polling,polling,schedule,schedule]
- **deadline-synchronizer** — Watches Trello boards for cards with due dates, creates/updates Google Calendar events for each, sends Slack reminders as deadlines approach, and moves overdue cards to a "Blocked" list with a comment explaining the delay. — flow: Trello -> Google Calendar -> Slack (uses: trello,google_calendar,slack) [trigger: polling]
- **technical-decision-tracker** — Architecture Decision Record (ADR) specialist that documents engineering decisions with full context, alternatives analysis, stakeholder sign-off, and implementation impact in a structured Notion database. Maintains a searchable decision history, links decisions to code changes, and runs periodic review cycles to prevent decision amnesia. — flow: Notion -> GitHub -> Messages (uses: notion,github) [trigger: manual,schedule]

### research (12)

- **ai-research-report-generator** — Accepts research topics via webhook or Telegram, searches multiple web sources, synthesizes findings into structured reports using AI, stores them in Notion, and delivers via email and Telegram with full source citations. — flow: Telegram -> Notion -> Gmail (uses: telegram,notion,gmail,news_api) [trigger: webhook,polling]
- **ai-weekly-research** — Researches trending AI topics weekly, stores findings in a local knowledge base, and produces a concise briefing summary. No external connectors required -- runs entirely with built-in tools. — flow: LLM Research -> Database -> Messaging [trigger: schedule,manual]
- **conversational-database-analyst** — Answers business questions in plain English by generating SQL queries against your database, returning formatted results via Slack or Telegram, with schema introspection, conversation memory, and read-only safety. — flow: Slack -> Telegram (uses: supabase,slack,telegram) [trigger: webhook,polling,schedule,schedule]
- **customer-event-intelligence** — Receives Segment events via webhook, enriches user profiles with behavioral data, detects high-intent signals (pricing page visits, feature activation), notifies sales in Slack with context, and logs signal patterns in Notion. — flow: Segment -> Slack -> Notion (uses: segment,slack,notion) [trigger: webhook]
- **database-performance-monitor** — Continuous database performance monitoring agent that builds adaptive baselines over a 7-day learning period, then detects anomalies by comparing real-time metrics against rolling statistical baselines. Uses multi-metric correlation across response time, throughput, connection pool usage, and lock contention to distinguish genuine degradation from normal variance. Alerts are severity-tiered: informational summaries, warning notifications with context, and critical escalations requiring human acknowledgment before automated remediation. — flow: Local Database (uses: database) [trigger: schedule]
- **industry-intelligence-aggregator** — Fetches multiple RSS feeds (industry blogs, competitors, news), extracts and deduplicates articles, creates structured Notion entries with AI-generated summaries, emails a daily intelligence briefing, and posts breaking news to Slack. — flow: RSS -> Notion -> Gmail -> Slack (uses: notion,gmail,slack) [trigger: schedule,polling]
- **product-analytics-briefer** — Pulls key Mixpanel metrics daily, compares against goals and historical trends, generates plain-English insights, posts a morning analytics briefing to Slack, and maintains a Notion analytics log for longitudinal tracking. — flow: Mixpanel -> Slack -> Notion (uses: mixpanel,slack,notion) [trigger: schedule]
- **product-scout** — Scans Gmail weekly for emails from configured senders, extracts implementation opportunities (new connectors, API versions, tooling integrations) for the Personas platform, enriches findings with web research, posts triage cards to Slack with accept/reject buttons, and learns topic preferences from human decisions over time. — flow: Gmail -> Web Search -> Built-in Database -> Slack (uses: gmail,slack,personas_database) [trigger: schedule,manual]
- **product-signal-detector** — Analyzes Amplitude user behavior data for significant changes (drop-offs, feature adoption spikes, funnel breakages), posts insight cards to Slack product channels, and auto-creates Linear investigation tickets for anomalies. — flow: Amplitude -> Slack -> Linear (uses: amplitude,slack,linear) [trigger: schedule,schedule]
- **research-knowledge-curator** — Processes web URLs into richly structured Notion knowledge base pages with AI-powered summarization, intelligent multi-dimensional tagging, and automatic cross-referencing to related entries. Supports manual URL submission, scheduled RSS/feed scanning, and batch processing of URL lists. — flow: Notion (uses: notion) [trigger: manual,schedule,schedule]
- **research-paper-indexer** — Systematically monitors academic databases (arXiv, PubMed, IEEE Xplore, Semantic Scholar) for research papers matching configurable keyword groups, generates AI-powered summaries with structured key findings, maintains a deduplicated searchable index, and surfaces weekly trend reports across your research domains. — flow: Local Database [trigger: schedule,schedule,manual]
- **website-market-intelligence-profiler** — Scrapes and analyzes a list of websites using AI to classify industry, audience, business model, and value proposition, building a structured market intelligence database in Google Sheets with landscape summary reports. — flow: Google Sheets -> Slack (uses: google_sheets,slack) [trigger: manual,schedule]

### sales (12)

- **contact-enrichment-agent** — Contact intelligence agent that enriches CRM database records by mining Gmail communications for signature data, analyzing correspondence patterns, and building progressive contact profiles with confidence-scored updates, conflict detection, and auditable change history. — flow: Gmail -> Local Database -> Messages (uses: gmail,personas_database) [trigger: schedule,schedule]
- **contact-sync-manager** — Automatically extracts contact information from Gmail email signatures using pattern recognition and NLP, maintains a living contact database with confidence scoring, change tracking, and conflict resolution. Replaces manual CRM data entry with intelligent, continuous contact harvesting. — flow: Gmail -> Local Database (uses: gmail) [trigger: polling,schedule,event]
- **crm-data-quality-auditor** — Scans HubSpot CRM weekly for duplicates, stale records, missing fields, and data inconsistencies, uses AI to generate fix recommendations, auto-repairs safe issues, flags risky changes for review, and tracks data quality score over time. — flow: HubSpot -> Notion -> Slack (uses: hubspot,notion,slack) [trigger: schedule,schedule]
- **email-lead-extractor** — Scans incoming Gmail for sales opportunities, extracts structured contact data using NLP parsing, scores and qualifies each lead with progressive signals, prevents duplicates against a local ledger, and routes high-value leads for human review while logging every extraction to an audit-ready database. — flow: Gmail -> Local Database (uses: gmail) [trigger: polling,manual]
- **lead-capture-pipeline** — Processes Typeform submissions in real-time, scores leads based on responses, adds them to Airtable with qualification status, sends personalized welcome emails, and notifies the sales team in Slack for hot leads. — flow: Typeform -> Airtable -> Gmail -> Slack (uses: typeform,airtable,gmail,slack) [trigger: webhook,polling]
- **outbound-sales-intelligence-pipeline** — Takes raw prospect lists, verifies emails, enriches person and company data through multiple intelligence APIs, uses AI to generate personalized outreach drafts with role-specific pain points, and delivers enriched profiles back to Google Sheets. — flow: Google Sheets -> Slack (uses: hunter,clearbit,google_sheets,slack) [trigger: polling,schedule]
- **personality-enriched-sales-prep** — Analyzes meeting attendees' communication style, decision-making patterns, and motivations through AI-driven behavioral profiling, delivers personalized conversation strategies and things-to-avoid via Notion briefings and Slack reminders before each meeting. — flow: Gmail -> Notion -> Slack (uses: gmail,google_calendar,notion,slack) [trigger: polling,webhook,schedule]
- **sales-deal-analyzer** — Performs monthly win/loss analysis across all closed deals, applying multi-dimensional statistical segmentation by deal size, industry, sales rep, timeline, lead source, and stage progression to surface actionable patterns. Documents findings in a structured Notion knowledge base and progressively learns from historical trends to sharpen future recommendations. — flow: Local Database -> Notion (uses: notion) [trigger: schedule]
- **sales-deal-tracker** — Monitors Salesforce deal pipeline in real time by polling Opportunity records for stage transitions, amount changes, and close date shifts. Detects when deals advance, regress, or stall across all pipeline stages, sends immediate contextual alerts with win probability and revenue impact, compiles daily pipeline summaries with stage distribution and velocity metrics, and progressively learns deal patterns to predict at-risk deals before they slip. — flow: Salesforce (uses: salesforce) [trigger: polling,schedule]
- **sales-pipeline-autopilot** — Monitors HubSpot deal stage changes, sends personalized follow-up emails via Gmail at each stage, posts deal updates to Slack sales channels, and flags stale deals. Compiles weekly pipeline health reports. — flow: HubSpot -> Gmail -> Slack (uses: hubspot,gmail,slack) [trigger: polling,schedule]
- **sales-proposal-generator** — Monitors your deal pipeline for new opportunities, researches prospect companies via web intelligence, and generates personalized, industry-aware sales proposals in Notion with executive summaries, needs analysis, solution mapping, timelines, and pricing. Every proposal is flagged for human review before delivery, with progressive template learning from approval patterns. — flow: Local Database -> Web Search -> Notion (uses: notion) [trigger: polling,manual]
- **sheets-e-commerce-command-center** — Monitors Shopify for new orders, low inventory, and refund requests. Logs all orders to Google Sheets, sends Slack alerts for high-value orders and stock warnings, and generates daily sales digests. — flow: Shopify -> Slack -> Google Sheets (uses: shopify,slack,google_sheets) [trigger: polling,schedule]

### security (3)

- **access-request-manager** — Security access governance agent that monitors Gmail for access request emails, processes them through structured multi-level approval workflows (manager then admin), maintains a complete audit trail in the local database, enforces configurable timeout escalation policies, and delivers status notifications to requestors and approvers via in-app messaging. — flow: Gmail -> Local Database -> In-App Messaging (uses: gmail) [trigger: polling]
- **brand-protection-sentinel** — Monitors for lookalike domains and brand impersonation by generating typosquat variations, checking DNS/WHOIS data, analyzing hosted content with AI, and alerting on high-threat phishing or trademark abuse with automated abuse report generation. — flow: Notion -> Slack (uses: whoisxml,notion,slack) [trigger: schedule,schedule]
- **security-vulnerability-pipeline** — Monitors GitHub repos for new commits, triggers Snyk vulnerability scans, correlates results with existing Jira security tickets, posts new findings to Slack, and creates Jira tickets for untracked vulnerabilities with severity-based priority. — flow: GitHub -> Snyk -> Slack -> Jira (uses: github,snyk,jira,slack) [trigger: webhook,schedule,schedule]

### support (6)

- **customer-feedback-router** — Captures new Intercom conversations, extracts feature requests and bug reports, creates Linear issues with proper labels, and posts a Slack summary. Deduplicates against existing Linear issues using agent memory. — flow: Intercom -> Slack -> Linear (uses: intercom,slack,linear) [trigger: polling,schedule]
- **email-support-assistant** — Processes incoming customer support emails against a structured knowledge base, sends confidence-gated auto-replies for well-matched questions, routes uncertain cases through human review with full context, and progressively learns from approved and rejected drafts to improve response accuracy over time. — flow: Gmail -> Knowledge Base -> Messages (uses: gmail) [trigger: polling,schedule]
- **knowledge-base-review-cycle-manager** — Scans a Notion knowledge base for articles due for periodic review. Assigns reviewers from a rotation, sends email reminders, posts review status to Slack, tracks completion, and updates the "Last Reviewed" date on completion. — flow: Notion -> Slack -> Gmail (uses: notion,slack,gmail) [trigger: schedule,schedule]
- **support-email-router** — Processes incoming Gmail support emails with AI-powered priority classification, creates structured Notion tickets with SLA deadlines, monitors approaching SLA breaches for proactive escalation, and learns from triage feedback to improve categorization accuracy over time. — flow: Gmail -> Notion -> Messages (uses: gmail,notion) [trigger: polling]
- **support-escalation-engine** — Monitors Freshdesk for tickets exceeding response time SLAs, escalates to Slack with full ticket context, logs escalation patterns in Notion, and emails the support lead with a daily escalation summary. Auto-prioritizes based on customer tier. — flow: Freshdesk -> Slack -> Notion -> Gmail (uses: freshdesk,slack,notion,gmail) [trigger: polling,schedule]
- **support-intelligence-use-case** — Triages incoming Zendesk tickets by analyzing content and sentiment. Routes urgent issues to Slack with context. Maintains a Notion knowledge base of common resolutions. Auto-suggests responses for known issues and escalates unknowns for manual review. — flow: Zendesk -> Slack -> Notion (uses: zendesk,slack,notion) [trigger: polling]

---

## Connector Catalog (87)

### ai (3)

- **elevenlabs** (API Key, freemium) — ElevenLabs AI voice generation, text-to-speech, and audio processing platform.
- **gemini_vision** (API Key, freemium) — Google Gemini Vision API for OCR, document understanding, and image analysis. Supports images and PDFs natively with up to 3,600 pages per request.
- **leonardo_ai** (API Key, freemium) — Leonardo AI generative image and video platform for creative content.

### analytics (4)

- **google_ads** (OAuth, freemium) — Google Ads campaign management for creating, monitoring, and optimizing advertising campaigns via the Google Ads REST API.
- **mixpanel** (Service Account, paid) — Mixpanel product analytics with GDPR-compliant data access.
- **posthog** (API Key, free) — PostHog product analytics, feature flags, session replay, and A/B testing.
- **twilio_segment** (Write Key, paid) — Twilio Segment customer data platform for event tracking and routing.

### automation (3)

- **github_actions** (PAT, ?) — GitHub Actions CI/CD -- dispatch workflows, check run status, and manage automations from your agent.
- **n8n** (API Key, ?) — n8n workflow automation platform -- connect to push, activate, and trigger workflows directly from your agent.
- **zapier** (API Key, ?) — Zapier automation platform -- trigger Zaps via webhooks and manage workflows from your agent.

### cloud (4)

- **cloudflare** (API Token, free) — Cloudflare CDN, DNS, Workers, and security services.
- **kubernetes** (Bearer Token, free) — Kubernetes container orchestration for managing clusters, pods, and deployments.
- **netlify** (PAT, free) — Netlify web deployment platform with serverless functions and form handling.
- **vercel** (PAT, free) — Vercel frontend deployment platform with serverless functions and edge network.

### crm (3)

- **attio** (PAT, freemium) — Attio next-gen CRM for managing people, companies, deals, and custom objects via the Attio API v2.
- **hubspot** (PAT, paid) — HubSpot CRM for contacts, deals, marketing automation, and sales pipelines.
- **pipedrive** (API Key, paid) — Pipedrive CRM for managing deals, contacts, activities, and sales pipelines via the Pipedrive REST API.

### database (15)

- **airtable** (PAT, free) — Airtable spreadsheet-database for project tracking and data management.
- **convex** (Deploy Key, free) — Convex real-time backend-as-a-service with document database, serverless functions, and scheduling.
- **duckdb** (Database Path, free) — DuckDB embedded analytical database for OLAP workloads, Parquet, CSV, and JSON.
- **google_sheets** (OAuth, freemium) — Google Sheets spreadsheet-as-database for reading, writing, and managing structured data via the Sheets API v4.
- **microsoft_excel** (OAuth, freemium) — Microsoft Excel spreadsheet automation for reading, writing, and managing workbook data via the Microsoft Graph API.
- **mongodb** (Connection String, free) — MongoDB document database with flexible schemas, aggregation pipelines, and Atlas cloud.
- **neon** (API Key, free) — Neon serverless Postgres with branching, autoscaling, and bottomless storage.
- **notion** (PAT, free) — Notion workspace for knowledge bases, wikis, and project management.
- **personas_database** (Built-in, ?) — Local SQLite database managed by Personas. Available on first launch -- agents can create tables, store data, and run SQL queries without any external service.
- **personas_vector_db** (Built-in (Local), ?) — Local vector knowledge base powered by sqlite-vec. Store documents, create embeddings locally, and run semantic search — entirely offline, no API keys needed.
- **planetscale** (Service Token, paid) — PlanetScale serverless MySQL platform with branching and non-blocking schema changes.
- **postgres** (Connection String, free) — PostgreSQL open-source relational database with advanced SQL, JSONB, and extensibility.
- **redis** (Connection URL, free) — Redis in-memory data store for caching, queues, sessions, and real-time pub/sub.
- **supabase** (API Key, free) — Supabase open-source Firebase alternative with Postgres, auth, and realtime.
- **upstash** (REST Token, free) — Upstash serverless Redis and Kafka for low-latency data at the edge.

### design (3)

- **canva** (PAT, freemium) — Canva design platform for creating, managing, and exporting designs via the Canva Connect API.
- **figma** (PAT, free) — Figma collaborative design tool for UI/UX, prototyping, and design systems.
- **penpot** (PAT, free) — Penpot open-source design platform for prototyping, components, and design tokens.

### desktop (1)

- **desktop_browser** (Local App, ?) — Browser automation via Chrome DevTools Protocol -- navigate pages, extract data, and automate web tasks.

### devops (7)

- **azure_devops** (PAT, freemium) — Azure DevOps for repositories, work items, pipelines, and CI/CD.
- **circleci** (PAT, free) — CircleCI continuous integration and delivery platform.
- **desktop_docker** (Desktop Bridge, free) — Docker container management -- list, start, stop, inspect containers and run compose stacks via desktop bridge.
- **desktop_terminal** (Desktop Bridge, free) — System terminal access -- execute commands, read/write files, and navigate the filesystem via desktop bridge.
- **desktop_vscode** (Desktop Bridge, free) — VS Code editor integration -- open files, manage extensions, run tasks, and diff via desktop bridge.
- **github** (PAT, free) — GitHub for repositories, issues, pull requests, and CI/CD.
- **gitlab** (PAT, free) — GitLab for repositories, CI/CD pipelines, issues, and merge requests.

### ecommerce (2)

- **lemonsqueezy** (API Key, freemium) — Lemon Squeezy digital commerce platform for selling digital products, subscriptions, and SaaS via the Lemon Squeezy API v1.
- **woocommerce** (API Key, free) — WooCommerce open-source e-commerce platform for managing orders, products, and customers via the WooCommerce REST API v3.

### email (5)

- **gmail** (OAuth, freemium) — Gmail email automation for reading, sending, and managing messages via the Gmail API v1.
- **microsoft_outlook** (OAuth, freemium) — Microsoft Outlook email, calendar, and contacts automation via the Microsoft Graph API.
- **resend** (API Key, free) — Resend modern email API for developers with React Email support.
- **sendgrid** (API Key, free) — SendGrid transactional and marketing email delivery at scale.
- **twilio_sms** (Account SID, paid) — Twilio SMS, voice, WhatsApp, and communication APIs.

### finance (1)

- **alpha_vantage** (API Key, freemium) — Alpha Vantage for real-time and historical stock, forex, crypto, and economic data.

### forms (2)

- **formbricks** (API Key, free) — Formbricks open-source survey and feedback platform for in-app surveys, links, and website pop-ups.
- **tally** (PAT, freemium) — Tally free-first form builder for creating forms, surveys, and collecting responses via the Tally API.

### integration (2)

- **codebase** (Project, ?) — Access local codebases registered in Dev Tools. Provides file access, context maps for quick orientation, and idea/task management for backlog tracking. Enables agents to read, search, analyze project files, create and triage ideas, and execute implementation tasks.
- **codebases** (All Projects, ?) — Aggregate view across all Dev Tools projects. Provides cross-project impact analysis, unified code search, dependency graph comparison, an agent-driven implementation pipeline (branching, diffing, testing, committing), and portfolio-level intelligence (health scores, tech radar, risk matrix). Designed as a composable puzzle piece for agentic workflows.

### messaging (5)

- **discord** (Bot Token, free) — Discord bot integration for server messaging, moderation, and notifications.
- **microsoft_teams** (OAuth, freemium) — Microsoft Teams messaging for sending messages, managing channels, and team collaboration via the Microsoft Graph API.
- **personas_messages** (Built-in (Local), ?) — Built-in in-app messaging channel. Agents can send notifications and messages to the Personas inbox without external services.
- **slack** (Bot Token, free) — Slack workspace messaging for channels, DMs, and workflow notifications.
- **telegram** (Bot Token, free) — Telegram bot for messaging, notifications, and group automation.

### monitoring (2)

- **betterstack** (PAT, paid) — Better Stack uptime monitoring, incident management, and status pages.
- **sentry** (PAT, free) — Sentry application monitoring for errors, performance, and session replay.

### notifications (3)

- **knock** (API Key, freemium) — Knock notification infrastructure for orchestrating cross-channel notifications with preferences and workflows.
- **novu** (API Key, freemium) — Novu open-source notification infrastructure for in-app, email, SMS, push, and chat notifications via the Novu API.
- **ntfy** (Access Token, free) — ntfy open-source push notification service for sending notifications to phones and desktops via simple HTTP.

### productivity (6)

- **confluence** (API Token, paid) — Confluence wiki and knowledge base for team documentation and collaboration.
- **desktop_obsidian** (Desktop Bridge, free) — Obsidian note-taking integration -- read, write, search, and navigate your knowledge vault via desktop bridge.
- **google_workspace_oauth_template** (OAuth, ?) — Google Workspace consent-first template for Gmail, Drive, and Calendar automation.
- **obsidian** (API Key, free) — Obsidian vault access via the Local REST API plugin for reading, writing, and searching notes.
- **onedrive** (OAuth, freemium) — OneDrive file storage and document management for uploading, downloading, and organizing files via the Microsoft Graph API.
- **sharepoint** (OAuth, freemium) — SharePoint document management and team sites for storing, organizing, and collaborating on content via the Microsoft Graph API.

### project-mgmt (5)

- **asana** (PAT, freemium) — Asana project management for tasks, projects, and team collaboration.
- **clickup** (PAT, free) — ClickUp project management with tasks, docs, goals, and time tracking.
- **jira** (API Token, paid) — Jira issue tracking and project management for agile software teams.
- **linear** (PAT, free) — Linear issue tracking for software teams with cycles, projects, and triage.
- **monday** (PAT, paid) — Monday.com work management platform for projects, workflows, and CRM.

### scheduling (4)

- **cal_com** (API Key, freemium) — Cal.com open-source scheduling platform for availability and bookings.
- **calendly** (PAT, free) — Calendly scheduling for meetings and appointment automation.
- **google_calendar** (OAuth, freemium) — Google Calendar scheduling for creating, reading, and managing calendar events via the Calendar API v3.
- **microsoft_calendar** (OAuth, freemium) — Microsoft Outlook Calendar scheduling for creating, reading, and managing calendar events via the Microsoft Graph API.

### social (2)

- **buffer** (PAT, free) — Buffer social media management for scheduling and publishing.
- **linkedin** (OAuth, free) — LinkedIn professional network for profile, connections, and social posts.

### storage (4)

- **aws_s3** (Access Key, freemium) — AWS S3 object storage for uploading, downloading, and managing files and buckets.
- **backblaze_b2** (Application Key, freemium) — Backblaze B2 affordable S3-compatible cloud object storage for backups, archives, and media.
- **cloudflare_r2** (API Token, freemium) — Cloudflare R2 S3-compatible object storage with zero egress fees for storing and serving files.
- **dropbox** (Access Token, free) — Dropbox cloud storage for file sync, sharing, and collaboration.

### support (1)

- **crisp** (Token Pair, freemium) — Crisp customer messaging platform for live chat, helpdesk, and knowledge base via the Crisp REST API.

---

## Coverage Analysis

### Template categories by density

- development: 12  (well-covered)
- productivity: 12  (well-covered)
- research: 12  (well-covered)
- sales: 12  (well-covered)
- finance: 11  (well-covered)
- content: 8  (well-covered)
- support: 6
- devops: 5
- legal: 3
- project-management: 3
- security: 3
- hr: 2  ← **sparse, gap candidate**
- marketing: 2  ← **sparse, gap candidate**
- email: 1  ← **sparse, gap candidate**

### Connector categories by density

- database: 15  (well-covered)
- devops: 7
- productivity: 6
- email: 5
- messaging: 5
- project-mgmt: 5
- analytics: 4
- cloud: 4
- scheduling: 4
- storage: 4
- ai: 3
- automation: 3
- crm: 3
- design: 3
- notifications: 3
- ecommerce: 2  ← **sparse, gap candidate**
- forms: 2  ← **sparse, gap candidate**
- integration: 2  ← **sparse, gap candidate**
- monitoring: 2  ← **sparse, gap candidate**
- social: 2  ← **sparse, gap candidate**
- desktop: 1  ← **sparse, gap candidate**
- finance: 1  ← **sparse, gap candidate**
- support: 1  ← **sparse, gap candidate**

### Auth type distribution

- PAT: 23
- API Key: 19
- OAuth: 12
- API Token: 4
- Desktop Bridge: 4
- Bot Token: 3
- Connection String: 2
- Built-in (Local): 2
- Access Token: 2
- Service Account: 1
- Write Key: 1
- Bearer Token: 1
- Deploy Key: 1
- Database Path: 1
- Built-in: 1
- Service Token: 1
- Connection URL: 1
- REST Token: 1
- Local App: 1
- Account SID: 1
- Project: 1
- All Projects: 1
- Access Key: 1
- Application Key: 1
- Token Pair: 1
