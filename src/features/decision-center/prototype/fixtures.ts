/**
 * Fixture roster for the Decision Center prototype round (Track B).
 *
 * Realistic on purpose: every chip has items, the queue mixes all three tiers,
 * and each modal type has at least one item rich enough to stress it — a
 * review carrying an alert + branches + a reason prompt, a build question with
 * fields, an idea with scored facts and evidence, a council report with tables,
 * an HTML/CSS report with inline styles, a chat thread long enough to scroll.
 *
 * English only: prototype data, not product copy. The consolidation package
 * replaces fixtures with `useDecisionRoster`.
 */
import type { ChipCount, DecisionItem, HubChip } from '../model/decisionModel';
import { chipOf, DECISION_CHIPS } from '../model/decisionModel';

const H = 3600_000;
const now = Date.parse('2026-10-06T14:00:00Z');
const ago = (hours: number) => new Date(now - hours * H).toISOString();

const SPINE = { accept: 'Approve', reject: 'Reject', skip: 'Later' } as const;

const REPORT_MD = `# Weekly pipeline health — Growth team

The Growth team shipped **14 of 17** planned runs this week. Three runs were held at review gates, two of them for more than a day.

## Throughput

| Persona | Runs | Success | Median cost |
|---|---|---|---|
| Outreach Writer | 42 | 95% | $0.04 |
| Lead Researcher | 31 | 87% | $0.11 |
| CRM Sync | 120 | 99% | $0.01 |

\`\`\`chart
Mon: 21
Tue: 34
Wed: 29
Thu: 41
Fri: 38
\`\`\`

## What needs you

1. **Lead Researcher** keeps failing on LinkedIn rate limits — consider a slower schedule.
2. The **Outreach Writer** draft for ACME has been waiting 26h at a gate.

> Recommendation: approve the schedule change below and clear the ACME gate today.

## Detail

Each failure was traced to one of three causes: provider rate limits (61%), expired credentials (27%), and a prompt regression in the qualification step (12%). The regression was introduced on Tuesday and rolled back on Thursday.
`;

const COUNCIL_MD = `# Council verdict — Unified Decision Center (architecture)

**Overall: 7.4 / 10 — ready, with two must-address items.**

## Members

| Member | Dimension | Score | Stance |
|---|---|---|---|
| Value | user value | 8.5 | strong yes |
| Craft | design quality | 7.0 | yes, if the modal is one family |
| Rivalry | vs. alternatives | 6.5 | lukewarm |
| Robustness | failure modes | 7.5 | yes |
| Economics | cost to build | 6.0 | concerned |
| Reversibility | undo cost | 8.5 | yes |

## Must address

1. **One roster or none.** Three item models coexist today; shipping a fourth would make the counts disagree.
2. **Failed is not empty.** A source that did not answer must not render as zero.

## Synthesis

The council supports the consolidation. The strongest objection (Economics) is about the prototype round's size, not its direction. Reversibility is high because existing surfaces stay as history views.
`;

const REPORT_HTML = `<!doctype html><html><head><style>
  body{font-family:Georgia,serif;margin:0;padding:48px 56px;color:#1d2433;background:#fbfaf7;line-height:1.6}
  h1{font-size:34px;margin:0 0 4px;letter-spacing:-.01em}
  .kicker{text-transform:uppercase;letter-spacing:.14em;font:600 11px system-ui;color:#8a6d3b}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:28px 0}
  .stat{background:#fff;border:1px solid #e7e2d6;border-radius:12px;padding:16px}
  .stat b{display:block;font:700 28px system-ui;color:#1d2433}
  .stat span{font:12px system-ui;color:#6b7280}
  .bar{height:10px;border-radius:5px;background:linear-gradient(90deg,#2f855a 0 72%,#e2e8f0 72%)}
  blockquote{border-left:3px solid #8a6d3b;margin:24px 0;padding:4px 16px;color:#4a5568;font-style:italic}
  table{border-collapse:collapse;width:100%;font:14px system-ui}
  td,th{border-bottom:1px solid #e7e2d6;padding:8px;text-align:left}
</style></head><body>
  <div class="kicker">Market scan · Q4</div>
  <h1>Competitor pricing moved twice this month</h1>
  <p>Three of five tracked competitors changed their entry tier. Two moved <em>down</em>, which narrows our headroom on the Team plan.</p>
  <div class="grid">
    <div class="stat"><b>−18%</b><span>Avg. entry price change</span></div>
    <div class="stat"><b>3 / 5</b><span>Competitors repriced</span></div>
    <div class="stat"><b>72%</b><span>Confidence in the scan</span></div>
  </div>
  <div class="bar"></div>
  <blockquote>Suggested next step: hold our price, add a usage-based add-on, and re-scan in two weeks.</blockquote>
  <table><tr><th>Competitor</th><th>Old</th><th>New</th></tr>
  <tr><td>Northwind</td><td>$29</td><td>$24</td></tr>
  <tr><td>Contoso</td><td>$35</td><td>$27</td></tr>
  <tr><td>Fabrikam</td><td>$19</td><td>$22</td></tr></table>
</body></html>`;

