/**
 * `kit/tiles-a` and `kit/tiles-b`: the kit grow-3 dashboard tile in its two looks (A Spine, B
 * Band), proven on the Cockpit's composed-a ops landing recomposed FROM KIT PARTS ONLY, on the
 * same data as the H0 tape (kitTilesData.ts), plus two stacked hosts: Athena's chat column and
 * the council evidence well. Harness-only; the look switch is the kit-internal
 * `data-kit-tile-look` attribute, never a prop. Words are the tape's; the rest are specimen
 * fixtures, not product copy.
 */
/* eslint-disable custom/no-hardcoded-jsx-text -- specimen fixtures in a harness-only view, not product copy */
import type { ComponentType, ReactNode } from 'react';
import {
  Dot, KitButton, KitHost, ListRow, Meta, Rows, Section, StatStrip, Surface, Tile, Tiles, UnitStrip, apportion, quantumFor,
  type StatTile,
} from '@/features/shared/components/kit';
import { age, tilesData, toneOf } from './kitTilesData';

type Row = Record<string, unknown>;
const noop = () => {};
const s = (v: unknown) => (v == null ? '' : String(v));

/** The callout's text: paragraphs, **bold** and "- " bullets, as the widget's markdown has them. */
function Rich({ text }: { text: string }) {
  const inline = (line: string) => line.split(/\*\*(.+?)\*\*/g).map((p, i) => (i % 2 ? <strong key={i} className="k-strong">{p}</strong> : p));
  return (
    <div className="k-in typo-body" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: '96ch' }}>
      {text.split('\n\n').map((block, i) => block.startsWith('- ')
        ? <ul key={i} style={{ margin: 0, paddingLeft: 18 }}>{block.split('\n').map((l, j) => <li key={j}>{inline(l.slice(2))}</li>)}</ul>
        : <p key={i} style={{ margin: 0 }}>{inline(block)}</p>)}
    </div>
  );
}

function metricTile(c: Row, total: Row): StatTile {
  const tone = toneOf(c.intent === 'default' ? 'info' : c.intent);
  const note = <span className={c.intent === 'default' ? 'typo-caption' : `typo-caption k-toned t-${tone}`}>{s(c.delta)}</span>;
  let draw: ReactNode;
  if (c.label === 'Runs this week') {
    const q = quantumFor(Number(total.totalExecutions), 40);
    draw = <UnitStrip size="s" label="1,284 runs, 121 failed" legend={`${q} runs`} segments={apportion([{ value: Number(total.successfulExecutions), tone: 'success' }, { value: Number(total.failedExecutions), tone: 'error' }], q)} />;
  } else if (c.unit === 'issues') {
    draw = <UnitStrip size="s" label={`${s(c.value)} issues`} segments={[{ n: Number(c.value), tone: 'error' }]} />;
  }
  return { label: s(c.label), value: s(c.value), unit: c.unit ? s(c.unit) : undefined, note, draw };
}

function personaMark(p: Row) {
  if (p.setup_status !== 'ready') return { tone: 'info' as const, glyph: 'hollow' as const, label: 'Needs setup' };
  if (!p.enabled) return { tone: 'neutral' as const, glyph: 'hollow' as const, label: 'Paused' };
  if (Number(p.trust_score) < 0.5) return { tone: 'error' as const, label: 'Low trust' };
  return { tone: 'success' as const, glyph: 'soft' as const, label: 'Healthy' };
}

