# Codebase Catalogs — personas

> Generated: 2026-05-09T18:42:29.073Z
> Templates: 125 across 14 categories
> Connectors: 122 across 36 categories
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

## Template Catalog (125)

### content (13)

- **ai-document-intelligence-hub** — Monitors cloud storage folders for new and updated documents, uses AI to extract summaries, tags, and metadata, then builds a searchable knowledge base and local index. Responds to natural-language search queries via the messaging channel and posts weekly knowledge growth reports to the messaging channel. — flow: cloud storage -> knowledge base -> messaging -> messaging
- **analytics-content-distribution-use-case** — Detects new CMS posts via the REST API, auto-schedules social media posts to Buffer with platform-optimized captions, checks analytics performance after 48h, and adjusts future posting strategy based on engagement data. — flow: CMS -> Buffer -> analytics
- **audio-briefing-host** — Turns any source document, meeting transcript, research report, or article into a 5-15 minute conversational audio briefing with two distinct hosts. A scriptwriter persona structures the content as a back-and-forth conversation, a TTS connector synthesizes the voices, and ffmpeg stitches the segments into a single MP3. Learns from user feedback which conversation styles and pacing work best. — flow: Input Source -> TTS API -> FFmpeg -> Messages
- **autonomous-art-director** — Periodically conceives and generates unique art concepts using a connected image-AI provider, saves them to the in-app 2D gallery, and presents each piece for human curation. Learns from approvals and rejections to refine its creative direction over time. — flow: Image AI -> Artist Gallery -> Messages
- **content-approval-workflow** — Monitors a knowledge base "Ready for Review" database view. When items appear, emails the assigned reviewer, posts to a messaging approval channel with action context, and waits for approval. On approval, moves the item to "Published" and notifies the author. — flow: knowledge base -> email -> messaging
- **content-performance-reporter** — Analyzes page views, session duration, and bounce rate metrics from a local database to generate weekly trend reports with week-over-week comparisons, content rankings, and anomaly detection. Delivers structured insights via in-app messaging and progressively learns baseline patterns through agent memory. — flow: Local Database -> In-App Messaging
- **demo-recorder** — Creates short demo recordings and step-by-step visual guides from running web applications by analyzing the codebase to understand features, autonomously navigating the app in a browser, and capturing annotated screenshots or video walkthroughs. Uses a tiered recording system (CDP screenshots -> Windows Game Bar -> Playwright) requiring zero mandatory installs. — flow: Codebase -> Desktop Browser -> Desktop Terminal -> Messages
- **feature-video-creator** — Automates production of short feature announcement videos by generating scripts, voiceover audio via TTS API, and composing final videos via a cloud video API. Uses a 2-stage human review cycle (script approval, then final video approval) with Memory-driven learning to improve script style, visual choices, and narration tone over time. — flow: TTS API -> Video Composition API -> Messages
- **game-character-animator** — Turns a single anchor character image into a complete animation set ready for 2D game engines. Uses AI image generation for pose-based animations (walk, run, attack, crouch, death) and procedural pixel-shift for subtle idle breathing. Normalizes every sprite sheet so the character body stays consistent and weapons overflow upward instead of squashing. — flow: Image AI -> Messages
- **newsletter-curator** — Scans web sources and RSS feeds, curates the most relevant articles using editorial intelligence, assembles themed newsletter issues with original commentary, and delivers polished HTML emails to subscribers via SMTP. Learns from editorial feedback to progressively refine source selection, topic weighting, and writing tone. — flow: Web Sources -> RSS Feeds -> Editorial Engine -> SMTP Email
- **scientific-writing-editor** — A rigorous editor agent that applies the Stanford 'Writing in the Sciences' methodology to user-submitted drafts. Flags passive voice, dead-weight phrases, weak verbs, dangling modifiers, and academic jargon -- and explains rule-by-rule WHY each change improves the sentence. Returns a side-by-side diff with rule citations and a transparent change log so the author can accept, reject, or counter-edit each suggestion. Learns from accepted/rejected edits to adapt to author voice without breaking the underlying style rules. — flow: Document Input -> Local Database -> Messages
- **social-media-designer** — Creates branded social media assets (carousels, stories, posts, covers) via the Canva Connect API. Takes a content brief, generates optimized copy, creates designs using your Canva brand kit, produces multiple variations, and presents for human review. Learns design preferences from approval patterns over time. — flow: Content Brief -> Canva -> Messages
- **youtube-content-pipeline** — Autonomous YouTube production assistant: niche-gated research → hook-first outline → voice-matched script → 3-pass AI edit (retake removal + phrase repeat + silence polish) → publish prep. Creator films once; persona handles the other 90%. — flow: YouTube Data API -> Apify -> X (Twitter) -> Deepgram -> Desktop Terminal -> Messages

### development (28)

