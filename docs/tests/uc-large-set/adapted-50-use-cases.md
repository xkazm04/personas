# 55 Adapted Use Cases — Gmail / Notion / Database / In-App Messaging Only

Each use case is minimalistic but tests logical persona composition and execution across all 8 PersonaMatrix dimensions.

---

## Email & Communication (Gmail + Messages)

| # | Name | Intent | Expected Tools | Expected Dimensions |
|---|------|--------|---------------|-------------------|
| 1 | Email Triage Agent | Auto-categorize, label and prioritize incoming Gmail emails using AI classification | gmail_read, gmail_label | use-cases, connectors(gmail), triggers(polling), messages(built-in), memory(categories learned) |
| 2 | Auto-Reply Drafter | Generate context-aware email reply drafts for incoming Gmail messages and save to drafts | gmail_read, gmail_draft | use-cases, connectors(gmail), human-review(draft approval), messages(built-in) |
| 3 | Email-to-Task Extractor | Parse action items from Gmail emails and create structured tasks in a Notion database | gmail_read, notion_create | use-cases, connectors(gmail,notion), triggers(polling), messages(built-in) |
| 4 | Newsletter Summarizer | Read newsletter emails from Gmail, summarize with AI, and store summaries in a database | gmail_read, db_write | use-cases, connectors(gmail,db), memory(newsletters processed), messages(built-in) |
| 5 | Daily Email Digest | Compile the 10 most important unread emails into a structured morning digest via in-app message | gmail_read | use-cases, connectors(gmail), triggers(schedule), messages(built-in) |
| 6 | Email Attachment Cataloger | Track and catalog all email attachments by sender and type in a database table | gmail_read, db_write | use-cases, connectors(gmail,db), memory(attachment history) |
| 7 | Follow-Up Reminder | Track email threads needing follow-up and send reminders for unanswered emails after 48 hours | gmail_read, gmail_send | use-cases, connectors(gmail), triggers(schedule), memory(tracked threads) |
| 8 | Phishing Alert Agent | Scan incoming emails for suspicious patterns and flag potential phishing attempts for review | gmail_read | use-cases, connectors(gmail), triggers(polling), human-review(suspicious emails), messages(built-in) |

## Knowledge & Data Management (Notion + Database)

| # | Name | Intent | Expected Tools | Expected Dimensions |
|---|------|--------|---------------|-------------------|
| 9 | Meeting Notes Organizer | Process meeting transcript text, extract action items and decisions, organize in Notion by topic | notion_create, notion_update | use-cases, connectors(notion), memory(action items), messages(built-in) |
| 10 | Personal Knowledge Base | Collect, tag and organize research notes and article highlights in Notion pages | notion_create, notion_query | use-cases, connectors(notion), memory(topics indexed), messages(built-in) |
| 11 | Research Indexer | Index research papers and articles with summaries and key findings in a database | db_write, db_query | use-cases, connectors(db), memory(papers cataloged), messages(built-in) |
| 12 | Learning Journal | Create structured daily study notes in Notion with spaced repetition cues and topic connections | notion_create | use-cases, connectors(notion), memory(learning progress), triggers(schedule) |
| 13 | Reading List Curator | Manage a prioritized reading list in Notion with status tracking and review dates | notion_create, notion_update | use-cases, connectors(notion), triggers(schedule), messages(built-in) |
| 14 | Decision Log Keeper | Document team decisions with context, rationale and stakeholders in a Notion database | notion_create | use-cases, connectors(notion), memory(decisions recorded), messages(built-in) |
| 15 | Idea Capture System | Collect raw ideas from user input, categorize them, and store in Notion with priority scoring | notion_create | use-cases, connectors(notion), memory(idea categories), messages(built-in) |
| 16 | Glossary Builder | Build and maintain a domain glossary in Notion, auto-detecting new terms from input text | notion_create, notion_query | use-cases, connectors(notion), memory(terms indexed) |

## Customer & Support Operations (Gmail + Notion + DB)

