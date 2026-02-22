# 100 Persona / Agent Template Ideas

Pre-configured agent blueprints for the Personas Desktop template system. Each entry includes a name, description, suggested tools, trigger type, and category.

---

## Email & Communication

**1. Inbox Triage Agent**
Categorizes incoming emails by urgency and topic, auto-labels them, and surfaces only high-priority items for your attention.
`Tools: gmail_read, gmail_search, gmail_mark_read` · `Trigger: polling (60s)` · `Category: Email`

**2. Email Follow-Up Enforcer**
Tracks sent emails that haven't received replies after a configurable period and drafts polite follow-up reminders.
`Tools: gmail_search, gmail_send` · `Trigger: schedule (daily 9am)` · `Category: Email`

**3. Newsletter Digest Compiler**
Reads newsletters that arrived overnight, extracts the key insights from each, and compiles a single morning briefing email.
`Tools: gmail_read, gmail_search, gmail_send` · `Trigger: schedule (daily 7am)` · `Category: Email`

**4. Cold Email Responder**
Detects unsolicited outreach, classifies it (sales, recruiting, spam, genuine), and drafts appropriate responses or archives silently.
`Tools: gmail_read, gmail_send, gmail_mark_read` · `Trigger: polling (120s)` · `Category: Email`

**5. Meeting Request Negotiator**
Intercepts calendar meeting requests, checks availability, and either accepts or proposes alternative times.
`Tools: gmail_read, gmail_send, http_request` · `Trigger: polling (60s)` · `Category: Email`

**6. Email Template Expander**
Detects short draft replies containing shortcodes (e.g., `/thanks`, `/intro`) and expands them into full, polished messages.
`Tools: gmail_read, gmail_send` · `Trigger: polling (30s)` · `Category: Email`

**7. Unsubscribe Cleaner**
Periodically scans for mailing list emails you never open and compiles a batch unsubscribe action list.
`Tools: gmail_search, gmail_mark_read, http_request` · `Trigger: schedule (weekly Sunday)` · `Category: Email`

**8. Client Communication Logger**
Monitors emails from key client domains and logs interaction summaries to a CRM file or HTTP endpoint.
`Tools: gmail_search, gmail_read, http_request, file_write` · `Trigger: polling (300s)` · `Category: Email`

---

## Development & Code

**9. GitHub PR Review Summarizer**
Polls for new pull requests, reads diffs, and posts a summary comment with potential issues flagged.
`Tools: http_request` · `Trigger: polling (120s)` · `Category: Development`

**10. Dependency Update Watchdog**
Checks package registries for outdated dependencies in your project and creates issues or notifications with upgrade notes.
`Tools: http_request, file_read` · `Trigger: schedule (daily 8am)` · `Category: Development`

**11. CI/CD Failure Analyst**
Subscribes to build failure events, reads logs, classifies the root cause, and suggests fixes.
`Tools: http_request, file_read` · `Trigger: webhook` · `Category: Development`

**12. Code Review Standards Enforcer**
Reviews incoming code changes against a team style guide and posts inline feedback on violations.
`Tools: http_request, file_read` · `Trigger: webhook` · `Category: Development`

**13. Release Notes Generator**
Collects merged PRs and commit messages since the last tag and drafts formatted release notes.
`Tools: http_request, file_write` · `Trigger: manual` · `Category: Development`

**14. Issue Deduplication Bot**
Scans new GitHub/GitLab issues against existing ones and flags potential duplicates with links.
`Tools: http_request` · `Trigger: polling (300s)` · `Category: Development`

**15. Tech Debt Tracker**
Scans codebase files for TODO/FIXME/HACK comments and maintains a prioritized tech debt log.
`Tools: file_read, file_write` · `Trigger: schedule (weekly Monday)` · `Category: Development`

**16. API Health Monitor**
Pings a set of API endpoints, checks response codes and latency, and alerts on degradation.
`Tools: http_request` · `Trigger: polling (60s)` · `Category: Development`

