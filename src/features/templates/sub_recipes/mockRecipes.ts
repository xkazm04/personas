import type { Recipe } from './types';

/**
 * Hand-authored seed catalog. Eight recipes spanning all six categories
 * and covering every connector that has a brand icon in CONNECTOR_META.
 *
 * Distribution:
 *   - 4 single-connector (slack-only, github-only, drive-only, gmail-only,
 *     calendar-only) → exercise the simple `eligible` path
 *   - 3 two-connector (drive+slack, github+slack, drive+gmail) → exercise
 *     the `adoptable-with-setup` flow when one of the two is wired
 *   - 1 reporting recipe with `optionalConnectors` populated to test the
 *     "enhances if wired" hint
 *
 * Variety in `bindings` deliberately hits every BindingKind so the
 * adoption-form rendering layer (Phase 2e) has real test data.
 */
export const MOCK_RECIPES: Recipe[] = [
  {
    id: '11111111-1111-1111-1111-100000000001',
    slug: 'slack-morning-digest',
    name: 'Slack morning digest',
    summary: 'Summarize overnight activity into a 7am briefing',
    description:
      'Reads messages from the channels you watch, picks out decisions, blockers, and questions for you, and posts a single digest to your briefing channel before the day starts. Tunes itself over time based on the kind of items you star or react to.',
    category: 'reporting',
    requiredConnectors: ['slack'],
    optionalConnectors: [],
    template: {
      title: 'Daily morning briefing',
      description: 'Summarize overnight Slack activity into a 7am digest',
      capabilitySummary: 'Posts a daily morning brief to {{outputChannel}} summarizing overnight activity across {{monitoredChannels}}.',
      category: 'reporting',
      suggestedTrigger: { type: 'schedule', cron: '0 7 * * 1-5', description: 'Weekdays at 7:00 AM' },
      toolHints: ['slack_get_messages', 'slack_send_message'],
      notificationChannelTypes: ['slack'],
      generationSettings: { memories: 'on', reviews: 'off', events: 'off' },
      promptTemplate:
        'Read messages posted overnight (since the last brief) in {{monitoredChannels}}. Group by topic. For each group, surface decisions, blockers, and open questions. Write a concise digest (≤300 words) and post it to {{outputChannel}} as a thread.',
    },
    bindings: [
      {
        variable: 'outputChannel',
        label: 'Briefing channel',
        description: 'Where the morning digest will be posted.',
        kind: { type: 'slack-channel' },
        required: true,
      },
      {
        variable: 'monitoredChannels',
        label: 'Monitored channels',
        description: 'Channels to scan for overnight activity. Pick 2-6 for best results.',
        kind: { type: 'slack-channel', multi: true },
        required: true,
      },
      {
        variable: 'briefTime',
        label: 'Send time',
        description: 'When the digest is posted on weekdays.',
        kind: {
          type: 'cron',
          presets: [
            { label: 'Weekdays 7am', cron: '0 7 * * 1-5' },
            { label: 'Weekdays 8am', cron: '0 8 * * 1-5' },
            { label: 'Weekdays 9am', cron: '0 9 * * 1-5' },
          ],
        },
        required: true,
        default: '0 7 * * 1-5',
      },
    ],
    isBuiltin: true,
    version: '1.0.0',
    publishedAt: '2026-05-01',
    author: 'Personas Team',
    tags: ['slack', 'digest', 'morning', 'team'],
    iconConnector: 'slack',
  },

  {
    id: '11111111-1111-1111-1111-100000000002',
    slug: 'slack-sentiment-scan',
    name: 'Slack sentiment scan',
    summary: 'Flag tense conversations before they escalate',
    description:
      'Watches the channels you specify for messages whose tone trends toward frustration, blocking, or escalation, and DMs you a heads-up with a one-line summary and a jump-link. Skips chitchat and short reactions.',
    category: 'monitoring',
    requiredConnectors: ['slack'],
    optionalConnectors: [],
    template: {
      title: 'Slack sentiment scan',
      description: 'Flag tense conversations in monitored channels',
      capabilitySummary: 'Scans {{monitoredChannels}} every {{scanInterval}} minutes; DMs {{alertDestination}} when a thread exceeds the tension threshold.',
      category: 'monitoring',
      suggestedTrigger: { type: 'polling', cron: '*/30 * * * *', description: 'Every 30 minutes' },
      toolHints: ['slack_get_messages', 'slack_send_message'],
      notificationChannelTypes: ['slack'],
      generationSettings: { memories: 'on', reviews: 'trust_llm', events: 'on' },
      promptTemplate:
        'For each monitored channel in {{monitoredChannels}}, read the last {{scanInterval}} minutes of messages. Score each thread for tension (0-10) using language signals: blocking complaints, repeated escalation, short tense replies. If any thread scores ≥{{tensionThreshold}}, DM {{alertDestination}} with: thread title, score, one-line summary, deeplink. Skip threads already flagged in the last 4 hours (use memory).',
    },
    bindings: [
      {
        variable: 'monitoredChannels',
        label: 'Channels to monitor',
        description: 'Public or private channels you want scanned.',
        kind: { type: 'slack-channel', multi: true },
        required: true,
      },
      {
        variable: 'alertDestination',
        label: 'Alert destination',
        description: 'Where the heads-up DM goes. Usually your own DM.',
        kind: { type: 'slack-channel' },
        required: true,
      },
      {
        variable: 'tensionThreshold',
        label: 'Tension threshold',
        description: 'Minimum tension score (0-10) before alerting. Lower = noisier.',
        kind: { type: 'number', min: 1, max: 10 },
        required: true,
        default: 7,
      },
      {
        variable: 'scanInterval',
        label: 'Scan window (minutes)',
        description: 'How many minutes of recent history each scan covers.',
        kind: { type: 'number', min: 5, max: 120, unit: 'min' },
        required: true,
        default: 30,
      },
    ],
    isBuiltin: true,
    version: '1.0.0',
    publishedAt: '2026-05-01',
    author: 'Personas Team',
    tags: ['slack', 'monitoring', 'sentiment'],
    iconConnector: 'slack',
  },

  {
    id: '11111111-1111-1111-1111-100000000003',
    slug: 'github-pr-review-draft',
    name: 'GitHub PR review drafter',
    summary: 'Auto-draft thoughtful review comments on large PRs',
    description:
      "When a PR over a size threshold opens in your repo, drafts a structured review covering: what the change does, what looks correct, what looks risky, and which files deserve another set of eyes. Posts as a draft review you can edit and submit — never auto-approves.",
    category: 'automation',
    requiredConnectors: ['github'],
    optionalConnectors: [],
    template: {
      title: 'GitHub PR review draft',
      description: 'Auto-draft review comments on team PRs over the size threshold',
      capabilitySummary: 'Drafts review comments on PRs over {{minLOC}} lines in {{repos}}. Always saves as draft, never submits.',
      category: 'automation',
      suggestedTrigger: { type: 'webhook', description: 'GitHub PR opened/synchronized' },
      toolHints: ['github_get_pr', 'github_get_pr_files', 'github_create_review'],
      notificationChannelTypes: [],
      generationSettings: { memories: 'on', reviews: 'on', events: 'on' },
      promptTemplate:
        'For PR #{{prNumber}} in {{repos}}, fetch the diff. If total changed LOC < {{minLOC}}, exit with no action. Otherwise: identify the change in one sentence, list 3-5 specific things that look correct (cite line ranges), list 2-4 risks or open questions (cite line ranges), and flag any file that touches public API or migrations as deserving extra attention. Save as a *draft review* on the PR — do not submit.',
    },
    bindings: [
      {
        variable: 'repos',
        label: 'Repositories',
        description: 'Repos to monitor for PRs. Use owner/repo format.',
        kind: { type: 'github-repo', multi: true },
        required: true,
      },
      {
        variable: 'minLOC',
        label: 'Minimum size (LOC)',
        description: 'Skip PRs smaller than this — review noise on tiny changes is worse than none.',
        kind: { type: 'number', min: 50, max: 2000, unit: 'lines' },
        required: true,
        default: 200,
      },
    ],
    isBuiltin: true,
    version: '1.0.0',
    publishedAt: '2026-05-01',
    author: 'Personas Team',
    tags: ['github', 'pr', 'code-review'],
    iconConnector: 'github',
  },

  {
    id: '11111111-1111-1111-1111-100000000004',
    slug: 'drive-folder-digest',
    name: 'Drive folder weekly digest',
    summary: 'Weekly summary of new docs in a shared folder',
    description:
      'Once a week, scans a Google Drive folder for newly added or modified documents and produces a concise digest — title, who changed it, one-paragraph summary of what changed. Delivers to Slack (when wired) or as a self-DM otherwise.',
    category: 'data-sync',
    requiredConnectors: ['google_drive'],
    optionalConnectors: ['slack'],
    template: {
      title: 'Drive folder digest',
      description: 'Weekly digest of new + modified docs in {{watchedFolder}}',
      capabilitySummary: 'Summarizes new + modified docs in {{watchedFolder}} every {{digestDay}} morning.',
      category: 'data-sync',
      suggestedTrigger: { type: 'schedule', cron: '0 9 * * 1', description: 'Mondays at 9:00 AM' },
      toolHints: ['google_drive_list_files', 'google_drive_read_doc'],
      notificationChannelTypes: ['slack'],
      generationSettings: { memories: 'on', reviews: 'off', events: 'off' },
      promptTemplate:
        'List files in {{watchedFolder}} modified since the last digest. For each file: title, modifier, one-paragraph summary of the change (read content if document, list new sections if doc). Group by author. Format as markdown. Deliver to {{deliveryChannel}}.',
    },
    bindings: [
      {
        variable: 'watchedFolder',
        label: 'Watched folder',
        description: 'Drive folder to scan each week.',
        kind: { type: 'google-drive-folder' },
        required: true,
      },
      {
        variable: 'digestDay',
        label: 'Digest day',
        description: 'Which day of the week the digest runs.',
        kind: {
          type: 'enum',
          options: [
            { value: '1', label: 'Monday' },
            { value: '2', label: 'Tuesday' },
            { value: '5', label: 'Friday' },
          ],
        },
        required: true,
        default: '1',
      },
      {
        variable: 'deliveryChannel',
        label: 'Delivery channel',
        description: 'Slack channel that receives the digest. Skip to use self-DM.',
        kind: { type: 'slack-channel' },
        required: false,
      },
    ],
    isBuiltin: true,
    version: '1.0.0',
    publishedAt: '2026-05-01',
    author: 'Personas Team',
    tags: ['drive', 'digest', 'weekly', 'docs'],
    iconConnector: 'google_drive',
  },

  {
    id: '11111111-1111-1111-1111-100000000005',
    slug: 'gmail-inbox-triage',
    name: 'Gmail inbox triage',
    summary: 'Sort incoming email by urgency and topic',
    description:
      'Watches your Gmail inbox and labels each new message by urgency and topic, applying labels you choose. Flags anything that looks time-sensitive for human review — never auto-archives or auto-replies.',
    category: 'communication',
    requiredConnectors: ['gmail'],
    optionalConnectors: [],
    template: {
      title: 'Gmail inbox triage',
      description: 'Categorize incoming Gmail by urgency + topic',
      capabilitySummary: 'Labels new Gmail messages by urgency and topic. Polls every {{pollingFrequency}}.',
      category: 'communication',
      suggestedTrigger: { type: 'polling', cron: '*/10 * * * *', description: 'Every 10 minutes' },
      toolHints: ['gmail_list_messages', 'gmail_apply_label'],
      notificationChannelTypes: [],
      generationSettings: { memories: 'on', reviews: 'on', events: 'on' },
      promptTemplate:
        'For each new message in the inbox: classify as one of {{urgencyLabels}}, classify topic as one of {{topicLabels}}, apply the matching Gmail labels. If urgency is "critical" or "needs-response-today", queue for human review with the subject + a one-line summary. Never archive or reply automatically.',
    },
    bindings: [
      {
        variable: 'urgencyLabels',
        label: 'Urgency labels',
        description: 'Gmail labels for urgency classification.',
        kind: {
          type: 'enum',
          options: [
            { value: 'critical', label: 'Critical' },
            { value: 'needs-response-today', label: 'Needs response today' },
            { value: 'this-week', label: 'This week' },
            { value: 'fyi', label: 'FYI' },
          ],
          multi: true,
        },
        required: true,
        default: ['critical', 'needs-response-today', 'this-week', 'fyi'],
      },
      {
        variable: 'topicLabels',
        label: 'Topic labels',
        description: 'Free-form Gmail labels for topic. Comma-separate.',
        kind: { type: 'text', placeholder: 'team, customer, ops, finance' },
        required: true,
        default: 'team, customer, ops, finance',
      },
      {
        variable: 'pollingFrequency',
        label: 'Polling frequency',
        description: 'How often the inbox is scanned.',
        kind: {
          type: 'enum',
          options: [
            { value: '*/5 * * * *', label: 'Every 5 minutes' },
            { value: '*/10 * * * *', label: 'Every 10 minutes' },
            { value: '*/30 * * * *', label: 'Every 30 minutes' },
          ],
        },
        required: true,
        default: '*/10 * * * *',
      },
    ],
    isBuiltin: true,
    version: '1.0.0',
    publishedAt: '2026-05-01',
    author: 'Personas Team',
    tags: ['gmail', 'triage', 'inbox'],
    iconConnector: 'gmail',
  },

  {
    id: '11111111-1111-1111-1111-100000000006',
    slug: 'github-issue-to-slack',
    name: 'GitHub issues → Slack',
    summary: 'Mirror new GitHub issues into a Slack channel',
    description:
      'Watches one or more repos for newly opened issues. When an issue lands that matches your label filter, posts a structured Slack message — title, author, body excerpt, link — to the channel you choose. Bidirectional: thread replies in Slack can be mirrored back as issue comments (opt-in).',
    category: 'communication',
    requiredConnectors: ['github', 'slack'],
    optionalConnectors: [],
    template: {
      title: 'GitHub issues → Slack',
      description: 'Mirror new issues from {{repo}} into {{notifyChannel}}',
      capabilitySummary: 'Posts new GitHub issues from {{repo}} into {{notifyChannel}}, filtered by label "{{labelFilter}}".',
      category: 'communication',
      suggestedTrigger: { type: 'webhook', description: 'GitHub issue opened' },
      toolHints: ['github_get_issue', 'slack_send_message'],
      notificationChannelTypes: ['slack'],
      generationSettings: { memories: 'off', reviews: 'off', events: 'on' },
      promptTemplate:
        'When a new issue opens in {{repo}}: if any label matches "{{labelFilter}}" (or filter is empty, accept all), post to {{notifyChannel}}: issue title, author, first 200 chars of body, link. Use Slack block kit for clean formatting.',
    },
    bindings: [
      {
        variable: 'repo',
        label: 'Repository',
        description: 'GitHub repo to watch in owner/repo format.',
        kind: { type: 'github-repo' },
        required: true,
      },
      {
        variable: 'notifyChannel',
        label: 'Slack channel',
        description: 'Where new issues appear.',
        kind: { type: 'slack-channel' },
        required: true,
      },
      {
        variable: 'labelFilter',
        label: 'Label filter',
        description: 'Only mirror issues with this label. Leave empty for all.',
        kind: { type: 'text', placeholder: 'bug, urgent, customer' },
        required: false,
      },
    ],
    isBuiltin: true,
    version: '1.0.0',
    publishedAt: '2026-05-01',
    author: 'Personas Team',
    tags: ['github', 'slack', 'issues', 'integration'],
    iconConnector: 'github',
  },

  {
    id: '11111111-1111-1111-1111-100000000007',
    slug: 'calendar-daily-brief',
    name: 'Calendar daily brief',
    summary: 'Morning summary of today\'s meetings',
    description:
      'Each morning, lists today\'s meetings with attendee context (who else is on the call, recent shared docs, last meeting summary if any) so you walk in prepared. Skips solo blocks and recurring "focus" placeholders.',
    category: 'reporting',
    requiredConnectors: ['google_calendar'],
    optionalConnectors: ['slack', 'google_drive'],
    template: {
      title: 'Calendar daily brief',
      description: 'Morning summary of today\'s meetings with prep context',
      capabilitySummary: 'Posts a daily meeting brief to {{deliveryChannel}} summarizing today\'s calendar.',
      category: 'reporting',
      suggestedTrigger: { type: 'schedule', cron: '30 8 * * 1-5', description: 'Weekdays at 8:30 AM' },
      toolHints: ['google_calendar_list_events', 'slack_send_message'],
      notificationChannelTypes: ['slack'],
      generationSettings: { memories: 'on', reviews: 'off', events: 'off' },
      promptTemplate:
        'List events on {{calendar}} for today. Skip solo blocks and recurring placeholders. For each meeting, summarize: time, title, attendees, any linked Drive doc (if Drive is wired), last meeting summary if recurring (use memory). Format as markdown bullet list. Send to {{deliveryChannel}} at the configured time.',
    },
    bindings: [
      {
        variable: 'calendar',
        label: 'Calendar',
        description: 'Which calendar to summarize.',
        kind: { type: 'google-calendar' },
        required: true,
      },
      {
        variable: 'deliveryChannel',
        label: 'Delivery channel',
        description: 'Slack channel or self-DM where the brief lands.',
        kind: { type: 'slack-channel' },
        required: false,
      },
      {
        variable: 'sendTime',
        label: 'Send time',
        description: 'When the brief is delivered.',
        kind: {
          type: 'cron',
          presets: [
            { label: 'Weekdays 8:00 AM', cron: '0 8 * * 1-5' },
            { label: 'Weekdays 8:30 AM', cron: '30 8 * * 1-5' },
            { label: 'Weekdays 9:00 AM', cron: '0 9 * * 1-5' },
          ],
        },
        required: true,
        default: '30 8 * * 1-5',
      },
    ],
    isBuiltin: true,
    version: '1.0.0',
    publishedAt: '2026-05-01',
    author: 'Personas Team',
    tags: ['calendar', 'daily', 'meetings', 'prep'],
    iconConnector: 'google_calendar',
  },

  {
    id: '11111111-1111-1111-1111-100000000008',
    slug: 'drive-doc-mailout',
    name: 'Drive doc → email summary',
    summary: 'Email a doc summary when something new lands in Drive',
    description:
      'When a new document is added to a watched Drive folder, drafts a one-paragraph summary plus a link and emails it to the recipient list you pick. Skips short edits to existing docs.',
    category: 'communication',
    requiredConnectors: ['google_drive', 'gmail'],
    optionalConnectors: [],
    template: {
      title: 'Drive doc → email summary',
      description: 'Email a doc summary when new content lands in {{watchedFolder}}',
      capabilitySummary: 'Emails {{recipients}} a one-paragraph summary when a new doc appears in {{watchedFolder}}.',
      category: 'communication',
      suggestedTrigger: { type: 'polling', cron: '*/15 * * * *', description: 'Every 15 minutes' },
      toolHints: ['google_drive_list_files', 'google_drive_read_doc', 'gmail_send_message'],
      notificationChannelTypes: ['email'],
      generationSettings: { memories: 'off', reviews: 'on', events: 'off' },
      promptTemplate:
        'List files added to {{watchedFolder}} since the last run. For each *new* file (not edits to existing): read content, write a one-paragraph summary in {{summaryStyle}} style, and send an email to {{recipients}} with subject "{{watchedFolder}}: <doc title>", body containing the summary, the doc link, and the author. Skip if title contains "[draft]".',
    },
    bindings: [
      {
        variable: 'watchedFolder',
        label: 'Watched folder',
        description: 'Drive folder where new docs trigger an email.',
        kind: { type: 'google-drive-folder' },
        required: true,
      },
      {
        variable: 'recipients',
        label: 'Recipients',
        description: 'Email addresses that receive each summary.',
        kind: { type: 'email-address', multi: true },
        required: true,
      },
      {
        variable: 'summaryStyle',
        label: 'Summary style',
        description: 'Tone of the email summary.',
        kind: {
          type: 'enum',
          options: [
            { value: 'executive', label: 'Executive (3 bullets)' },
            { value: 'detailed', label: 'Detailed (paragraph)' },
            { value: 'one-liner', label: 'One-liner (1 sentence)' },
          ],
        },
        required: true,
        default: 'detailed',
      },
    ],
    isBuiltin: true,
    version: '1.0.0',
    publishedAt: '2026-05-01',
    author: 'Personas Team',
    tags: ['drive', 'gmail', 'docs', 'mailout'],
    iconConnector: 'google_drive',
  },
];