export const FIXTURE_ITEMS: DecisionItem[] = [
  {
    id: 'review:r1',
    sourceId: 'r1',
    kind: 'review',
    personaId: 'p-outreach',
    personaIcon: 'mail',
    title: 'Send the ACME follow-up sequence?',
    body: 'Outreach Writer drafted a 3-step follow-up for **ACME Corp** after the demo. Step 2 offers a 15% discount that is outside the standard band.\n\n> Hi Dana — thanks again for the time on Tuesday…',
    reasoning: 'The prospect asked about pricing twice during the demo; the discount matches the Q4 promotion.',
    tags: [
      { id: 'sev', label: 'High', tone: 'warning' },
      { id: 'team', label: 'Growth team', tone: 'neutral' },
    ],
    alert: {
      id: 'held',
      label: 'Holding a team step',
      detail: 'Approving resumes step 4 of the Growth pipeline, paused for 26h.',
      tone: 'warning',
    },
    facts: [
      { id: 'persona', label: 'Persona', value: 'Outreach Writer' },
      { id: 'waiting', label: 'Waiting', value: '26h' },
      { id: 'conf', label: 'Confidence', value: '0.82', score: { value: 8.2, max: 10 } },
    ],
    links: [{ id: 'run', label: 'Open the run' }],
    source: { label: 'Outreach Writer', sublabel: 'Growth team', color: '#7c3aed' },
    createdAt: ago(26),
    weight: 90,
    branches: [
      { id: 'edit', label: 'Remove the discount, then send', tone: 'accent', hint: 'Sends steps 1 and 3 only' },
      { id: 'delay', label: 'Send next Monday', tone: 'neutral' },
    ],
    reasonPrompts: [
      {
        on: 'reject',
        title: 'Why reject?',
        options: [
          { id: 'tone', label: 'Tone is off', value: 'tone is off' },
          { id: 'price', label: 'Discount not allowed', value: 'discount not allowed' },
          { id: 'timing', label: 'Wrong timing', value: 'wrong timing' },
        ],
        skipLabel: 'No reason',
        freeText: true,
      },
    ],
    verdictLabels: SPINE,
    severity: 'high',
  },
  {
    id: 'incident:i1',
    sourceId: 'i1',
    kind: 'incident',
    personaId: 'p-research',
    title: 'Lead Researcher: credential expired (LinkedIn)',
    body: 'Three consecutive runs failed with `401 Unauthorized` from the LinkedIn connector. The OAuth token expired at 09:12.',
    tags: [
      { id: 'sev', label: 'Critical', tone: 'danger' },
      { id: 'kind', label: 'Credential', tone: 'warning' },
    ],
    facts: [
      { id: 'first', label: 'First seen', value: '4h ago' },
      { id: 'count', label: 'Occurrences', value: '3' },
      { id: 'persona', label: 'Persona', value: 'Lead Researcher' },
    ],
    links: [{ id: 'exec', label: 'Open last execution' }],
    source: { label: 'Lead Researcher', sublabel: 'Incidents', color: '#0ea5e9' },
    createdAt: ago(4),
    weight: 95,
    branches: [
      { id: 'reconnect', label: 'Reconnect LinkedIn', tone: 'accent', hint: 'Opens the credential flow' },
      { id: 'start', label: 'Start work', tone: 'neutral' },
    ],
    verdictLabels: { accept: 'Resolve', reject: 'Dismiss', skip: 'Later' },
    severity: 'critical',
  },
  {
    id: 'approval:a1',
    sourceId: 'a1',
    kind: 'approval',
    title: 'Athena wants to pause the CRM Sync schedule',
    body: 'CRM Sync has run 120 times today with no changes found. Athena proposes pausing it until Monday to save ~$1.20/day.',
    tags: [{ id: 'risk', label: 'Low risk', tone: 'success' }],
    facts: [
      { id: 'action', label: 'Action', value: 'pause_schedule' },
      { id: 'saves', label: 'Saves', value: '$1.20 / day' },
    ],
    source: { label: 'Athena', sublabel: 'Companion' },
    createdAt: ago(1),
    weight: 70,
    branches: [],
    verdictLabels: SPINE,
  },
  {
    id: 'question:q1',
    sourceId: 'q1',
    kind: 'question',
    title: 'Invoice Parser needs two answers to continue building',
    body: 'The build paused at the "output format" step.',
    tags: [{ id: 'build', label: 'Build session', tone: 'warning' }],
    facts: [{ id: 'persona', label: 'Persona', value: 'Invoice Parser' }],
    source: { label: 'Invoice Parser', sublabel: 'Builder' },
    createdAt: ago(3),
    weight: 60,
    branches: [],
    input: {
      deferred: false,
      fields: [
        { key: 'format', prompt: 'Which output format?', kind: 'choice', options: ['CSV', 'JSON', 'Google Sheet'] },
        { key: 'currency', prompt: 'Default currency when none is printed?', kind: 'text', suggestions: ['EUR', 'USD'] },
      ],
    },
    verdictLabels: { accept: 'Submit', reject: 'Later', skip: 'Later' },
  },
  {
    id: 'council:c1',
    sourceId: 'c1',
    kind: 'council',
    title: 'Unified Decision Center — architecture',
    body: 'The council finished its deliberation. Two must-address items.',
    tags: [
      { id: 'tier', label: 'Architecture', tone: 'accent' },
      { id: 'score', label: '7.4 / 10', tone: 'success' },
    ],
    facts: [
      { id: 'members', label: 'Members', value: '6' },
      { id: 'coverage', label: 'Coverage', value: '92%', score: { value: 9.2, max: 10 } },
    ],
    source: { label: 'Council', sublabel: 'Curator' },
    createdAt: ago(20),
    weight: 65,
    branches: [],
    reasonPrompts: [
      { on: 'reject', title: 'Why send it back?', options: [], skipLabel: 'Cancel', freeText: true, placeholder: 'At least 12 characters' },
    ],
    verdictLabels: { accept: 'Approve', reject: 'Send back', skip: 'Later' },
    document: { format: 'markdown', content: COUNCIL_MD },
  },
  {
    id: 'policy:po1',
    sourceId: 'po1',
    kind: 'policy',
    title: 'Route summarisation to the fast model tier',
    body: 'Self-Tuning Fabric observed that summary steps on the premium tier score within 2% of the fast tier at 1/6 of the cost.',
    tags: [{ id: 'fabric', label: 'Self-tuning', tone: 'accent' }],
    facts: [
      { id: 'delta', label: 'Quality delta', value: '−1.8%' },
      { id: 'cost', label: 'Cost', value: '−83%', tone: 'success' },
    ],
    source: { label: 'Self-Tuning Fabric' },
    createdAt: ago(30),
    weight: 50,
    branches: [],
    verdictLabels: { accept: 'Apply', reject: 'Decline', skip: 'Later' },
  },
  {
    id: 'evolution:e1',
    sourceId: 'e1',
    kind: 'evolution',
    title: 'Promote challenger genome for Support Triage',
    body: 'Challenger beat the incumbent on 9/10 eval cases (resolution accuracy 91% vs 84%).',
    tags: [{ id: 'darwin', label: 'Darwin', tone: 'warning' }],
    facts: [{ id: 'wins', label: 'Wins', value: '9 / 10', score: { value: 9, max: 10 } }],
    source: { label: 'Support Triage' },
    createdAt: ago(40),
    weight: 48,
    branches: [],
    verdictLabels: { accept: 'Install', reject: 'Reject', skip: 'Later' },
  },
  {
    id: 'goal:g1',
    sourceId: 'g1',
    kind: 'goal',
    title: 'Goal finished: "Cut onboarding to under 5 minutes"',
    body: 'The Product team marked the goal done. Median onboarding is now **4m 12s** (was 9m 40s).',
    tags: [{ id: 'done', label: 'Awaiting sign-off', tone: 'success' }],
    facts: [{ id: 'kpi', label: 'KPI', value: '4m 12s', tone: 'success' }],
    source: { label: 'Product team' },
    createdAt: ago(50),
    weight: 30,
    branches: [{ id: 'open-board', label: 'Open goals board', tone: 'neutral' }],
    verdictLabels: { accept: 'Sign off', reject: 'Send back', skip: 'Later' },
  },
  ...(['Add retry budget to the webhook worker', 'Cache connector catalog per session', 'Split the 1,300-line triage adapter'] as const).map(
    (title, i): DecisionItem => ({
      id: `idea:d${i + 1}`,
      sourceId: `d${i + 1}`,
      kind: 'idea',
      title,
      body: [
        'Webhook deliveries retry immediately and without a ceiling; a flapping endpoint consumed 2,400 attempts yesterday.',
        'The catalog is re-fetched on every picker open (~380 ms each); a session cache removes 90% of calls.',
        '`triageAdapters.ts` mixes six adapters and their copy; splitting by kind makes each testable alone.',
      ][i]!,
      reasoning: 'Found by the nightly scan of the execution engine context.',
      evidence: ['src/engine/webhook.rs:212  retry loop has no budget', 'src/api/vault/catalog.ts:40  no cache', 'src/features/agents/quick-answer/triage/triageAdapters.ts  1342 lines'][i],
      tags: [
        { id: 'cat', label: ['Reliability', 'Performance', 'Maintainability'][i]!, tone: 'accent' },
        { id: 'origin', label: 'Scanner', tone: 'neutral' },
      ],
      facts: [
        { id: 'project', label: 'Project', value: 'Personas' },
        { id: 'effort', label: 'Effort', value: ['3', '2', '5'][i]!, score: { value: [3, 2, 5][i]!, max: 10, invert: true } },
        { id: 'impact', label: 'Impact', value: ['8', '6', '5'][i]!, score: { value: [8, 6, 5][i]!, max: 10 } },
        { id: 'risk', label: 'Risk', value: ['2', '1', '4'][i]!, score: { value: [2, 1, 4][i]!, max: 10, invert: true } },
      ],
      source: { label: 'Personas', sublabel: 'Backlog' },
      createdAt: ago(60 + i * 5),
      weight: 40 - i,
      branches: [{ id: 'build', label: 'Build now', tone: 'accent', hint: 'Accept and queue a task' }],
      verdictLabels: { accept: 'Accept', reject: 'Reject', skip: 'Later' },
    }),
  ),
  {
    id: 'incident:i2',
    sourceId: 'i2',
    kind: 'incident',
    title: 'Budget alert: Outreach Writer at 85% of monthly cap',
    body: 'Spend is tracking 20% above last month.',
    tags: [{ id: 'sev', label: 'Medium', tone: 'warning' }],
    facts: [{ id: 'spend', label: 'Spend', value: '$42.50 / $50' }],
    source: { label: 'Outreach Writer', sublabel: 'Incidents' },
    createdAt: ago(8),
    weight: 55,
    branches: [],
    verdictLabels: { accept: 'Resolve', reject: 'Dismiss', skip: 'Later' },
    severity: 'medium',
  },
  {
    id: 'message:m1',
    sourceId: 'm1',
    kind: 'message',
    title: 'Growth team asks about the ACME discount',
    body: 'Should we keep the 15% discount in the follow-up, or drop it?',
    tags: [{ id: 'team', label: 'Growth team', tone: 'neutral' }],
    facts: [],
    source: { label: 'Growth team', sublabel: 'Team channel' },
    createdAt: ago(2),
    weight: 20,
    branches: [],
    verdictLabels: { accept: 'Reply', reject: 'Done', skip: 'Later' },
    thread: {
      channelKey: 'team:growth',
      canReply: true,
      messages: [
        { id: 'm1a', author: 'user', name: 'You', body: 'Please prepare the ACME follow-up after the demo.', at: ago(30) },
        { id: 'm1b', author: 'persona', name: 'Outreach Writer', body: 'Drafted three steps. Step 2 includes the Q4 promo discount (15%).', at: ago(27) },
        { id: 'm1c', author: 'persona', name: 'Lead Researcher', body: 'ACME\'s procurement cycle closes Oct 15 — a discount could pull the deal forward.', at: ago(5) },
        { id: 'm1d', author: 'athena', name: 'Athena', body: 'The draft is held at your approval gate. **Should we keep the 15% discount, or drop it?**', at: ago(2) },
      ],
    },
  },
  {
    id: 'message:m2',
    sourceId: 'm2',
    kind: 'message',
    title: 'Invoice Parser: sample output ready',
    body: 'I processed the 12 sample invoices. 11 parsed cleanly; one had a handwritten total.',
    tags: [],
    facts: [],
    source: { label: 'Invoice Parser', sublabel: 'Persona channel' },
    createdAt: ago(6),
    weight: 18,
    branches: [],
    verdictLabels: { accept: 'Reply', reject: 'Done', skip: 'Later' },
    thread: {
      channelKey: 'persona:p-invoice',
      canReply: true,
      messages: [
        { id: 'm2a', author: 'persona', name: 'Invoice Parser', body: 'I processed the 12 sample invoices. 11 parsed cleanly; one had a handwritten total I could not read.', at: ago(6) },
      ],
    },
  },
  {
    id: 'report:rep1',
    sourceId: 'rep1',
    kind: 'report',
    title: 'Weekly pipeline health — Growth team',
    body: 'The Growth team shipped 14 of 17 planned runs this week.',
    tags: [{ id: 'prio', label: 'High', tone: 'warning' }],
    facts: [{ id: 'persona', label: 'Persona', value: 'Ops Reporter' }],
    source: { label: 'Ops Reporter', sublabel: 'Report' },
    createdAt: ago(12),
    weight: 15,
    branches: [{ id: 'chat', label: 'Follow up in chat', tone: 'accent' }],
    verdictLabels: { accept: 'Done', reject: 'Done', skip: 'Later' },
    document: { format: 'markdown', content: REPORT_MD },
  },
  {
    id: 'report:rep2',
    sourceId: 'rep2',
    kind: 'report',
    title: 'Competitor pricing moved twice this month',
    body: 'Three of five tracked competitors changed their entry tier.',
    tags: [{ id: 'prio', label: 'Normal', tone: 'neutral' }, { id: 'fmt', label: 'HTML', tone: 'accent' }],
    facts: [{ id: 'persona', label: 'Persona', value: 'Market Scout' }],
    source: { label: 'Market Scout', sublabel: 'Report' },
    createdAt: ago(18),
    weight: 12,
    branches: [{ id: 'chat', label: 'Follow up in chat', tone: 'accent' }],
    verdictLabels: { accept: 'Done', reject: 'Done', skip: 'Later' },
    document: { format: 'html', content: REPORT_HTML },
  },
];