**17. Database Migration Reviewer**
Reads new migration files and flags risky operations (dropping columns, missing rollback, locking tables).
`Tools: file_read, http_request` · `Trigger: webhook` · `Category: Development`

**18. Log Anomaly Detector**
Pulls recent application logs, identifies unusual error patterns, and sends an alert summary.
`Tools: http_request, file_read` · `Trigger: polling (300s)` · `Category: Development`

---

## Content & Writing

**19. Blog Post Drafter**
Takes a topic and outline from a file, researches via HTTP, and produces a first-draft blog post.
`Tools: http_request, file_read, file_write` · `Trigger: manual` · `Category: Content`

**20. Social Media Post Generator**
Reads a new blog post or announcement and generates platform-tailored posts for Twitter, LinkedIn, and Mastodon.
`Tools: file_read, file_write, http_request` · `Trigger: event (blog_published)` · `Category: Content`

**21. Content Calendar Manager**
Maintains a weekly content calendar file, suggests topics based on trending keywords, and flags overdue items.
`Tools: http_request, file_read, file_write` · `Trigger: schedule (weekly Monday)` · `Category: Content`

**22. SEO Audit Agent**
Analyzes a web page for SEO issues (title length, meta descriptions, heading structure) and writes a report.
`Tools: http_request, file_write` · `Trigger: manual` · `Category: Content`

**23. Grammar & Tone Reviewer**
Reads draft documents and provides detailed grammar, tone, and readability feedback.
`Tools: file_read, file_write` · `Trigger: manual` · `Category: Content`

**24. Press Release Formatter**
Takes raw notes and structures them into AP-style press releases with quotes and boilerplate.
`Tools: file_read, file_write` · `Trigger: manual` · `Category: Content`

**25. Documentation Gap Finder**
Scans project docs against the codebase and identifies undocumented features, stale pages, and broken links.
`Tools: file_read, http_request, file_write` · `Trigger: schedule (weekly)` · `Category: Content`

**26. Changelog Curator**
Monitors commit history and automatically maintains a human-readable CHANGELOG.md file.
`Tools: http_request, file_read, file_write` · `Trigger: schedule (daily)` · `Category: Content`

---

## Data & Research

**27. Competitor Price Monitor**
Scrapes competitor pricing pages at intervals and logs changes to a file with timestamps.
`Tools: http_request, file_write` · `Trigger: schedule (daily 6am)` · `Category: Research`

**28. News Topic Tracker**
Monitors news APIs for mentions of specified keywords and compiles a daily digest.
`Tools: http_request, file_write, gmail_send` · `Trigger: schedule (daily 8am)` · `Category: Research`

**29. Patent Filing Monitor**
Polls patent databases for new filings in specified technology areas and summarizes findings.
`Tools: http_request, file_write` · `Trigger: schedule (weekly)` · `Category: Research`

**30. Academic Paper Summarizer**
Takes an arXiv or DOI link, fetches the paper, and writes a structured summary with key findings.
`Tools: http_request, file_write` · `Trigger: manual` · `Category: Research`

**31. Market Data Aggregator**
Pulls financial data from APIs (stock prices, exchange rates) and writes a formatted daily snapshot.
`Tools: http_request, file_write` · `Trigger: schedule (daily market close)` · `Category: Research`

**32. Survey Response Analyzer**
Reads survey response data from a file, identifies trends, and generates an insight report.
`Tools: file_read, file_write` · `Trigger: manual` · `Category: Research`

**33. Regulatory Change Scanner**
Monitors government regulatory feeds for changes relevant to your industry and summarizes impacts.
`Tools: http_request, file_write, gmail_send` · `Trigger: schedule (daily)` · `Category: Research`

**34. Job Market Radar**
Tracks job postings on specified boards for given roles/skills and sends a weekly trends summary.
`Tools: http_request, file_write, gmail_send` · `Trigger: schedule (weekly)` · `Category: Research`