- **autonomous-issue-resolver** — يحافظ على صحة قائمة مهام الدعم الهندسي من خلال المعالجة النشطة للمهام الراكدة في Jira. يقرأ كل خيط تعليقات، ويصنّف حالة كل مهمة، ويقيّم مشاعر المُبلِّغ، ويطابق الأعراض مع وثائق Notion وقاعدة معرفة محلية للحلول، وينشر حلولًا مع درجات ثقة، ويُصعّد المُبلِّغين الغاضبين أو عالي الأولوية إلى إدارة الهندسة، ويُنمّي قاعدة المعرفة مع كل إصلاح مؤكد.
- **autonomous-issue-resolver** — অচল Jira ইস্যুগুলিকে সক্রিয়ভাবে সমাধান করে ইঞ্জিনিয়ারিং সহায়তা ব্যাকলগকে সুস্থ রাখে। প্রতিটি মন্তব্য থ্রেড পড়ে, ইস্যুর অবস্থা শ্রেণিবদ্ধ করে, রিপোর্টারের মনোভাব মূল্যায়ন করে, উপসর্গগুলিকে Notion ডকুমেন্টেশন এবং একটি স্থানীয় সমাধান জ্ঞানভান্ডারের সাথে মেলায়, আত্মবিশ্বাস স্কোর সহ সমাধান পোস্ট করে, রাগান্বিত বা উচ্চ-অগ্রাধিকার রিপোর্টারদের ইঞ্জিনিয়ারিং ম্যানেজমেন্টে বাড়ায় এবং প্রতিটি নিশ্চিত ফিক্সের সাথে জ্ঞানভান্ডার বাড়ায়।
- **autonomous-issue-resolver** — Udržuje backlog inženýrské podpory zdravý tím, že aktivně řeší zastaralé Jira issues. Čte každé vlákno komentářů, klasifikuje stav issue, vyhodnocuje sentiment reportéra, porovnává symptomy s Notion dokumentací a lokální znalostní bází řešení, posílá navrhovaná řešení s vyhodnoceným skóre důvěry, eskaluje rozčílené nebo vysoce prioritní reportéry na inženýrský management a rozšiřuje znalostní bázi o každou potvrzenou opravu.
- **autonomous-issue-resolver** — Hält das Engineering-Support-Backlog gesund, indem er veraltete Jira-Issues aktiv bearbeitet. Liest jeden Kommentarthread, klassifiziert den Zustand jedes Issues, erfasst die Stimmung des Reporters, gleicht Symptome mit Notion-Dokumenten und einer lokalen Lösungswissensdatenbank ab, veröffentlicht konfidenzbewertete Lösungen, eskaliert verärgerte oder hochprioritäre Reporter an das Engineering-Management und erweitert die Wissensdatenbank bei jeder bestätigten Behebung.
- **autonomous-issue-resolver** — Mantiene sano el backlog de soporte de ingeniería resolviendo activamente incidencias de Jira estancadas. Lee cada hilo de comentarios, clasifica el estado de la incidencia, evalúa el sentimiento del reportero, coteja los síntomas con la documentación de Notion y una base de conocimiento local de soluciones, publica resoluciones con puntuación de confianza, escala a gerentes de ingeniería los reportes airados o de alta prioridad y hace crecer la base de conocimiento con cada solución confirmada.
- **autonomous-issue-resolver** — Maintient en bonne santé le backlog du support ingénierie en résolvant activement les tickets Jira qui traînent. Lit chaque fil de commentaires, classe l'état de chaque ticket, évalue le sentiment du rapporteur, rapproche les symptômes de la documentation Notion et d'une base de connaissances locale de solutions, publie des résolutions avec un score de confiance, escalade les rapporteurs en colère ou prioritaires aux managers ingénierie et enrichit la base de connaissances à chaque correctif confirmé.
- **autonomous-issue-resolver** — रुकी हुई Jira इश्यूज़ को सक्रिय रूप से हल करके इंजीनियरिंग सपोर्ट बैकलॉग को स्वस्थ बनाए रखता है। हर टिप्पणी थ्रेड पढ़ता है, इश्यू की स्थिति वर्गीकृत करता है, रिपोर्टर की भावना का आकलन करता है, लक्षणों को Notion दस्तावेज़ों और एक स्थानीय समाधान ज्ञान आधार से मिलाता है, आत्मविश्वास-स्कोर वाले समाधान पोस्ट करता है, गुस्साए या उच्च-प्राथमिकता वाले रिपोर्टरों को इंजीनियरिंग मैनेजमेंट तक बढ़ाता है, और हर पुष्टि किए गए फिक्स के साथ ज्ञान आधार बढ़ाता है।
- **autonomous-issue-resolver** — Menjaga backlog dukungan engineering tetap sehat dengan secara aktif menangani issue Jira yang stagnan. Membaca setiap thread komentar, mengklasifikasikan status issue, menilai sentimen pelapor, mencocokkan gejala dengan dokumentasi Notion dan basis pengetahuan solusi lokal, memposting resolusi dengan skor kepercayaan, mengeskalasi pelapor yang marah atau berprioritas tinggi ke manajemen engineering, dan menumbuhkan basis pengetahuan setiap kali ada perbaikan yang dikonfirmasi.
- **autonomous-issue-resolver** — 停滞している Jira イシューを積極的に解決し、エンジニアリングサポートのバックログを健全に保ちます。すべてのコメントスレッドを読み、イシューの状態を分類し、報告者の感情を評価し、Notion ドキュメントとローカルな解決策ナレッジベースから症状を照合し、信頼度スコア付きの解決策を投稿し、怒っている報告者や高優先度の報告者をエンジニアリングマネジメントにエスカレーションし、確認済みの修正ごとにナレッジベースを拡張します。
- **autonomous-issue-resolver** — Keeps the engineering support backlog healthy by actively resolving stale Jira issues. Reads every comment thread, classifies issue state, gauges reporter sentiment, matches symptoms against knowledge base docs and a local solutions knowledge base, posts confidence-scored resolutions, escalates angry or high-priority reporters to engineering management, and grows the knowledge base with every confirmed fix. — flow: Jira -> knowledge base -> messaging
- **autonomous-issue-resolver** — 정체된 Jira 이슈를 적극적으로 해결하여 엔지니어링 지원 백로그를 건강하게 유지합니다. 모든 댓글 스레드를 읽고, 이슈 상태를 분류하며, 보고자 감정을 평가하고, Notion 문서와 로컬 솔루션 지식베이스로부터 증상을 매칭하고, 신뢰도 점수가 있는 해결책을 게시하며, 분노한 또는 높은 우선순위의 보고자를 엔지니어링 관리자에게 에스컬레이션하고, 확인된 수정마다 지식베이스를 확장합니다.
- **autonomous-issue-resolver** — Поддерживает здоровье бэклога инженерной поддержки, активно разбирая застоявшиеся задачи Jira. Читает каждый тред комментариев, классифицирует состояние задачи, оценивает настроение репортёра, сопоставляет симптомы с документацией Notion и локальной базой знаний решений, публикует решения с оценкой уверенности, эскалирует разгневанных или высокоприоритетных репортёров менеджерам разработки и расширяет базу знаний при каждом подтверждённом исправлении.
- **autonomous-issue-resolver** — Duy trì sức khỏe của backlog hỗ trợ kỹ thuật bằng cách chủ động giải quyết các ticket Jira đình trệ. Đọc từng luồng bình luận, phân loại trạng thái vấn đề, đánh giá cảm xúc của người báo cáo, đối chiếu triệu chứng với tài liệu Notion và một cơ sở tri thức giải pháp cục bộ, đăng các giải pháp kèm điểm tin cậy, leo thang những người báo cáo giận dữ hoặc ưu tiên cao cho quản lý kỹ thuật và mở rộng cơ sở tri thức sau mỗi bản sửa được xác nhận.
- **autonomous-issue-resolver** — 通过主动处理 Jira 中停滞的工单来保持工程支持积压的健康。阅读每条评论、分类每个问题的状态、评估报告者情绪、将症状与 Notion 文档和本地解决方案知识库匹配、发布带置信度评分的解决方案、将愤怒或高优先级报告者升级给工程管理层,并在每次已确认的修复后扩充知识库。
- **build-intelligence-use-case** — Monitors CircleCI pipeline events, analyzes failed build logs to identify root causes, posts enriched messages (not just "build failed" but "failed because X in file Y"), and comments on the source control PR with fix suggestions. Tracks flaky test patterns. — flow: CircleCI -> messaging -> source control
- **codebase-health-scanner** — Monthly automated codebase health scanner that reviews context map freshness, runs multi-agent scans (security, quality, tech debt, test coverage), scores each context group, reports issues via built-in messages, and persists health snapshots for trend analysis in the Dev Tools plugin. — flow: Codebase
- **design-handoff-coordinator** — Monitors Figma file version changes, extracts updated component names, creates or updates Linear tickets for the dev team with direct Figma links, and posts handoff summaries in the design messaging channels. — flow: Figma -> Linear -> messaging
- **dev-clone** — Autonomous senior-developer clone that scans the codebase for backlog candidates, holds each for human accept/reject, implements accepted items as focused PRs, reacts to review comments via GitHub webhook, and bundles merged work into human-approved releases. Learns architecture patterns and review preferences from every triage and every comment. — flow: Codebase -> GitHub -> Messages
- **dev-lifecycle-manager** — Watches source control for new PRs, issues, and releases. Auto-creates/updates linked Jira tickets, posts status updates to the messaging channel dev channels, and flags PRs that exceed size thresholds for manual review. — flow: source control -> Jira -> messaging
- **documentation-freshness-guardian** — Scans knowledge base pages for staleness (no edits in N days), checks if referenced APIs or tools still exist, notifies page owners via email, and posts a messaging digest of stale docs. Tracks update promises in memory. — flow: knowledge base -> messaging -> email
- **feature-flag-experiment-analyst** — Monitors PostHog feature flag changes and experiment results, posts summaries to the messaging channel product channels, creates Linear follow-up tickets for winning experiment variants, and archives flags that haven't been modified in 30+ days. — flow: PostHog -> messaging -> Linear
- **feature-flag-governance-use-case** — Monitors LaunchDarkly for flag changes, posts change audit logs to the messaging channel, creates Linear cleanup tickets for flags older than 90 days, and maintains a knowledge base feature flag registry. Prevents flag naming collisions. — flow: LaunchDarkly -> messaging -> Linear -> knowledge base
- **lean-codebase-sentinel** — Fast, deterministic codebase sweep that runs a static-analysis CLI (Fallow / Knip / jscpd / your tool of choice) in a registered codebase, parses the JSON report, and pushes prioritized refactoring ideas to the Dev Tools backlog. Designed as the lightweight sibling to Codebase Health Scanner — runs daily or per-commit, costs zero LLM tokens, and produces file:line:fix evidence ready for human triage or autonomous follow-up. — flow: Codebase -> Static-Analysis CLI
- **qa-guardian** — Autonomous code reviewer that reacts to pull requests, analyzes code quality and security via the codebase connector, runs tests, scores PRs on a 1-10 scale, posts structured review comments on source control, and writes missing tests when coverage is poor. Designed as a companion to Dev Clone but works with any PR workflow. — flow: source control -> Codebase -> Messages
- **real-time-database-watcher** — Subscribes to Supabase database webhooks for specific table changes (new users, order updates, flag changes). Posts enriched notifications to the messaging channel, triggers welcome email sequences for new signups, and logs anomalous data patterns. — flow: Supabase -> messaging -> email
- **self-evolving-codebase-memory** — Builds a long-term memory layer for an entire codebase by capturing every Claude Code session via hooks, distilling lessons and decisions into structured wiki articles, and surfacing them automatically on future runs. Inspired by Karpathy-style LLM knowledge bases applied to internal conversations rather than external sources. — flow: Claude Code CLI -> Personas Memory -> In-App Messaging
- **skill-librarian** — Maintains a project's `.claude/skills/` catalog as a living artifact. Audits existing skills against recent codebase changes, proposes targeted edits or retirements via human review, and — on approval — files a GitHub or GitLab issue describing the change so a developer can apply it through their normal review workflow. Tracks per-skill usage strength via `Skill-Ref: <slug>` commit markers so weak or stale skills surface for curation over time. — flow: Codebase -> Claude Code Skills -> Human Review -> GitHub / GitLab Issues (uses: codebase,github,gitlab) [trigger: schedule,event_listener]
- **user-lifecycle-manager** — Handles auth provider auth events (signup, email change, deletion), provisions user records in Supabase, sends onboarding email sequences via email, and posts new user celebrations to the messaging channel. Handles the full user lifecycle from sign-up to churn. — flow: auth provider -> Supabase -> messaging -> email