function Landing() {
  const d = tilesData();
  const pct = (v: unknown) => `${Math.round(Number(v) * 100)}%`;
  return (
    <Section title={d.title} level={1} meta="Composed by Athena">
      <Tiles label={d.title}>
        <Tile span={12} title={d.callout.title}><Rich text={d.callout.body} /></Tile>
        {d.metrics.map((m) => <Tile key={s(m.label)} span={4}><StatStrip tiles={[metricTile(m, d.metricsSummary)]} /></Tile>)}
        <Tile span={12} title="Fleet vitals">
          <StatStrip tiles={d.vitals.map((v) => ({ label: s(v.label), value: s(v.value), unit: v.unit ? s(v.unit) : undefined, note: v.delta ? <span className={`typo-caption k-toned t-${toneOf(v.intent)}`}>{s(v.delta)}</span> : undefined }))} />
        </Tile>
        <Tile span={12} title="Your fleet" count={d.personas.length} meta="trust, model, setup">
          <Rows count={d.personas.length} cap={8} empty={{ title: 'No agents yet' }} label="Your fleet">
            {d.personas.map((p) => (
              <ListRow key={s(p.id)} size="s" name={s(p.name)} mark={personaMark(p)} onPress={noop}
                meta={<Meta parts={[s(p.model_profile).replace('claude-', '') || 'no model', p.setup_status !== 'ready' ? s(p.setup_detail) : null]} />}
                figures={<span className="k-fig typo-data k-regular">{pct(p.trust_score)}</span>} />
            ))}
          </Rows>
        </Tile>
        <Tile span={7} title="Decisions to make" count={`${d.decisions.rows.length} of ${d.decisions.total}`}>
          <Rows count={d.decisions.rows.length} cap={6} empty={{ title: 'Nothing waits on you' }} label="Decisions to make">
            {d.decisions.rows.map((r) => (
              <ListRow key={s(r.id)} size="s" name={s(r.title)} mark={{ tone: toneOf(r.severity), glyph: r.kind === 'Message' ? 'soft' : 'solid', label: s(r.severity) }}
                meta={<Meta parts={[s(r.kind), s(r.persona_name)]} />} time={age(r.created_at)} onPress={noop} />
            ))}
          </Rows>
        </Tile>
        <Tile span={5} title="Connected services" count={d.services.length}>
          <Rows count={d.services.length} empty={{ title: 'No services' }}>
            {d.services.map((c) => (
              <ListRow key={s(c.id)} size="s" name={s(c.name)} time={age(c.last_used_at)}
                mark={c.healthcheck_last_success ? { tone: 'success', glyph: 'soft', label: 'Healthy' } : { tone: 'error', label: 'Failing' }}
                meta={c.healthcheck_last_success ? s(c.service_type) : <span className="k-toned t-error">{s(c.healthcheck_last_message)}</span>} />
            ))}
          </Rows>
        </Tile>
        <Tile span={7} title="Needs attention" count={d.issues.length}>
          <Rows count={d.issues.length} cap={6} empty={{ title: 'Nothing needs you.' }} label="Needs attention">
            {d.issues.map((i) => <ListRow key={s(i.id)} size="s" name={s(i.title)} meta={s(i.sublabel)} mark={{ tone: toneOf(i.severity), label: s(i.severity) }} onPress={noop} />)}
          </Rows>
        </Tile>
        <Tile span={5} title="Last night, in order" count={d.timeline.length}>
          <Rows count={d.timeline.length} empty={{ title: 'Nothing happened' }}>
            {d.timeline.map((e, i) => <ListRow key={i} size="line" name={s(e.label)} nameClass="typo-body" mark={{ tone: toneOf(e.intent), glyph: 'soft', label: s(e.intent) }} time={age(e.timestamp)} />)}
          </Rows>
        </Tile>
        {d.broke && (
          <Tile span={7} title={s(d.broke.title)} footer={<>{(d.broke.actions ?? []).map((a) => <KitButton key={s(a.label)} onClick={noop}>{s(a.label)}</KitButton>)}</>}>
            <Rows count={((d.broke.config.items ?? []) as Row[]).length} empty={{ title: '' }}>
              {((d.broke.config.items ?? []) as Row[]).map((i) => <ListRow key={s(i.id)} size="s" name={s(i.title)} meta={s(i.sublabel)} mark={{ tone: toneOf(i.severity), label: s(i.severity) }} />)}
            </Rows>
          </Tile>
        )}
        {d.waiting && (
          <Tile span={5} title={s(d.waiting.title)} footer={<><KitButton tone="primary" onClick={noop}>Approve</KitButton><KitButton onClick={noop}>Decline</KitButton></>}>
            <div className="k-in" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="typo-heading k-strong"><Dot tone="success" glyph="solid" /> {s(d.waiting.config.headline)}</span>
              <span className="typo-body">{s(d.waiting.config.reasoning)}</span>
            </div>
          </Tile>
        )}
        <Tile span={4} title="Loading tile" state="loading" ghostRows={2} />
        <Tile span={4} title="Empty tile" state="empty" empty={{ title: 'Nothing composed here yet', hint: 'Ask Athena to add a widget.' }} />
        <Tile span={4} title="Error tile" error={{ title: 'Could not load services', action: <KitButton onClick={noop}>Retry</KitButton> }} />
      </Tiles>
    </Section>
  );
}

