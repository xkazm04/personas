// Section d: three compositions the operator knows (an Events row, a KPI
// card header, a Manifest section head), rendered both ways, plus the D6
// trap: utilities that are dead today and come alive after the layer move.
import { Bot, UserCheck, Webhook } from 'lucide-react';
import { Section, Split, type Mode, type View } from '../parts';
import { SAMPLE } from '../specimenData';

// Events rows. CURRENT classes are the ones eventLogColumns.tsx ships
// (trigger tone map, typo-body cells, EVENT_STATUS_COLORS pills).
const ROWS = [
  { icon: Bot, name: SAMPLE.agent, type: 'Invoice matched', status: 'completed', when: '4 min ago',
    cur: { tone: 'text-violet-400', type: 'text-emerald-400', pill: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    pro: { tone: 'text-role-agent', pill: 'bg-status-success/10 text-status-success border-status-success/30' } },
  { icon: Webhook, name: 'Stripe webhook', type: 'Payment received', status: 'processing', when: '12 min ago',
    cur: { tone: 'text-cyan-400', type: 'text-cyan-400', pill: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
    pro: { tone: 'text-role-external', pill: 'bg-status-info/10 text-status-info border-status-info/30' } },
  { icon: UserCheck, name: 'Manual review', type: 'Approval requested', status: 'pending', when: '1 h ago',
    cur: { tone: 'text-emerald-400', type: 'text-amber-400', pill: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    pro: { tone: 'text-role-human', pill: 'bg-status-warning/10 text-status-warning border-status-warning/30' } },
];

function EventRows({ mode }: { mode: Mode }) {
  return (
    <div data-compose="list-row">
      {ROWS.map((r) => {
        const Icon = r.icon;
        const cur = mode === 'current';
        return (
          <div key={r.name} className="sp-listrow">
            <span className={`sp-icon ${cur ? r.cur.tone : r.pro.tone}`}><Icon className="w-3.5 h-3.5" /></span>
            <span className={cur ? 'typo-body text-foreground' : 'typo-title text-foreground'}>{r.name}</span>
            <span className={cur ? `typo-body ${r.cur.type}` : 'typo-body text-foreground'}>{r.type}</span>
            <span className={`sp-chip typo-body ${cur ? r.cur.pill : r.pro.pill}`}>{r.status}</span>
            <span className={cur ? 'typo-body text-foreground' : 'typo-caption tabular-nums'}>{r.when}</span>
          </div>
        );
      })}
    </div>
  );
}

function CardHeader({ mode }: { mode: Mode }) {
  const cur = mode === 'current';
  return (
    <div className="sp-card" data-compose="card-header">
      <div className="sp-card-head">
        <div className="sp-stack">
          <div className="typo-title">{SAMPLE.agent}</div>
          <div className="typo-caption">Runs completed, {SAMPLE.label.toLowerCase()}</div>
        </div>
        <span className={`sp-chip typo-label ${cur ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-status-success/10 text-status-success border-status-success/30'}`}>+12%</span>
      </div>
      <div className="typo-data-lg text-foreground" style={{ marginTop: '0.75rem' }}>{SAMPLE.metric}</div>
      <div className="typo-caption tabular-nums">of 1,310 scheduled; 26 retried</div>
    </div>
  );
}

function SectionHead({ mode }: { mode: Mode }) {
  const cur = mode === 'current';
  return (
    <div className="sp-stack" data-compose="section-head">
      <div className={cur ? 'typo-heading uppercase tracking-wider text-foreground' : 'typo-eyebrow text-ink-muted'}>{SAMPLE.eyebrow}</div>
      <div className={`typo-section-title ${cur ? '' : 'text-foreground'} sp-hair`}>{SAMPLE.section}</div>
      <div className="typo-body text-foreground">Three connectors are waiting for a credential before this agent can run on its own.</div>
    </div>
  );
}

function Trap() {
  return (
    <div className="sp-stack" data-compose="d6-trap">
      <div className="typo-title text-status-error font-bold tracking-wider">typo-title text-status-error font-bold tracking-wider</div>
      <div className="typo-body text-lg">typo-body text-lg</div>
      <div className="typo-heading font-normal">typo-heading font-normal</div>
      <div className="typo-caption">Current: each utility loses to the unlayered token, so the line renders as the token alone. Proposed: the tokens sit in a layer and every utility applies. Deleting the dead utilities FIRST keeps the look unchanged (D6).</div>
    </div>
  );
}

export function Compositions({ view }: { view: View }) {
  return (
    <Section id="compose" title="Compositions" note="Events row, KPI card header, Manifest section head, and the D6 trap.">
      <Split view={view}>
        {(mode) => (
          <div className="sp-stack-lg">
            <div className="typo-label text-foreground">List row (Events)</div>
            <EventRows mode={mode} />
            <div className="typo-label text-foreground">Card header (KPI stat)</div>
            <CardHeader mode={mode} />
            <div className="typo-label text-foreground">Section head (Manifest)</div>
            <SectionHead mode={mode} />
            <div className="typo-label text-foreground">The D6 trap: dead today, alive after the layer move</div>
            <Trap />
          </div>
        )}
      </Split>
    </Section>
  );
}