### devops (5)

- **devops-guardian** — Unified DevOps monitoring agent that scans application errors, infrastructure metrics, database health, and deployment status from connected monitoring tools, correlates cross-domain signals (deploy-induced regressions, resource bottlenecks), triages incidents for human review, and learns from triage decisions to improve alert quality over time. — flow: Monitoring -> Database -> Deployment -> Messages
- **incident-logger** — Single source of truth for every operational incident — intake with severity classification, lifecycle tracking with escalation timers and update cadences, auto-closure for stale low-severity items, and human-approved post-incident reviews with cross-incident pattern detection. — flow: Messages
- **sentry-production-monitor** — Pulls unresolved Sentry issues daily, reads stack-trace source code across all registered codebases for cross-project root cause analysis, delivers Jira-format reports per issue, and learns from human triage which error patterns are actionable vs noise. — flow: Sentry -> Codebases -> Messages
- **telegram-ops-command-center** — AI-powered ops control plane in your team's Telegram group — authorized operators send natural language commands (health checks, deployments, rollbacks, broadcasts); destructive actions gate on YES confirmation from the initiating operator; critical events route to a messaging channel with severity color coding; daily ops summary rolls up commands, health, and deploys. — flow: Telegram -> Messages
- **workflow-error-intelligence** — Meta-observability agent that watches every other persona on the platform — subscribes to execution failure events, classifies each error by category and root cause, detects cross-workflow patterns (recurring, cascading, service-wide), sends real-time critical alerts, and delivers daily digests and weekly reliability reports. — flow: Messages

### email (1)

- **intake-processor** — Monitors email for important emails, posts summaries to relevant messaging channels based on sender/topic, and optionally creates structured knowledge base databases entries for tracking. Learns sender patterns over time via agent memory. — flow: email -> messaging -> knowledge base

### finance (12)

- **accounting-reconciliation-use-case** — Pulls finance platform transactions, reconciles them against bank feeds, logs discrepancies to spreadsheet, alerts the finance team in the messaging channel, and ships a weekly reconciliation summary by email. Learns recurring transaction patterns so predictable entries stop triggering false alerts. — flow: finance platform -> spreadsheet -> messaging -> email
- **budget-spending-monitor** — Silent-when-normal cloud cost watchdog. Pulls your weekly billing from cloud, cloud, or cloud, compares against a threshold and last week's baseline, and only messages you when something actually needs attention — threshold breach, service spike, or a brand-new service. — flow: Cloud Billing API -> Messages
- **expense-receipt-processor** — Polls email for receipts and invoices, extracts vendor/amount/date/category with AI, logs everything to a spreadsheet, and flags anomalies (duplicates, high-amounts, missing recurring charges) via the messaging channel. Ships a weekly expense summary every Friday. — flow: email -> spreadsheet -> messaging
- **finance-controller** — Keeps finance platform and spreadsheet in sync, chases overdue invoices via email with tiered reminders, flags anomalous expenses against a 30-day rolling baseline, and posts a weekly cash flow summary to the messaging channel. — flow: finance platform -> spreadsheet -> email -> messaging
- **financial-stocks-signaller** — Weekly investment research: technical signals on a watchlist, congressional trading disclosures, and under-covered sector gems. Delivers one combined Monday briefing; every recommendation is human-reviewed and reviewed decisions persist as simulated trades. — flow: Alpha Vantage -> Capitol Trades -> Messages
- **freelancer-invoice-autopilot** — Pulls monthly billable hours from your time-tracking tool (time tracking tool / time tracking tool / time tracking tool / custom), applies per-client rates, renders polished HTML invoices from a template generated during persona build, and routes them through human review so the agent learns rate overrides and billable/non-billable classifications over time. — flow: Time Tracking Tool -> Messages
- **invoice-tracker** — Detects incoming invoices in your email inbox, extracts structured fields (vendor, amount, due date, invoice number), maintains a SQLite-backed payment ledger, and proactively alerts you to upcoming and overdue payments. Learns vendor-specific email patterns so extraction sharpens over time. — flow: Email -> Local Database -> Messages
- **market-intelligence-scout** — Watches Kalshi prediction markets for new listings, rapid probability shifts, and pricing anomalies, cross-references findings with breaking news, and emails a daily intelligence digest. Every finding is scored for confidence and reviewed — memory tightens the noise filter over time. — flow: Kalshi -> News API -> email
- **personal-finance-use-case** — Syncs bank transactions from finance platform, categorizes spending, maintains a spreadsheet ledger, flags anomalous charges, and ships weekly spending summaries. Every flagged transaction carries evidence; budgets and recurring whitelists sharpen from review. — flow: finance platform -> spreadsheet -> messaging -> email
- **revenue-intelligence-copilot** — Bridges Stripe payment behavior with CRM customer context to score churn risk and expansion readiness. Alerts on threshold crossings via the messaging channel, drafts retention and upgrade outreach via email, and calibrates its own scoring against actual outcomes every month. — flow: Stripe -> CRM -> email -> messaging
- **revenue-operations-hub** — Processes Stripe subscription events in real time, maintains an spreadsheet revenue tracker, runs an escalating failed-payment recovery sequence, and ships daily revenue summaries. State persists atomically so nothing is lost. — flow: Stripe -> spreadsheet -> email
- **subscription-billing-use-case** — Processes finance platform subscription lifecycle events, maintains an spreadsheet subscriptions table, runs a 3-tier dunning sequence for failed payments, posts revenue notifications to the messaging channel, and ships monthly MRR reports with anomaly detection. — flow: finance platform -> spreadsheet -> messaging -> email

### hr (2)

- **onboarding-tracker** — Automates new-hire onboarding end-to-end via knowledge base checklists: detects new employees hourly, runs weekday deadline checks with tiered escalation, and produces weekly progress reports with at-risk flagging. — flow: knowledge base -> Local Database -> In-App Messaging
- **recruiting-pipeline-use-case** — Monitors HR platform for candidate stage transitions, sends personalized emails at each stage (acknowledgment, interview prep, rejection, offer), posts updates to hiring messaging channels, and compiles weekly recruiting funnel metrics. — flow: HR platform -> email -> messaging

### legal (3)