/** Athena's chat column (912 px) and the council evidence well: tiles stacked at the kit gap. */
function Stacks() {
  const d = tilesData();
  const uc = (d.chat.find((c) => c.kind === 'use_case_set')?.config.use_cases ?? []) as Row[];
  const ready = (d.chat.find((c) => c.kind === 'persona_ready')?.config.summary ?? {}) as Row;
  const spend = d.metrics[1] ?? {};
  const findings = d.seat.findings ?? [];
  const ev = d.seat.evidence ?? [];
  return (
    <>
      <Section title="Stacked: Athena chat" level={1} meta="cols={1}, 912 px">
        <div style={{ maxWidth: 912 }}>
          <Tiles label="Chat cards" cols={1}>
            <Tile><StatStrip tiles={[metricTile(spend, d.metricsSummary)]} /></Tile>
            <Tile title="Needs attention" count={d.issues.length}>
              <Rows count={d.issues.length} cap={4} empty={{ title: '' }} label="Needs attention">
                {d.issues.map((i) => <ListRow key={s(i.id)} size="s" name={s(i.title)} meta={s(i.sublabel)} mark={{ tone: toneOf(i.severity), label: s(i.severity) }} />)}
              </Rows>
            </Tile>
            <Tile title="Use cases" count={uc.length}>
              <Rows count={uc.length} empty={{ title: '' }}>
                {uc.map((u) => <ListRow key={s(u.label)} size="s" name={s(u.label)} meta={s(u.description)} mark={{ tone: u.role === 'golden' ? 'success' : u.role === 'variant' ? 'info' : 'neutral', glyph: 'soft', label: s(u.role) }} />)}
              </Rows>
            </Tile>
            <Tile title="Ready to build" footer={<><KitButton tone="primary" onClick={noop}>Build it</KitButton><KitButton quiet onClick={noop}>Keep refining</KitButton></>}>
              <p className="k-in typo-body" style={{ margin: 0 }}>{s(ready.system_prompt_outline)}</p>
            </Tile>
          </Tiles>
        </div>
      </Section>
      <Section title="Stacked: council evidence well" level={1} meta="cols={1}">
        <div style={{ maxWidth: 760 }}>
          <Tiles label="Evidence" cols={1}>
            <Tile title="What it found" count={findings.length}>
              <Rows count={findings.length} empty={{ title: '' }}>
                {findings.map((f) => <ListRow key={s(f.id)} size="s" name={s(f.title)} meta={s(f.detail)} mark={{ tone: toneOf(f.severity), label: s(f.severity) }} />)}
              </Rows>
            </Tile>
            <Tile title="Measured">
              <StatStrip tiles={ev.filter((e) => e.kind === 'metric').map((e) => ({ label: s(e.caption), value: s(e.ref) }))} />
            </Tile>
            <Tile title="Files and links" count={ev.filter((e) => e.kind === 'file' || e.kind === 'url').length}>
              <Rows count={ev.length} empty={{ title: '' }}>
                {ev.filter((e) => e.kind === 'file' || e.kind === 'url').map((e) => <ListRow key={s(e.ref)} size="s" name={<span className="typo-code">{s(e.ref)}</span>} nameClass="k-ellipsis" meta={s(e.caption)} />)}
              </Rows>
            </Tile>
          </Tiles>
        </div>
      </Section>
    </>
  );
}

function view(look: 'a' | 'b'): ComponentType {
  return function KitTiles() {
    return (
      <div className="contents" data-kit-tile-look={look}>
        <KitHost compact testId={`kit-tiles-${look}`}>
          <Surface><Landing /><Stacks /></Surface>
        </KitHost>
      </div>
    );
  };
}

export const KIT_TILES_MODULES: Record<string, { load: () => Promise<{ default: ComponentType }> }> = {
  'kit/tiles-a': { load: async () => ({ default: view('a') }) },
  'kit/tiles-b': { load: async () => ({ default: view('b') }) },
};
