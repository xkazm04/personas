# 100 Most Popular n8n Workflow Use Cases

*Researched from n8n community templates (8,500+), case studies, GitHub collections, and automation blogs.*

---

## Email & Communication

- AI-powered email triage — auto-categorize, label, and prioritize incoming emails using OpenAI/Claude
- Auto-reply drafting — generate context-aware email response drafts for review
- Email-to-task extraction — parse action items from emails and create tasks in Notion/Todoist/Asana
- Newsletter aggregation — collect newsletters via IMAP, summarize with AI, store in a database
- Phishing detection — scan incoming emails for suspicious links and flag them automatically
- Daily email digest — compile important messages into a single morning summary
- Email attachment auto-save — save incoming attachments to Google Drive/Dropbox by sender or subject
- Transactional email notifications — send order confirmations, shipping updates, password resets

## Lead Generation & Sales

- Web form to CRM sync — capture Typeform/Tally/Webflow submissions and push to HubSpot/Salesforce/Pipedrive
- Lead scoring automation — assign scores based on engagement, demographics, and behavior data
- LinkedIn job signal outreach — monitor LinkedIn for hiring signals and trigger personalized cold emails
- Google Maps lead scraping — extract business leads from Google Maps and enrich them for outreach
- Abandoned cart recovery — detect cart abandonment and trigger email/SMS follow-up sequences
- AI-personalized cold email at scale — use GPT to craft unique outreach per prospect
- Lead enrichment pipeline — enrich leads with Clearbit/Clay data before routing to sales
- Automated sales proposal generation — turn post-call forms into personalized PandaDoc proposals
- Deal stage notifications — alert sales reps in Slack when a deal moves stages in the CRM

## Social Media Management

- Cross-platform post scheduling — publish to LinkedIn, Twitter/X, Facebook, and Instagram simultaneously
- Blog-to-social auto-posting — detect new RSS/blog entries and auto-share on social channels
- AI-generated LinkedIn posts — create topic-based posts with AI-generated images and hashtags
- Social media engagement tracking — monitor mentions, hashtags, and compile engagement reports
- AI video ad creation — turn product images and briefs into polished video ads for social
- Text-to-video pipeline — generate scripts with Gemini, create videos, publish to YouTube and Instagram
- Hashtag and trend monitoring — track trending topics and alert content teams in real time
- Comment/DM auto-response — use AI to reply to common questions on social platforms

## Customer Support

- AI customer support agent — route, analyze, and auto-respond to support emails with context awareness
- WhatsApp AI chatbot — handle customer queries via WhatsApp with intent recognition and AI responses
- Telegram support bot — build a support bot that answers FAQs using a knowledge base
- Support ticket creation — auto-create Jira/Zendesk/ServiceNow tickets from incoming messages
- Sentiment analysis routing — analyze customer sentiment and escalate negative cases to humans
- Payment support ticket automation — auto-resolve common billing/payment questions (70%+ automation)
- Customer feedback collection — trigger review requests post-purchase and aggregate responses
- Trustpilot/review scraping and analysis — scrape reviews and run sentiment analysis with AI

## AI Agents & Chatbots

- RAG chatbot with company docs — answer questions grounded in your PDFs, Google Docs, or Notion pages
- Local RAG with Ollama + Qdrant — fully private, self-hosted AI chatbot using local LLMs
- Multi-tool AI agent — autonomous agent with web search, database access, and calculator tools
- Slack AI assistant — respond to slash commands with AI-powered answers from internal data
- Personal AI assistant via Telegram — manage emails, calendar, expenses, and tasks through chat
- AI agent for web scraping — autonomous crawling and data extraction agent
- Agentic RAG with dynamic tool routing — smart agent that picks the right retrieval tool per query
- MCP server integration — expose n8n workflows as tools for external AI agents via Model Context Protocol

## Content Creation & Marketing

- AI blog post pipeline — research → outline → write → optimize SEO → publish to WordPress
- Email campaign automation — trigger personalized drip sequences based on user behavior/lifecycle
- Personalized marketing campaigns — integrate multiple data sources for hyper-targeted campaigns
- Content brief to article — turn Airtable briefs into full articles using multiple AI models
- AI image generation for content — create blog/social images with DALL-E integrated into publishing workflows
- Weekly content roundup — auto-curate relevant industry content into a newsletter digest
- Product description generation — bulk-create e-commerce product descriptions with AI
- Webinar follow-up nurturing — auto-enroll attendees into tailored email nurture sequences

## E-commerce & Orders

- Order processing with notifications — receive webhooks from Shopify/WooCommerce, confirm, and notify fulfillment
- Inventory level monitoring — daily checks across warehouses with low-stock alerts via Slack/email
- Shopify-to-ERP order sync — keep order statuses and inventory in sync between platforms
- Cross-channel inventory sync — update stock across online store, marketplace, and POS in real time
- Customer communication sequences — automated order confirmations, shipping updates, and follow-ups
- Returns and refund processing — handle return requests and update inventory/accounting automatically
- Price update automation — bulk-update millions of prices from ERP to e-commerce platform (Shopware)
- Product recommendation engine — AI-powered suggestions based on browsing history and preferences