- **ai-contract-reviewer** — Analyzes contract documents using AI to extract key terms, financial obligations, risk factors, and red flags, creates structured review reports in knowledge base, alerts on high-risk clauses, and sends deadline reminders for renewals and obligations. — flow: email -> knowledge base -> messaging
- **contract-lifecycle-use-case** — Tracks legal platform envelope events (sent, viewed, signed, declined), updates spreadsheet contract tracker, posts messaging notifications on status changes, sends reminder emails for unsigned documents, and flags contracts approaching renewal. — flow: legal platform -> spreadsheet -> messaging -> email
- **editorial-calendar-manager** — Reads the knowledge base editorial calendar, syncs deadlines and assignments to spreadsheet for tracking, sends reminder emails to writers approaching deadlines, posts status reports, and flags content gaps in the schedule. — flow: knowledge base -> spreadsheet -> email

### marketing (6)

- **autonomous-cro-experiment-runner** — Closed-loop conversion rate optimization agent that pulls landing page analytics, identifies underperforming sections, generates A/B headline and copy variants, deploys experiments via your analytics/experimentation tool, tracks statistical lift, and promotes winners. Every variant goes through human review before deployment. Learns from accepted/rejected variants over time. — flow: Analytics Tool -> Experimentation API -> Messages
- **content-cascade** — Repurposes a published long-form artifact (YouTube video, blog post, podcast transcript) into platform-tuned text variants in your voice — LinkedIn long-form, X/Twitter thread, blog summary, and short-form video ideas. Per-platform voice docs learn from your edits; nothing publishes without explicit approval. — flow: Source Artifact -> Per-Platform Voice Docs -> Platform-Tuned Drafts -> Manual Review -> Publish / Schedule
- **reddit-trend-digest** — Polls one or more social feeds (subreddits, social platform lists, social platform groups, social platform channels) on a schedule, fetches top posts over a chosen time window, clusters them into themes with sentiment labels, and posts a markdown digest to your messaging channel. Tracks already-seen posts so each digest only surfaces what's new. — flow: Social Feed -> Trend Synthesis -> Team Messaging
- **visual-brand-asset-factory** — Generates on-brand visual assets grounded in a structured design.md brief produced once at persona build time. The brief captures empathy, sensory aesthetic language, a four-role color hierarchy, typography, and a physical-metaphor layout direction — stored in the persona's design_files envelope so every generation reads from the same design DNA. Generates via an AI image connector, evaluates with a multimodal AI connector, and presents for human review. — flow: Codebase -> Image AI -> Multimodal AI -> Messages
- **web-marketing** — Weekly cross-channel marketing intelligence. Pulls paid campaign performance and organic SEO metrics, detects keyword cannibalization between paid and organic, and proposes specific optimizations that persist through human review into a learning memory of what works. — flow: Ad Platform -> Analytics Tool -> Messages
- **website-conversion-audit** — On-demand website analysis agent specialized in auditing local service business websites (HVAC, plumbing, landscaping, roofing) for conversion optimization gaps. Scrapes and analyzes the target URL, scores gaps across 8 categories, and produces a prioritized recommendations report. Learns which gap types matter most via Memory. — flow: Website URL -> AI Analysis -> Messages

### productivity (13)

- **appointment-orchestrator** — Processes new Calendly bookings end-to-end: enriches CRM contacts and deals, sends personalized confirmation emails with prep materials, notifies the team in the messaging channel, dispatches 24h reminders and post-meeting follow-ups, and handles cancellations gracefully. — flow: Calendly -> CRM -> email -> messaging
- **daily-standup-compiler** — Personal business OS that starts each day informed, accountable, and focused. Morning briefing consolidates niche news, goal progress, pending work, and a prioritized action plan into one message. On-demand decision support builds weighted matrices with kill criteria. Weekly Sunday retrospective reviews goals and triages the week's captured ideas. — flow: Web Research -> Goals & Tasks -> Messages
- **digital-clone** — Multi-channel communication proxy across email, messaging, and messaging. Reads inbound messages, drafts replies that match your per-recipient style, routes drafts for human approval, and graduates to auto-send after 20 consecutive unedited approvals per contact. Logs everything to a local SQLite database. — flow: email -> messaging -> messaging -> Built-in Database
- **email-follow-up-tracker** — Monitors outbound email threads and delivers graduated messaging reminders when replies go overdue. Supports VIP prioritization, automatic resolution on reply detection, on-demand status reports, and memory-driven learning of per-recipient reply patterns. — flow: email -> messaging
- **email-morning-digest** — Fetches overnight email, scores by adaptive sender importance, summarises the top messages into a daily digest. — flow: email
- **email-task-extractor** — Scans email on a cadence for actionable content, applies NLP to detect explicit and implicit action items, extracts metadata (due dates, assignees, priority), and creates structured knowledge base tasks. Routes low-confidence items through human review and learns your team's patterns over time. — flow: email -> knowledge base -> Messages
- **idea-harvester** — Mines ideas from wherever the user works — messaging, knowledge base, pasted URLs, raw text — runs them through human triage, and promotes accepted items into a structured backlog with codebase-grounded feasibility analysis. — flow: messaging -> knowledge base -> Codebase -> Messages
- **meeting-lifecycle-manager** — Owns the full meeting lifecycle on calendar: contextual prep reminders 30 min before with attendee email history, real-time 'in-meeting' messaging status during, post-meeting notes + action-item distribution after, and a morning daily briefing summarizing the day's meetings. — flow: calendar -> email -> messaging
- **personal-capture-bot** — Monitors a messaging bot for captured messages (tasks, ideas, bookmarks, notes), classifies each using context, routes tasks to spreadsheet and everything else to knowledge base, confirms receipt, and delivers a nightly digest of the day's captures. — flow: messaging -> knowledge base -> spreadsheet
- **router** — Universal webhook receiver that replaces Zapier for simple automations. Accepts any webhook payload, classifies the event using signature matching + payload analysis + reasoning, and fan-outs to the messaging channel, email, knowledge base, and spreadsheet based on configurable routing rules. — flow: Webhook Ingestion -> messaging -> email -> knowledge base -> spreadsheet
- **survey-insights-analyzer** — Processes new survey responses from a local database on a cadence, applies sentiment classification and theme clustering, tracks trends across periods, flags anomalies, and delivers structured insight reports with actionable recommendations. — flow: Local Database -> In-App Messaging
- **survey-processor** — Polls Google Forms for new survey responses, scores answers using a configurable rubric, writes structured records to spreadsheet, posts tier-aware summaries to the messaging channel, and sends personalized tier-based follow-up emails via email. — flow: Google Forms -> spreadsheet -> messaging -> email
- **vault-grounded-journal-coach** — Reads new daily journal entries in your Obsidian vault, walks the vault for grounded context (past wiki articles, prior journals, meeting notes), detects recurring-struggle patterns across the last N weeks, and writes a tone-controlled reflection back into the same daily note under a `## Coach` section. Backward-looking companion to a daily-standup briefing — never a replacement for the user's own thinking, only a mirror grounded in their own knowledge. — flow: Obsidian Vault -> Personas Memory -> Messages

### project-management (4)

- **agency-client-retainer-manager** — Watches email for incoming client change requests on monthly retainers, logs them as tracked work items with SLA deadlines, applies straightforward edits through the codebases connector, and assembles monthly maintenance reports with hours, SLA compliance, site health, and upsell recommendations. — flow: email -> Codebases -> Messages
- **client-portal-orchestrator** — Runs the full agency client lifecycle on a relational knowledge base hub: verifies new signups, builds linked Client + Project pages, sends milestone emails at every phase transition, posts team updates to the messaging channel, flags stalled projects in the messaging channel, and compiles monthly portfolio reports. — flow: knowledge base -> email -> messaging -> messaging
- **deadline-synchronizer** — Keeps boards deadlines in lockstep with calendar, fires tiered messaging reminders at 48h / 4h / 15min before due, and moves overdue cards to a 'Blocked' list with an explanatory comment so nothing rots silently. — flow: project management -> calendar -> messaging
- **technical-decision-tracker** — Architecture Decision Record (ADR) specialist that captures engineering decisions with full context, structured alternatives analysis, stakeholder sign-off, and linked code references in a knowledge base databases — then runs periodic review cycles so decisions don't rot into mysterious legacy. — flow: knowledge base -> Source Control -> Messages