---

## Project & Task Management

**35. Daily Standup Preparer**
Reads yesterday's completed tasks and today's planned items from project files and drafts a standup update.
`Tools: file_read, file_write` · `Trigger: schedule (daily 8:30am)` · `Category: Project Management`

**36. Deadline Watchdog**
Scans task files or project management API for items approaching their deadlines and sends warnings.
`Tools: http_request, file_read, gmail_send` · `Trigger: schedule (daily 9am)` · `Category: Project Management`

**37. Sprint Retrospective Summarizer**
Collects sprint metrics and team feedback, then generates a structured retro summary document.
`Tools: http_request, file_read, file_write` · `Trigger: manual` · `Category: Project Management`

**38. Scope Creep Detector**
Compares current task lists against the original project scope document and flags additions.
`Tools: file_read, file_write` · `Trigger: schedule (weekly)` · `Category: Project Management`

**39. Resource Allocation Auditor**
Reviews team member assignments across projects and flags overallocation or idle capacity.
`Tools: http_request, file_read, file_write` · `Trigger: schedule (weekly Monday)` · `Category: Project Management`

**40. Status Report Generator**
Pulls data from multiple project sources and compiles a formatted weekly status report for stakeholders.
`Tools: http_request, file_read, file_write, gmail_send` · `Trigger: schedule (weekly Friday)` · `Category: Project Management`

---

## Finance & Accounting

**41. Invoice Processor**
Reads incoming invoice emails, extracts key fields (amount, vendor, due date), and logs them to a ledger file.
`Tools: gmail_read, gmail_search, file_write` · `Trigger: polling (300s)` · `Category: Finance`

**42. Expense Report Builder**
Collects receipt emails over a period and compiles them into a formatted expense report.
`Tools: gmail_search, gmail_read, file_write` · `Trigger: schedule (monthly 1st)` · `Category: Finance`

**43. Subscription Spend Tracker**
Monitors emails for recurring subscription charges and maintains a master subscription inventory.
`Tools: gmail_search, file_read, file_write` · `Trigger: schedule (monthly)` · `Category: Finance`

**44. Payment Reminder Sender**
Checks outstanding invoices file for overdue items and sends payment reminder emails to clients.
`Tools: file_read, gmail_send` · `Trigger: schedule (weekly)` · `Category: Finance`

**45. Budget Variance Reporter**
Compares actual spending data against budget targets and flags categories that are over or under.
`Tools: file_read, file_write` · `Trigger: schedule (weekly)` · `Category: Finance`

**46. Revenue Forecaster**
Reads historical revenue data and generates a simple trend-based forecast report.
`Tools: file_read, file_write` · `Trigger: schedule (monthly)` · `Category: Finance`

---

## DevOps & Infrastructure

**47. SSL Certificate Expiry Watchdog**
Checks SSL certificates for a list of domains and alerts when expiration is within 30 days.
`Tools: http_request, gmail_send` · `Trigger: schedule (daily)` · `Category: DevOps`

**48. Server Uptime Monitor**
Pings a set of servers/services and reports downtime or high response times.
`Tools: http_request, file_write` · `Trigger: polling (120s)` · `Category: DevOps`

**49. Docker Image Vulnerability Scanner**
Queries vulnerability databases for known CVEs in your Docker image dependencies and reports findings.
`Tools: http_request, file_write` · `Trigger: schedule (daily)` · `Category: DevOps`

**50. Infrastructure Cost Optimizer**
Reads cloud provider billing APIs and identifies underutilized resources or cost-saving opportunities.
`Tools: http_request, file_write` · `Trigger: schedule (weekly)` · `Category: DevOps`

**51. DNS Record Auditor**
Periodically resolves DNS records for your domains and alerts on unexpected changes.
`Tools: http_request, file_write` · `Trigger: schedule (daily)` · `Category: DevOps`