| # | Name | Intent | Expected Tools | Expected Dimensions |
|---|------|--------|---------------|-------------------|
| 17 | Support Ticket Triage | Route incoming support emails to categories, create Notion tickets with priority and SLA | gmail_read, notion_create | use-cases, connectors(gmail,notion), triggers(polling), human-review(escalations) |
| 18 | Feedback Aggregator | Collect customer feedback from Gmail into a database with sentiment analysis and tags | gmail_read, db_write | use-cases, connectors(gmail,db), memory(feedback trends), messages(built-in) |
| 19 | FAQ Auto-Responder | Answer common customer questions from Gmail using a knowledge base and send replies | gmail_read, gmail_send, db_query | use-cases, connectors(gmail,db), memory(FAQ patterns), error-handling(unknown questions) |
| 20 | Complaint Escalator | Flag negative-sentiment emails for manual review and create escalation records in database | gmail_read, db_write | use-cases, connectors(gmail,db), human-review(complaints), messages(built-in) |
| 21 | Customer Onboarding Drip | Send a 5-email welcome sequence to new customers tracked in a database | gmail_send, db_query, db_write | use-cases, connectors(gmail,db), triggers(event), memory(sequence position) |
| 22 | NPS Survey Processor | Process NPS survey response emails, extract scores, and track trends in database | gmail_read, db_write | use-cases, connectors(gmail,db), memory(score trends), messages(built-in) |

## Content & Marketing (Gmail + Notion)

| # | Name | Intent | Expected Tools | Expected Dimensions |
|---|------|--------|---------------|-------------------|
| 23 | Content Calendar Manager | Plan and track content publishing schedule in Notion with status and deadlines | notion_create, notion_update | use-cases, connectors(notion), triggers(schedule), messages(built-in) |
| 24 | Email Campaign Tracker | Track email campaign performance metrics in a database and report weekly results | gmail_read, db_write | use-cases, connectors(gmail,db), triggers(schedule), messages(built-in) |
| 25 | Blog Post Outliner | Generate structured blog post outlines in Notion from topic briefs with SEO suggestions | notion_create | use-cases, connectors(notion), memory(topics covered), messages(built-in) |
| 26 | Newsletter Composer | Compile curated content into a formatted newsletter and send via Gmail | notion_query, gmail_send | use-cases, connectors(notion,gmail), triggers(schedule), messages(built-in) |
| 27 | Product Description Writer | Generate e-commerce product descriptions from input specs and store in Notion | notion_create | use-cases, connectors(notion), memory(brand voice), messages(built-in) |
| 28 | Content Performance Reporter | Analyze content metrics from database and generate weekly performance reports | db_query | use-cases, connectors(db), triggers(schedule), messages(built-in) |

## Sales & CRM (Gmail + Database + Notion)

| # | Name | Intent | Expected Tools | Expected Dimensions |
|---|------|--------|---------------|-------------------|
| 29 | Lead Capture Agent | Extract lead information from incoming emails and create records in database | gmail_read, db_write | use-cases, connectors(gmail,db), triggers(polling), messages(built-in) |
| 30 | Deal Pipeline Tracker | Track sales deal stages in database with automatic notifications on stage changes | db_query, db_write | use-cases, connectors(db), triggers(event), messages(built-in), events(stage_change) |
| 31 | Proposal Generator | Create sales proposals in Notion from deal data and templates | notion_create, db_query | use-cases, connectors(notion,db), human-review(proposal approval), messages(built-in) |
| 32 | Contact Enrichment Agent | Enrich contact records in database with information extracted from email signatures | gmail_read, db_write, db_query | use-cases, connectors(gmail,db), memory(contacts updated) |
| 33 | Win/Loss Analyzer | Analyze closed deals from database and document patterns in Notion | db_query, notion_create | use-cases, connectors(db,notion), memory(deal patterns), messages(built-in) |

## Finance & Admin (Gmail + Database)

| # | Name | Intent | Expected Tools | Expected Dimensions |
|---|------|--------|---------------|-------------------|
| 34 | Invoice Tracker | Track invoices from Gmail emails in a database with payment status and due dates | gmail_read, db_write | use-cases, connectors(gmail,db), triggers(polling), messages(built-in) |
| 35 | Expense Categorizer | Categorize expense receipts from emails and log in database with category and amount | gmail_read, db_write | use-cases, connectors(gmail,db), memory(category patterns), messages(built-in) |
| 36 | Payment Reminder Agent | Send payment reminders via Gmail for overdue invoices tracked in database | gmail_send, db_query | use-cases, connectors(gmail,db), triggers(schedule), error-handling(delivery failures) |
| 37 | Budget Monitor | Track spending against budget categories in database and alert when thresholds exceeded | db_query | use-cases, connectors(db), triggers(schedule), messages(built-in), events(budget_alert) |
| 38 | Receipt Archiver | Extract and organize receipt data from Gmail emails into structured database records | gmail_read, db_write | use-cases, connectors(gmail,db), memory(receipts processed) |

## HR & People (Gmail + Notion + Database)