### research (15)

- **ai-research-report-generator** — Accepts research topics via webhook or chat, searches multiple web sources grounded in user-defined reference sources, synthesizes consultant-quality reports with confidence-scored conclusions, stores them in a knowledge base, and delivers via email and chat with full source citations. — flow: Messaging -> Knowledge Base -> Email
- **ai-weekly-research** — Weekly AI-domain intelligence digest grounded in the user's own reference sources. Tracks announcements, model releases, policy shifts, and open-source moves — synthesized into one impact-scored briefing with longitudinal trend tracking. — flow: Web Research -> Messaging
- **bi-dashboard-digest** — Consumes human-authored Redash or Metabase saved queries by id, delivers a plain-English morning summary, flags direction-aware anomalies against week-over-week snapshots, and links deep back to the BI tool for follow-up. — flow: BI -> Messaging
- **conversational-database-analyst** — Natural-language-to-SQL bridge — ask business questions in plain English, get accurate read-only SQL answers with schema introspection, conversation memory, safety validation, and audit logging. Delivered through chat; backed by the user's database credential. — flow: Database -> Messaging
- **customer-event-intelligence** — Receives product analytics events via webhook, classifies intent against a calibrated signal catalog, enriches with analytics-provider profile data, alerts sales in messaging, and logs signal patterns to the knowledge base. Pattern escalation surfaces users whose accumulated medium-intent behavior crosses a threshold. — flow: Analytics -> Messaging -> Knowledge Base
- **database-performance-monitor** — Continuous database performance monitor that builds adaptive statistical baselines during a silent learning period, then detects anomalies via direction- and correlation-aware thresholds. Severity-tiered alerts: warning context, critical escalation with root cause hypothesis and remediation options. — flow: Database -> Messaging
- **industry-intelligence-aggregator** — Monitors user-defined industry sources (RSS feeds, URL lists, watched sites), deduplicates articles, AI-summarizes with importance scoring, logs to a knowledge base, posts breaking news to messaging in real-time, and ships a categorized daily briefing via email. — flow: Web Research -> Knowledge Base -> Messaging -> Email
- **knowledge-base-health-auditor** — Treats your workspace knowledge surface like source code with a periodic test suite. Lints persona memories, vector knowledge bases, and an optional Obsidian vault for staleness, broken wikilinks, contradictions, and orphan pages — every finding routes through manual review so the human owns the prune decision. — flow: Personas Memory -> Personas Vector DB -> Obsidian Vault -> Messages
- **linkedin-watchlist-scout** — Watches a curated list of LinkedIn company pages via Bright Data's structured LinkedIn scraper. Detects new posts, senior hires, product launches, and headcount shifts. Ships score-≥4 changes via messaging in real time, then ships a weekly digest connecting cross-company patterns. Built to demonstrate Bright Data's 660+ pre-built scrapers in a real agent workflow. — flow: Source List -> Bright Data -> Messaging
- **product-analytics-briefer** — Daily product intelligence: pulls key metrics from your analytics tool, compares against goals and 7/30-day baselines, flags anomalies, delivers a plain-English briefing, and logs a longitudinal record for trend tracking. Learns which metrics matter from review feedback. — flow: Analytics Tool -> Messages -> Knowledge Base
- **product-scout** — Scans configured email sources for implementation opportunities (new connectors, API version updates, tooling), enriches findings with web research, holds each for human triage, and learns which topic areas actually ship from accept/reject feedback. — flow: Email -> Web Research -> Messages
- **product-signal-detector** — Monitors product analytics for statistically significant signals — funnel breakages, feature adoption spikes, retention shifts — and routes them via insight cards with optional auto-ticketing for critical anomalies. Persistent-warning logic escalates slow-burn regressions. — flow: Analytics Tool -> Messages -> Ticketing Tool
- **research-knowledge-curator** — Transforms web URLs into structured knowledge base pages with AI summarization, multi-dimensional taxonomy tagging, and automatic cross-referencing. Manual URL submission or scheduled RSS feed scanning; handles paywalls gracefully; maintains a controlled taxonomy across runs. — flow: Web Research -> Knowledge Base -> Messages
- **research-paper-indexer** — Monitors arXiv, PubMed, and Semantic Scholar for papers matching configurable keyword groups. Generates structured Problem-Method-Result summaries, maintains a deduplicated searchable index with cross-references, and produces periodic trend reports across your research domains. — flow: Academic APIs -> Messages
- **website-market-intelligence-profiler** — Turns a list of website URLs into a structured market intelligence database. Fetches each site, applies multi-dimensional AI classification (industry, audience, business model, value prop, company size, tech signals), writes results back to your source of truth, and delivers a landscape summary with white-space analysis. — flow: Source List -> Web Research -> Messages

### sales (14)

- **contact-enrichment-agent** — Contact intelligence agent that mines email communications for signature data and builds progressive, confidence-scored contact profiles in a local database. Batch and incremental enrichment modes feed a human-in-the-loop conflict resolver so existing records never get silently overwritten. — flow: email -> Local Database -> Messages
- **contact-sync-manager** — Always-on contact harvesting agent. Polls email continuously for new signature data, maintains a living contact database with per-field confidence scoring and full change history, and routes field-level conflicts through a batch human-review pipeline. — flow: email -> Local Database
- **crm-data-quality-auditor** — Weekly CRM hygiene agent. Detects duplicates, stale records, missing fields, and formatting inconsistencies; auto-fixes safe formatting; routes risky changes through human review; tracks a 0-100 data quality score with week-over-week trend and ships combined messaging + knowledge base reports. — flow: CRM -> knowledge base -> messaging
- **email-lead-extractor** — Always-on email lead intake. Scans inbound Primary-category email, extracts structured contacts via header + body + signature NLP, scores every candidate on a 4-signal qualification model, and routes On Fire leads through manual review while logging every step to an auditable database. — flow: email -> Local Database
- **lead-capture-pipeline** — Real-time form tool intake pipeline. Scores submissions with contextual judgment, enriches records in a CRM database with deduplication, sends tier-appropriate personalized welcome emails, and fires rich Hot / On Fire lead alerts to the sales team. — flow: form tool -> Airtable -> email -> Messaging
- **local-business-lead-prospector** — Discovers local businesses in a configured niche and location with no website or significantly outdated ones, scores each as a prospect from web presence + review signals, and maintains a persistent pipeline with status tracking and weekly re-scoring. — flow: Local Database -> Messages
- **outbound-sales-intelligence-pipeline** — Transforms raw prospect lists in spreadsheet into outreach-ready intelligence dossiers. Five-stage pipeline: verify email → enrich person → enrich company → AI analysis → cold outreach draft generation. Daily messaging summary keeps the sales team on top of pipeline health. — flow: spreadsheet -> Enrichment -> Messaging
- **personality-enriched-sales-prep** — Builds behavioral profiles of external meeting attendees from LinkedIn activity and email history, then delivers a structured knowledge base prep brief plus a pre-meeting messaging reminder tailored to each attendee's communication style and decision-making pattern. — flow: Calendar -> email -> knowledge base -> Messaging
- **sales-deal-analyzer** — Monthly win/loss analysis across all closed deals. Segments by deal size, industry, rep, lead source, stakeholder count, cycle length, and stage progression; compares against 3- and 6-month trailing averages; publishes a structured knowledge base report with executive summary, patterns, trends, and prioritized recommendations. — flow: CRM -> knowledge base
- **sales-deal-tracker** — Polls the CRM in near-real-time for Opportunity changes — stage transitions, amount shifts, close date slips — sends contextual urgency-graded alerts, captures loss reviews, and delivers a daily pipeline snapshot with velocity metrics and at-risk deal detection. — flow: CRM -> Messaging
- **sales-pipeline-autopilot** — Monitors CRM deal pipeline for stage transitions, sends personalized stage-specific follow-up emails, posts contextual team messages, flags stale deals through tiered escalation, and compiles a weekly pipeline health report. — flow: CRM -> Email -> Messaging
- **sales-proposal-generator** — Monitors the CRM for newly qualified deals, researches prospect companies via web intelligence, and generates three-tier personalized proposals in knowledge base (startup / standard / enterprise) with executive summary, needs analysis, solution mapping, timeline, ROI pricing, and next steps. Every proposal flagged for human review before client delivery. — flow: CRM -> Web Research -> knowledge base
- **sheets-e-commerce-command-center** — Continuously monitors a Shopify store: logs every order to a spreadsheet with automatic classification (high-value, international, bulk, discounted), alerts on threshold-crossing inventory, flags quality-issue refunds, and delivers a daily sales digest with rolling-average trend analysis. — flow: E-Commerce -> Spreadsheet -> Messaging
- **website-conversion-auditor** — Crawls a business website via the desktop browser, scores it across 10 conversion dimensions (contact, social proof, CTA, mobile, speed, navigation, content, design, trust, engagement), delivers a prioritized audit report with revenue-impact estimates, and produces a ready-to-paste redesign prompt for AI website builders. — flow: Browser -> Messaging