**52. Backup Verification Agent**
Checks backup logs or endpoints to confirm recent backups completed successfully.
`Tools: http_request, file_read, file_write` · `Trigger: schedule (daily 6am)` · `Category: DevOps`

**53. Incident Post-Mortem Drafter**
Takes incident timeline data and drafts a blameless post-mortem document from a template.
`Tools: file_read, file_write, http_request` · `Trigger: manual` · `Category: DevOps`

---

## HR & People Ops

**54. New Hire Onboarding Coordinator**
Sends a sequence of onboarding emails and tasks to new team members on a defined schedule.
`Tools: gmail_send, file_read` · `Trigger: manual` · `Category: HR`

**55. Leave Balance Notifier**
Reads leave balance data and reminds employees who haven't taken enough time off.
`Tools: file_read, gmail_send` · `Trigger: schedule (monthly)` · `Category: HR`

**56. Performance Review Reminder**
Tracks review cycles and sends reminders to managers and reports as deadlines approach.
`Tools: file_read, gmail_send` · `Trigger: schedule (daily during review period)` · `Category: HR`

**57. Job Description Optimizer**
Reads a job description file and suggests improvements for clarity, inclusivity, and SEO.
`Tools: file_read, file_write` · `Trigger: manual` · `Category: HR`

**58. Candidate Screening Summarizer**
Reads candidate application emails and creates structured summary profiles for hiring managers.
`Tools: gmail_read, gmail_search, file_write` · `Trigger: polling (600s)` · `Category: HR`

**59. Team Pulse Survey Distributor**
Sends anonymous pulse survey questions and collects results via email replies.
`Tools: gmail_send, gmail_read, file_write` · `Trigger: schedule (weekly Friday)` · `Category: HR`

---

## Sales & CRM

**60. Lead Qualification Agent**
Evaluates inbound lead emails against ideal customer criteria and scores them for sales priority.
`Tools: gmail_read, gmail_search, http_request, file_write` · `Trigger: polling (120s)` · `Category: Sales`

**61. Deal Stage Updater**
Reads email conversations with prospects and suggests CRM deal stage transitions.
`Tools: gmail_search, gmail_read, http_request` · `Trigger: schedule (daily)` · `Category: Sales`

**62. Win/Loss Analysis Reporter**
Compiles recent closed deals and generates a win/loss analysis with patterns and recommendations.
`Tools: http_request, file_read, file_write` · `Trigger: schedule (monthly)` · `Category: Sales`

**63. Proposal First Draft Generator**
Takes a brief and client context file and generates a structured sales proposal draft.
`Tools: file_read, file_write` · `Trigger: manual` · `Category: Sales`

**64. Churn Risk Alert Agent**
Monitors customer engagement signals (support tickets, email frequency) and flags accounts at risk.
`Tools: http_request, gmail_search, file_write` · `Trigger: schedule (weekly)` · `Category: Sales`

**65. Quote Follow-Up Automator**
Tracks sent quotes that haven't been responded to and drafts timely follow-up emails.
`Tools: gmail_search, gmail_send, file_read` · `Trigger: schedule (daily)` · `Category: Sales`

---

## Customer Support

**66. Support Ticket Categorizer**
Reads incoming support emails, classifies them by issue type and severity, and routes them accordingly.
`Tools: gmail_read, gmail_search, http_request` · `Trigger: polling (60s)` · `Category: Support`

**67. FAQ Auto-Responder**
Detects common questions in support emails and sends pre-approved answers, escalating edge cases.
`Tools: gmail_read, gmail_send, file_read` · `Trigger: polling (60s)` · `Category: Support`

**68. Customer Sentiment Analyzer**
Reads support conversations and scores customer sentiment, flagging frustrated customers for priority handling.
`Tools: gmail_search, gmail_read, file_write` · `Trigger: schedule (daily)` · `Category: Support`

**69. SLA Breach Warning Agent**
Monitors open support tickets against SLA timelines and alerts before breaches occur.
`Tools: http_request, gmail_send` · `Trigger: polling (300s)` · `Category: Support`