## Finance & Accounting

- Stripe-to-QuickBooks receipt sync — auto-create sales receipts for every successful Stripe payment
- Invoice generation and delivery — auto-create invoices on project completion and track payment status
- Expense tracking via Telegram — log expenses through voice/text messages, categorize with AI
- Receipt OCR and categorization — photograph receipts, extract data with AI, update spreadsheets
- Airtable-to-QuickBooks invoicing — end-to-end invoice workflow across Airtable, QuickBooks, and Stripe
- Rent payment reconciliation — compare Excel data with bank records using AI
- Overdue payment follow-up — automated reminders for unpaid invoices on escalating schedules
- Financial news delivery — daily curated financial news digest via email or Slack

## HR & People Operations

- Employee onboarding automation — provision accounts, send welcome emails, assign training tasks
- Employee offboarding — revoke access, collect equipment, update records across systems
- AI-powered resume screening — parse and score job applications with AI for shortlisting
- HR FAQ chatbot — answer common HR policy questions using RAG on the employee handbook
- Applicant tracking sync — move candidate data between ATS, email, and hiring manager notifications
- Workplace discrimination detection — AI-driven analysis of internal reports and communications
- Time-off request routing — automate approval workflows with Slack/email notifications
- New hire paperwork automation — generate and route offer letters and contracts for e-signatures

## IT Operations & DevOps

- Website uptime monitoring — ping endpoints every few minutes, alert on non-200 responses
- Incident alerting to Slack/email — receive monitoring webhooks and route alerts to the right channel
- Automated server updates — trigger Debian system updates via authenticated SSH webhooks
- Docker Compose service control — start/stop containers remotely through HTTP requests
- CI/CD deployment notifications — notify teams of build status, test results, and deployment outcomes
- User access management — provision and deprovision user accounts across multiple systems
- Database backup automation — scheduled backups to multiple cloud providers with verification
- Infrastructure health reporting — aggregate system metrics and generate weekly status reports
- SSL certificate monitoring — track certificate expiration and alert before renewals are due
- Log aggregation and alerting — collect logs from multiple services and alert on error patterns

## Data Processing & Integration

- CRM-to-spreadsheet sync — keep Salesforce/HubSpot data mirrored in Google Sheets in real time
- Multi-platform data sync — ensure customer profiles stay consistent across CRM, email, and support tools
- Google Analytics AI analysis — send analytics data to AI for insights, save results to a database
- CSV/spreadsheet data cleaning — transform messy tabular data into structured, validated records
- Webhook data transformation — receive, parse, and route webhook payloads between services
- API data aggregation — pull data from multiple APIs, merge, and store in a unified database
- Database migration workflows — ETL pipelines for moving data between PostgreSQL, MySQL, Airtable, etc.
- Real-time data pipelines — stream and process events from webhooks into downstream systems

## Document & File Management

- PDF generation from forms — convert form submissions or CRM data into formatted PDF documents
- Document review with AI — auto-summarize contracts, reports, or legal documents
- Google Drive file organization — auto-sort uploaded files into folders by type, date, or content
- Automated data backup to cloud — schedule file and database backups to S3/Google Drive/Dropbox
- Document approval routing — send documents for review, collect approvals, and notify stakeholders
- Meeting notes summarization — process call transcripts (Fireflies) and distribute key takeaways
- OCR on scanned documents — extract text from images/PDFs for searchable document archives

## Personal Productivity & Lifestyle

- RSS feed monitoring and summarization — track blogs and news, get AI-summarized digests
- Daily tech news briefing — scrape headlines, format with AI, deliver to Slack/Telegram each morning
- Notion task status alerts — get pinged on Slack/Telegram when Notion database items change status
- AI expense tracker — log spending via voice messages in Telegram with automatic categorization
- Recipe recommendations — AI-powered recipe suggestions using vector search and preferences
- Spotify playlist creation via Telegram — request songs in chat and auto-create Spotify playlists
- Personal knowledge base builder — auto-save and organize bookmarks, articles, and highlights
- Calendar sync and smart scheduling — sync events across Google Calendar, Outlook, and notify via Slack

## Reporting & Analytics

- Automated weekly/monthly reports — compile data from multiple sources into formatted reports
- SEO performance dashboards — aggregate search ranking data and summarize trends with AI
- Survey data analysis — extract insights from survey responses using AI and vector databases
- Customer churn prediction — analyze behavior patterns and flag at-risk accounts automatically
- Sales pipeline reporting — generate CRM pipeline summaries and distribute to leadership
- Social media analytics compilation — pull engagement metrics across platforms into unified reports