### security (3)

- **access-request-manager** — Security access governance agent that monitors a shared inbox for access requests, routes them through manager then admin approval, maintains an immutable audit trail, enforces timeout escalation, and notifies all parties via in-app messaging. — flow: email -> Local Database -> Messages
- **brand-protection-sentinel** — Generates lookalike domain variants, scans DNS + WHOIS for new registrations, analyzes hosted content for brand impersonation, scores threats, alerts on high-risk phishing via the messaging channel, and produces weekly brand protection summaries tracked in knowledge base. — flow: security lookup -> knowledge base -> messaging
- **security-vulnerability-pipeline** — Orchestrates vulnerability management end-to-end: scans source control/source control pushes via security scanner, correlates findings against open Jira security tickets to prevent duplicates, creates severity-prioritized tickets for new vulnerabilities, and alerts messaging with severity-appropriate urgency. — flow: Source Control -> security scanner -> Jira -> messaging

### support (6)

- **customer-feedback-router** — Captures new ticketing conversations, classifies feedback, deduplicates against Linear issues, creates properly labeled tickets, and keeps the product team informed via the messaging channel summaries and weekly digests. — flow: ticketing -> messaging -> Linear
- **email-support-assistant** — Processes incoming customer support emails against a structured knowledge base, sends confidence-gated auto-replies for well-matched questions, routes uncertain cases through human review with full context, and progressively learns from approved and rejected drafts. — flow: email -> Knowledge Base -> Messages
- **knowledge-base-review-cycle-manager** — Scans a knowledge base for articles due for periodic review, assigns reviewers from a rotation, dispatches email reminders, broadcasts status to the messaging channel, tracks completions, and updates Last Reviewed + Next Due dates in knowledge base. — flow: knowledge base -> messaging -> email
- **support-email-router** — Triages incoming email support emails with multi-signal priority classification, creates structured knowledge base tickets with SLA deadlines, and proactively escalates approaching SLA breaches. — flow: email -> knowledge base -> Messages
- **support-escalation-engine** — Monitors support platform for tickets breaching response-time SLAs, escalates urgent issues to the messaging channel with full context, logs escalation patterns in knowledge base, and emails the support lead with a daily escalation summary. — flow: support platform -> messaging -> knowledge base -> email
- **support-intelligence-use-case** — Triages support platform tickets with sentiment + urgency analysis, searches a knowledge base for known resolutions, routes appropriately across messaging channels, monitors SLA compliance, and enriches the KB as tickets resolve. — flow: support platform -> messaging -> knowledge base

---

## Connector Catalog (122)

### advertising (3)

- **google_ads** (OAuth, freemium) — Google Ads campaign management for creating, monitoring, and optimizing advertising campaigns via the Google Ads REST API.
- **linkedin_ads** (OAuth, free) — LinkedIn Ads — B2B campaign analytics via the LinkedIn Marketing API. Use for sponsored-content performance, lead-gen-form conversions, and audience insights on LinkedIn's surfaces.
- **meta_ads** (OAuth, free) — Meta (Facebook/Instagram) Ads — pulls campaign performance via Graph API v19. Use for ad spend, CTR, CPA, ROAS, and conversion tracking across paid social on Meta surfaces.

### ai (6)

- **deepgram** (API Key, freemium) — Deepgram speech-to-text, text-to-speech, and audio intelligence API for transcription, diarization, and voice AI.
- **elevenlabs** (API Key, freemium) — ElevenLabs AI voice generation, text-to-speech, and audio processing platform.
- **gemini_vision** (API Key, freemium) — Google Gemini Vision API for OCR, document understanding, and image analysis. Supports images and PDFs natively with up to 3,600 pages per request.
- **google_gemini** (API Key, freemium) — Google Gemini text and chat API for general-purpose generation, multi-turn conversations, embeddings, and token counting. Use this for second-opinion LLMs, cross-family consensus, and tasks where a non-Anthropic model helps (e.g. design-direction brainstorming, copywriting refreshes).
- **higgsfield** (API Key (KEY_ID:KEY_SECRET), freemium) — Higgsfield AI generative image and video platform with hosted models including Soul 2.0, Nano Banana Pro, Sora 2, Veo 3.1, Kling 3.0, and 30+ more. Supports REST API access (programmatic) and a hosted MCP server (account OAuth, no API key).
- **leonardo_ai** (API Key, freemium) — Leonardo AI generative image and video platform for creative content.

### analytics (4)

- **humbalytics** (API Key, freemium) — Humbalytics web analytics with built-in A/B experimentation, traffic attribution, heat maps, and scroll-depth tracking. Runs experiments that dynamically rewrite page content without redeploying code.
- **mixpanel** (Service Account, paid) — Mixpanel product analytics with GDPR-compliant data access.
- **posthog** (API Key, free) — PostHog product analytics, feature flags, session replay, and A/B testing.
- **twilio_segment** (Write Key, paid) — Twilio Segment customer data platform for event tracking and routing.

### automation (2)

- **n8n** (API Key, ?) — n8n workflow automation platform -- connect to push, activate, and trigger workflows directly from your agent.
- **zapier** (API Key, ?) — Zapier automation platform -- trigger Zaps via webhooks and manage workflows from your agent.

### bi (2)

- **metabase** (API Key, freemium) — Metabase open-source BI -- execute saved questions (cards), read dashboards, and manage alerts/pulses across your connected databases.
- **redash** (API Key, freemium) — Redash open-source BI -- execute saved SQL queries, read dashboards, and manage alerts across any connected database.

### browser_automation (1)

- **desktop_browser** (Local App, ?) — Browser automation via Chrome DevTools Protocol -- navigate pages, extract data, and automate web tasks. Works with Chrome, Edge, or Lightpanda (Zig-built CDP-compatible headless browser, 9-16x lighter for non-SPA workloads).

### calendar (2)

- **google_calendar** (OAuth, freemium) — Google Calendar scheduling for creating, reading, and managing calendar events via the Calendar API v3.
- **microsoft_calendar** (OAuth, freemium) — Microsoft Outlook Calendar scheduling for creating, reading, and managing calendar events via the Microsoft Graph API.

### ci_cd (2)

- **circleci** (PAT, free) — CircleCI continuous integration and delivery platform.
- **github_actions** (PAT, ?) — GitHub Actions CI/CD -- dispatch workflows, check run status, and manage automations from your agent.

### cloud (9)