**70. Knowledge Base Updater**
Analyzes resolved support tickets to identify missing or outdated knowledge base articles.
`Tools: http_request, file_read, file_write` · `Trigger: schedule (weekly)` · `Category: Support`

---

## Legal & Compliance

**71. Contract Clause Reviewer**
Reads contract files and highlights non-standard or risky clauses against a checklist.
`Tools: file_read, file_write` · `Trigger: manual` · `Category: Legal`

**72. NDA Expiry Tracker**
Maintains a log of NDAs and their expiry dates, sending reminders before renewal deadlines.
`Tools: file_read, gmail_send` · `Trigger: schedule (weekly)` · `Category: Legal`

**73. Privacy Policy Change Monitor**
Watches key vendor privacy policy URLs for changes and summarizes what's different.
`Tools: http_request, file_write, gmail_send` · `Trigger: schedule (weekly)` · `Category: Legal`

**74. GDPR Data Request Handler**
Detects data subject access requests in email and initiates a response workflow with checklists.
`Tools: gmail_read, gmail_send, file_write` · `Trigger: polling (300s)` · `Category: Legal`

**75. License Compliance Auditor**
Scans project dependency files for license types and flags any that conflict with your policy.
`Tools: file_read, http_request, file_write` · `Trigger: schedule (weekly)` · `Category: Legal`

---

## Personal Productivity

**76. Daily Planner Agent**
Compiles your calendar, email highlights, and task list into a single morning briefing document.
`Tools: gmail_read, http_request, file_write` · `Trigger: schedule (daily 6:30am)` · `Category: Productivity`

**77. Weekly Review Facilitator**
Guides you through a weekly review by collecting accomplishments, open items, and next-week priorities.
`Tools: file_read, file_write` · `Trigger: schedule (Friday 4pm)` · `Category: Productivity`

**78. Reading List Curator**
Collects articles you've emailed to yourself, deduplicates, and organizes them by topic into a reading list file.
`Tools: gmail_search, gmail_read, file_write` · `Trigger: schedule (daily)` · `Category: Productivity`

**79. Goal Progress Tracker**
Reads your goals file, checks in on progress metrics, and sends a weekly accountability update.
`Tools: file_read, file_write, gmail_send` · `Trigger: schedule (weekly Sunday)` · `Category: Productivity`

**80. Meeting Notes Formatter**
Takes raw meeting notes from a file and structures them into action items, decisions, and follow-ups.
`Tools: file_read, file_write` · `Trigger: manual` · `Category: Productivity`

**81. Time Audit Summarizer**
Reads time-tracking data exports and generates a report on where your hours went each week.
`Tools: file_read, file_write` · `Trigger: schedule (weekly)` · `Category: Productivity`

**82. Bookmark Organizer**
Reads an exported bookmarks file, categorizes entries, removes dead links, and writes a clean version.
`Tools: file_read, http_request, file_write` · `Trigger: manual` · `Category: Productivity`

---

## Marketing

**83. Campaign Performance Reporter**
Pulls marketing analytics from APIs and generates a formatted performance summary.
`Tools: http_request, file_write` · `Trigger: schedule (weekly Monday)` · `Category: Marketing`

**84. A/B Test Evaluator**
Reads experiment result data and writes a statistical summary with a clear recommendation.
`Tools: file_read, file_write` · `Trigger: manual` · `Category: Marketing`

**85. Brand Mention Monitor**
Searches the web for brand mentions and compiles a sentiment-tagged digest.
`Tools: http_request, file_write, gmail_send` · `Trigger: schedule (daily)` · `Category: Marketing`

**86. UTM Link Generator**
Takes a list of URLs and campaign parameters and generates properly tagged tracking links.
`Tools: file_read, file_write` · `Trigger: manual` · `Category: Marketing`