| # | Name | Intent | Expected Tools | Expected Dimensions |
|---|------|--------|---------------|-------------------|
| 39 | Onboarding Task Manager | Create and track new hire onboarding checklists in Notion with deadline reminders | notion_create, notion_update | use-cases, connectors(notion), triggers(event), messages(built-in) |
| 40 | Applicant Tracker | Track job applications from Gmail in database with status and interview scheduling | gmail_read, db_write | use-cases, connectors(gmail,db), triggers(polling), human-review(shortlisting) |
| 41 | Leave Request Processor | Process time-off request emails and update leave records in database | gmail_read, db_write | use-cases, connectors(gmail,db), human-review(approval), messages(built-in) |
| 42 | Team Directory Updater | Keep team member information updated in database from email signatures and communications | gmail_read, db_write | use-cases, connectors(gmail,db), memory(team roster) |

## IT & Operations (Database + Messages)

| # | Name | Intent | Expected Tools | Expected Dimensions |
|---|------|--------|---------------|-------------------|
| 43 | Incident Logger | Log system incidents in database with severity, timestamp and resolution status | db_write | use-cases, connectors(db), triggers(event), messages(built-in), events(incident_created) |
| 44 | Change Log Tracker | Track system and configuration changes in Notion with impact assessment | notion_create | use-cases, connectors(notion), memory(change history), messages(built-in) |
| 45 | Documentation Auditor | Audit documentation freshness from Notion pages and flag stale content for review | notion_query | use-cases, connectors(notion), human-review(stale docs), triggers(schedule), messages(built-in) |
| 46 | Service Status Reporter | Compile service health status from database metrics into formatted status reports | db_query | use-cases, connectors(db), triggers(schedule), messages(built-in) |
| 47 | Access Request Handler | Process access request emails and create audit records in database | gmail_read, db_write | use-cases, connectors(gmail,db), human-review(access approval), messages(built-in) |

## Productivity & Reporting (Notion + Database + Messages)

| # | Name | Intent | Expected Tools | Expected Dimensions |
|---|------|--------|---------------|-------------------|
| 48 | Daily Standup Compiler | Compile team standup updates into a structured daily summary via in-app message | notion_query | use-cases, connectors(notion), triggers(schedule), messages(built-in) |
| 49 | Task Prioritizer | Re-prioritize Notion tasks based on deadlines, dependencies and urgency scoring | notion_query, notion_update | use-cases, connectors(notion), memory(priority patterns), messages(built-in) |
| 50 | Weekly Review Generator | Generate weekly review reports from Notion task and project data | notion_query | use-cases, connectors(notion), triggers(schedule), messages(built-in) |
| 51 | Habit Tracker | Track daily habits in database with streak counting and motivational reminders | db_write, db_query | use-cases, connectors(db), triggers(schedule), memory(streaks), messages(built-in) |
| 52 | Goal Progress Reporter | Track and report goal completion percentage from database milestones | db_query | use-cases, connectors(db), triggers(schedule), messages(built-in) |
| 53 | Metrics Dashboard Agent | Compile key metrics from database into a formatted weekly dashboard report | db_query | use-cases, connectors(db), triggers(schedule), messages(built-in) |
| 54 | Anomaly Detector | Detect unusual patterns in database metrics and alert with analysis via in-app message | db_query | use-cases, connectors(db), triggers(schedule), messages(built-in), events(anomaly_detected) |
| 55 | Survey Analyzer | Analyze survey responses from database and generate insight reports in Notion | db_query, notion_create | use-cases, connectors(db,notion), memory(survey trends), messages(built-in) |

---

## Connector Coverage Summary

| Connector | Use Cases Using It | Count |
|-----------|-------------------|-------|
| Gmail (read) | 1-8, 17-22, 24, 26, 29, 32, 34-36, 38, 40-42, 47 | 26 |
| Gmail (send) | 2, 7, 19, 21, 26, 36 | 6 |
| Notion (create) | 3, 9-10, 12-16, 23, 25, 27, 31, 33, 39, 43-45, 55 | 18 |
| Notion (query) | 10, 16, 26, 45, 48-50 | 7 |
| Database (write) | 4, 6, 11, 18, 20-22, 24, 29-30, 32, 34-35, 38, 40-43, 47, 51 | 20 |
| Database (query) | 19, 21, 28, 30-31, 33, 36-37, 46, 51-55 | 14 |
| In-app messages | All 55 | 55 |

## Dimension Coverage Summary

| Dimension | Count |
|-----------|-------|
| use-cases | 55/55 |
| connectors | 55/55 |
| triggers | 35/55 |
| messages | 55/55 |
| human-review | 14/55 |
| memory | 30/55 |
| error-handling | 5/55 |
| events | 5/55 |