- **aws_cloud** (Access Key, freemium) — Amazon Web Services access for compute, billing, storage, and other AWS services.
- **azure_cloud** (Client Credentials, freemium) — Microsoft Azure access for compute, billing, storage, and other Azure services.
- **cloudflare** (API Token, free) — Cloudflare CDN, DNS, Workers, and security services.
- **digitalocean** (PAT, paid) — DigitalOcean cloud platform for Droplets, Kubernetes, Spaces, and App Platform.
- **fly_io** (API Token, freemium) — Fly.io global application platform for running containerized apps close to users.
- **gcp_cloud** (Service Account, freemium) — Google Cloud Platform access for compute, storage, billing, and other GCP services.
- **netlify** (PAT, free) — Netlify web deployment platform with serverless functions and form handling.
- **railway** (API Token, freemium) — Railway deployment platform for running services, databases, and cron jobs.
- **vercel** (PAT, free) — Vercel frontend deployment platform with serverless functions and edge network.

### containers (2)

- **desktop_docker** (Desktop Bridge, free) — Docker container management -- list, start, stop, inspect containers and run compose stacks via desktop bridge.
- **kubernetes** (Bearer Token, free) — Kubernetes container orchestration for managing clusters, pods, and deployments.

### crm (3)

- **attio** (PAT, freemium) — Attio next-gen CRM for managing people, companies, deals, and custom objects via the Attio API v2.
- **hubspot** (PAT, paid) — HubSpot CRM for contacts, deals, marketing automation, and sales pipelines.
- **pipedrive** (API Key, paid) — Pipedrive CRM for managing deals, contacts, activities, and sales pipelines via the Pipedrive REST API.

### database (10)

- **convex** (Deploy Key, free) — Convex real-time backend-as-a-service with document database, serverless functions, and scheduling.
- **duckdb** (Database Path, free) — DuckDB embedded analytical database for OLAP workloads, Parquet, CSV, and JSON.
- **mongodb** (Connection String, free) — MongoDB document database with flexible schemas, aggregation pipelines, and Atlas cloud.
- **neon** (API Key, free) — Neon serverless Postgres with branching, autoscaling, and bottomless storage.
- **personas_database** (Built-in, ?) — Local SQLite database managed by Personas. Available on first launch -- agents can create tables, store data, and run SQL queries without any external service.
- **planetscale** (Service Token, paid) — PlanetScale serverless MySQL platform with branching and non-blocking schema changes.
- **postgres** (Connection String, free) — PostgreSQL open-source relational database with advanced SQL, JSONB, and extensibility.
- **redis** (Connection URL, free) — Redis in-memory data store for caching, queues, sessions, and real-time pub/sub.
- **supabase** (API Key, free) — Supabase open-source Firebase alternative with Postgres, auth, and realtime.
- **upstash** (REST Token, free) — Upstash serverless Redis and Kafka for low-latency data at the edge.

### design (3)

- **canva** (PAT, freemium) — Canva design platform for creating, managing, and exporting designs via the Canva Connect API.
- **figma** (PAT, free) — Figma collaborative design tool for UI/UX, prototyping, and design systems.
- **penpot** (PAT, free) — Penpot open-source design platform for prototyping, components, and design tokens.

### development (2)

- **codebase** (Project, ?) — Access local codebases registered in Dev Tools. Provides file access, context maps for quick orientation, and idea/task management for backlog tracking. Enables agents to read, search, analyze project files, create and triage ideas, and execute implementation tasks.
- **codebases** (All Projects, ?) — Aggregate view across all Dev Tools projects. Provides cross-project impact analysis, unified code search, dependency graph comparison, an agent-driven implementation pipeline (branching, diffing, testing, committing), and portfolio-level intelligence (health scores, tech radar, risk matrix). Designed as a composable puzzle piece for agentic workflows.

### ecommerce (2)

- **lemonsqueezy** (API Key, freemium) — Lemon Squeezy digital commerce platform for selling digital products, subscriptions, and SaaS via the Lemon Squeezy API v1.
- **woocommerce** (API Key, free) — WooCommerce open-source e-commerce platform for managing orders, products, and customers via the WooCommerce REST API v3.

### email (4)

- **gmail** (OAuth, freemium) — Gmail email automation for reading, sending, and managing messages via the Gmail API v1.
- **microsoft_outlook** (OAuth, freemium) — Microsoft Outlook email, calendar, and contacts automation via the Microsoft Graph API.
- **resend** (API Key, free) — Resend modern email API for developers with React Email support.
- **sendgrid** (API Key, free) — SendGrid transactional and marketing email delivery at scale.

### finance (4)

- **alpha_vantage** (API Key, freemium) — Alpha Vantage for real-time and historical stock, forex, crypto, and economic data.
- **kalshi** (API Key, freemium) — Kalshi prediction market platform for reading markets, events, order books, and settlement data.
- **ramp** (OAuth, paid) — Ramp corporate cards, expense management, and accounting automation.
- **stripe** (Secret Key, freemium) — Stripe payment processing platform -- charges, subscriptions, invoices, and Connect.

### forms (2)

- **formbricks** (API Key, free) — Formbricks open-source survey and feedback platform for in-app surveys, links, and website pop-ups.
- **tally** (PAT, freemium) — Tally free-first form builder for creating forms, surveys, and collecting responses via the Tally API.

### integration (2)

- **arcade** (API Key, freemium) — Arcade hosted MCP gateway providing thousands of enterprise-ready tools with managed OAuth and just-in-time authorization.
- **mcp_gateway** (Built-in, free) — Bundle multiple MCP servers under one credential. Attach the gateway to a persona once and inherit every member tool.

### knowledge_base (6)

- **confluence** (API Token, paid) — Confluence wiki and knowledge base for team documentation and collaboration.
- **desktop_obsidian** (Desktop Bridge, free) — Obsidian note-taking integration -- read, write, search, and navigate your knowledge vault via desktop bridge.
- **notion** (PAT, free) — Notion workspace for knowledge bases, wikis, and project management.
- **obsidian** (API Key, free) — Obsidian vault access via the Local REST API plugin for reading, writing, and searching notes.
- **obsidian_memory** (Vault, ?) — Graph-aware operations over your Obsidian vault — semantic search, backlink walking, MOC discovery, and daily-journal authoring. Powered by the Obsidian Brain plugin and exposed automatically once a vault is configured.
- **sharepoint** (OAuth, freemium) — SharePoint document management and team sites for storing, organizing, and collaborating on content via the Microsoft Graph API.

### messaging (6)

- **discord** (Bot Token, free) — Discord bot integration for server messaging, moderation, and notifications.
- **microsoft_teams** (OAuth, freemium) — Microsoft Teams messaging for sending messages, managing channels, and team collaboration via the Microsoft Graph API.
- **personas_messages** (Built-in (Local), ?) — Built-in in-app messaging channel. Agents can send notifications and messages to the Personas inbox without external services.
- **slack** (Bot Token, free) — Slack workspace messaging for channels, DMs, and workflow notifications.
- **telegram** (Bot Token, free) — Telegram bot for messaging, notifications, and group automation.
- **twilio_sms** (Account SID, paid) — Twilio SMS, voice, WhatsApp, and communication APIs.

### monitoring (2)

- **betterstack** (PAT, paid) — Better Stack uptime monitoring, incident management, and status pages.
- **sentry** (PAT, free) — Sentry application monitoring for errors, performance, and session replay.

### notifications (3)

- **knock** (API Key, freemium) — Knock notification infrastructure for orchestrating cross-channel notifications with preferences and workflows.
- **novu** (API Key, freemium) — Novu open-source notification infrastructure for in-app, email, SMS, push, and chat notifications via the Novu API.
- **ntfy** (Access Token, free) — ntfy open-source push notification service for sending notifications to phones and desktops via simple HTTP.

### personalization (1)

- **twin** (Twin, ?) — Speak as the user. Provides identity, per-channel tone, memory recall, and interaction tracking to any persona. The active twin is resolved automatically — no per-persona attach step needed.

### productivity (1)