**87. Influencer Outreach Drafter**
Reads an influencer list file and generates personalized outreach email drafts for each.
`Tools: file_read, file_write, gmail_send` · `Trigger: manual` · `Category: Marketing`

**88. Email Campaign Preview Tester**
Sends test versions of marketing emails to a seed list and collects rendering reports.
`Tools: gmail_send, http_request` · `Trigger: manual` · `Category: Marketing`

---

## Security

**89. Leaked Credential Scanner**
Checks breach notification APIs for company email domains and alerts on new exposures.
`Tools: http_request, gmail_send` · `Trigger: schedule (daily)` · `Category: Security`

**90. Access Log Anomaly Detector**
Reads application access logs, identifies unusual login patterns, and flags suspicious activity.
`Tools: file_read, http_request, file_write` · `Trigger: polling (600s)` · `Category: Security`

**91. Security Header Auditor**
Checks your web properties for proper security headers (CSP, HSTS, X-Frame-Options) and reports gaps.
`Tools: http_request, file_write` · `Trigger: schedule (weekly)` · `Category: Security`

**92. Phishing Email Detector**
Analyzes suspicious emails for phishing indicators and quarantines them with a warning report.
`Tools: gmail_read, gmail_search, gmail_mark_read, file_write` · `Trigger: polling (60s)` · `Category: Security`

---

## Multi-Agent / Pipeline Templates

**93. Content Review Pipeline**
A three-agent team: Writer drafts content → Reviewer checks quality → Publisher formats and distributes.
`Tools: file_read, file_write, http_request, gmail_send` · `Trigger: manual` · `Category: Pipeline`
`Team Roles: writer (worker), reviewer (reviewer), publisher (worker)`

**94. Incident Response Coordinator**
An orchestrator agent that detects incidents, dispatches a diagnostics agent, and routes to a communication agent for stakeholder updates.
`Tools: http_request, gmail_send, file_write` · `Trigger: webhook` · `Category: Pipeline`
`Team Roles: coordinator (orchestrator), diagnostics (worker), communicator (worker)`

**95. Data Pipeline Monitor**
A router agent that checks ETL pipeline health, routes failures to a debugging agent, and successes to a reporting agent.
`Tools: http_request, file_read, file_write` · `Trigger: polling (300s)` · `Category: Pipeline`
`Team Roles: router (router), debugger (worker), reporter (worker)`

**96. Customer Onboarding Flow**
Sequential pipeline: Welcome email agent → Account setup checker → First-week follow-up agent.
`Tools: gmail_send, http_request, file_read` · `Trigger: event (new_customer)` · `Category: Pipeline`
`Team Roles: welcomer (worker), setup_checker (worker), follow_up (worker)`

**97. Competitive Intelligence Pipeline**
Parallel agents scrape different competitor sources, then a synthesizer agent merges findings into a unified report.
`Tools: http_request, file_read, file_write` · `Trigger: schedule (weekly)` · `Category: Pipeline`
`Team Roles: scraper_a (worker), scraper_b (worker), synthesizer (orchestrator)`

**98. Code Ship Pipeline**
Sequential: Lint checker → Test runner → Release notes generator → Deployment notifier.
`Tools: http_request, file_read, file_write, gmail_send` · `Trigger: webhook` · `Category: Pipeline`
`Team Roles: linter (worker), tester (worker), notes (worker), notifier (worker)`

**99. Multi-Channel Support Router**
A router agent classifies incoming support requests and dispatches to specialized agents (billing, technical, general).
`Tools: gmail_read, gmail_send, http_request` · `Trigger: polling (60s)` · `Category: Pipeline`
`Team Roles: router (router), billing_agent (worker), tech_agent (worker), general_agent (worker)`

**100. Research & Report Pipeline**
A researcher agent gathers data from multiple sources, a fact-checker validates claims, and a writer produces the final report.
`Tools: http_request, file_read, file_write` · `Trigger: manual` · `Category: Pipeline`
`Team Roles: researcher (worker), fact_checker (reviewer), writer (worker)`