export const FIXTURE_READY: DecisionItem[] = [
  'Rate-limit LinkedIn calls per persona',
  'Add CSV export to the incidents ledger',
  'Dark-mode contrast pass on Settings',
].map((title, i) => ({
  id: `idea:ready${i}`,
  sourceId: `ready${i}`,
  kind: 'idea',
  title,
  body: '',
  tags: [{ id: 'acc', label: 'Accepted', tone: 'success' }],
  facts: [],
  source: { label: 'Personas', sublabel: 'Ready to dispatch' },
  createdAt: ago(10 + i),
  weight: 0,
  branches: [],
  verdictLabels: { accept: 'Dispatch', reject: 'Unaccept', skip: 'Later' },
}));

/** Counts derived from fixtures. The Lab can mark a chip failed to show the error state. */
export function fixtureCounts(items: DecisionItem[], ready: DecisionItem[]): Record<HubChip, ChipCount> {
  const counts = {} as Record<HubChip, ChipCount>;
  for (const chip of DECISION_CHIPS) counts[chip] = { n: 0, lamp: 'neutral', failed: false };
  for (const item of items) {
    const c = counts[chipOf(item.kind)];
    c.n += 1;
    if (item.severity === 'critical') c.lamp = 'danger';
    else if (c.lamp !== 'danger' && (item.severity === 'high' || item.alert)) c.lamp = 'warning';
    else if (c.lamp === 'neutral') c.lamp = 'accent';
  }
  counts.ready = { n: ready.length, lamp: 'success', failed: false };
  return counts;
}