- **google_workspace_oauth_template** (OAuth, ?) — Google Workspace consent-first template for Gmail, Drive, and Calendar automation.

### project_management (5)

- **asana** (PAT, freemium) — Asana project management for tasks, projects, and team collaboration.
- **clickup** (PAT, free) — ClickUp project management with tasks, docs, goals, and time tracking.
- **jira** (API Token, paid) — Jira issue tracking and project management for agile software teams.
- **linear** (PAT, free) — Linear issue tracking for software teams with cycles, projects, and triage.
- **monday** (PAT, paid) — Monday.com work management platform for projects, workflows, and CRM.

### research (4)

- **arxiv** (None, free) — Access arXiv preprint repository for scientific papers across physics, mathematics, computer science, and more.
- **news_api** (API Key, freemium) — News API for fetching headlines, articles, and sources from 80,000+ news outlets worldwide.
- **pubmed** (API Key, free) — Access PubMed biomedical and life sciences literature from the National Center for Biotechnology Information (NCBI).
- **semantic_scholar** (API Key, free) — Academic paper search with citation graphs, influence metrics, and paper recommendations from Semantic Scholar.

### scheduling (2)

- **cal_com** (API Key, freemium) — Cal.com open-source scheduling platform for availability and bookings.
- **calendly** (PAT, free) — Calendly scheduling for meetings and appointment automation.

### social (5)

- **buffer** (PAT, free) — Buffer social media management for scheduling and publishing.
- **linkedin** (OAuth, free) — LinkedIn professional network for profile, connections, and social posts.
- **reddit** (OAuth, free) — Reddit social network for fetching subreddit posts, comments, and trends via the Reddit OAuth API.
- **x_twitter** (Bearer Token, paid) — X (formerly Twitter) API v2 for reading tweets, searching content, tracking trends, and publishing posts.
- **youtube_data** (API Key, freemium) — YouTube Data API v3 for searching videos, fetching channel statistics, retrieving playlists, comments, and trending content.

### source_control (4)

- **azure_devops** (PAT, freemium) — Azure DevOps for repositories, work items, pipelines, and CI/CD.
- **azure_devops_org** (PAT, freemium) — Azure DevOps with org-level scoping. Pick which organization(s) and projects this credential should operate against.
- **github** (PAT, free) — GitHub for repositories, issues, pull requests, and CI/CD.
- **gitlab** (PAT, free) — GitLab for repositories, CI/CD pipelines, issues, and merge requests.

### spreadsheet (3)

- **airtable** (PAT, free) — Airtable spreadsheet-database for project tracking and data management.
- **google_sheets** (OAuth, freemium) — Google Sheets spreadsheet-as-database for reading, writing, and managing structured data via the Sheets API v4.
- **microsoft_excel** (OAuth, freemium) — Microsoft Excel spreadsheet automation for reading, writing, and managing workbook data via the Microsoft Graph API.

### storage (7)

- **aws_s3** (Access Key, freemium) — AWS S3 object storage for uploading, downloading, and managing files and buckets.
- **backblaze_b2** (Application Key, freemium) — Backblaze B2 affordable S3-compatible cloud object storage for backups, archives, and media.
- **cloudflare_r2** (API Token, freemium) — Cloudflare R2 S3-compatible object storage with zero egress fees for storing and serving files.
- **dropbox** (Access Token, free) — Dropbox cloud storage for file sync, sharing, and collaboration.
- **google_drive** (OAuth, free) — Google Drive storage — read/write files and folders via the Drive v3 API. Use as a persona's storage target for generated artifacts (reports, sprite sheets, videos, exports).
- **local_drive** (Built-in, ?) — Managed local filesystem for agent exports. Files survive app upgrades, live in the OS app-data directory, and are browsable via the Drive plugin.
- **onedrive** (OAuth, freemium) — OneDrive file storage and document management for uploading, downloading, and organizing files via the Microsoft Graph API.

### support (1)

- **crisp** (Token Pair, freemium) — Crisp customer messaging platform for live chat, helpdesk, and knowledge base via the Crisp REST API.

### time_tracking (3)

- **clockify** (API Key, freemium) — Clockify time tracking for teams with projects, reports, and timesheets.
- **harvest** (PAT, freemium) — Harvest time tracking, invoicing, and project billing for agencies and freelancers.
- **toggl** (API Token, freemium) — Toggl Track time tracking with one-click timers, projects, clients, and reports.

### vector_search (1)

- **personas_vector_db** (Built-in (Local), ?) — Local vector knowledge base powered by sqlite-vec. Store documents, create embeddings locally, and run semantic search — entirely offline, no API keys needed.

### web_scraping (3)

- **apify** (API Token, freemium) — Apify web scraping and automation platform with actors for YouTube scraping, Twitter/X scraping, and browser automation.
- **bright_data** (API Token, freemium) — Bright Data web data infrastructure -- SERP API, Web Unlocker (bypass bot detection / CAPTCHAs / geo-blocks), Web Scraper API (660+ pre-built scrapers including LinkedIn, Amazon, Instagram), Scraping Browser (managed Puppeteer/Playwright), and a 400M+ IP proxy network. Distinct from Firecrawl in offering structured per-site scrapers + production-grade unblocking + global proxies.
- **firecrawl** (API Key, freemium) — Firecrawl agent-friendly web crawling API. Converts any URL into clean markdown or structured JSON, handles JS-rendered sites, and respects robots.txt. Distinct from desktop_browser in that it runs in the cloud with no local headless browser dependency.

---

## Coverage Analysis

### Template categories by density

- development: 28  (well-covered)
- research: 15  (well-covered)
- sales: 14  (well-covered)
- content: 13  (well-covered)
- productivity: 13  (well-covered)
- finance: 12  (well-covered)
- marketing: 6
- support: 6
- devops: 5
- project-management: 4
- legal: 3
- security: 3
- hr: 2  ← **sparse, gap candidate**
- email: 1  ← **sparse, gap candidate**

### Connector categories by density

- database: 10  (well-covered)
- cloud: 9  (well-covered)
- storage: 7
- ai: 6
- knowledge_base: 6
- messaging: 6
- project_management: 5
- social: 5
- analytics: 4
- email: 4
- finance: 4
- research: 4
- source_control: 4
- advertising: 3
- crm: 3
- design: 3
- notifications: 3
- spreadsheet: 3
- time_tracking: 3
- web_scraping: 3
- automation: 2  ← **sparse, gap candidate**
- bi: 2  ← **sparse, gap candidate**
- calendar: 2  ← **sparse, gap candidate**
- ci_cd: 2  ← **sparse, gap candidate**
- containers: 2  ← **sparse, gap candidate**
- development: 2  ← **sparse, gap candidate**
- ecommerce: 2  ← **sparse, gap candidate**
- forms: 2  ← **sparse, gap candidate**
- integration: 2  ← **sparse, gap candidate**
- monitoring: 2  ← **sparse, gap candidate**
- scheduling: 2  ← **sparse, gap candidate**
- browser_automation: 1  ← **sparse, gap candidate**
- personalization: 1  ← **sparse, gap candidate**
- productivity: 1  ← **sparse, gap candidate**
- support: 1  ← **sparse, gap candidate**
- vector_search: 1  ← **sparse, gap candidate**

### Auth type distribution

- API Key: 32
- PAT: 26
- OAuth: 17
- API Token: 9
- Built-in: 3
- Bot Token: 3
- Service Account: 2
- Access Key: 2
- Desktop Bridge: 2
- Bearer Token: 2
- Connection String: 2
- Built-in (Local): 2
- Access Token: 2
- API Key (KEY_ID:KEY_SECRET): 1
- Write Key: 1
- Local App: 1
- Client Credentials: 1
- Deploy Key: 1
- Database Path: 1
- Service Token: 1
- Connection URL: 1
- REST Token: 1
- Project: 1
- All Projects: 1
- Secret Key: 1
- Vault: 1
- Account SID: 1
- Twin: 1
- None: 1
- Application Key: 1
- Token Pair: 1
