/**
 * `kit/specimen`: every part of the composition kit in its states, on synthetic props (no IPC).
 * The page future builders and the owner look at to know what the kit offers. Harness-only: it
 * is not routed in the app. Words here are specimen fixtures, not product copy.
 *
 * States shown per part where the part has them: default, hover (the `is-hover` class the kit
 * draws hover with), selected, muted / disabled, live, empty, loading.
 */
/* eslint-disable custom/no-hardcoded-jsx-text -- specimen fixtures in a harness-only view, not product copy */
import { useEffect, type ComponentType, type ReactNode } from 'react';
import { Bot, MessageCircle, Play, RefreshCw, Sparkles, Workflow } from 'lucide-react';
import { OverviewDemo } from './kitContexts';
import {
  ChartFrame, ChipRow, ContextCard, ContextCards, Crumbs, DataTable, Dot, Hint, KeyValueGrid, KitButton, KitHost, ListRow,
  Meta, RangePicker, Rows, SearchField, Section, Segmented, Stack, StatStrip, Surface, Tile, Tiles, Toolbar, UnitStrip,
  apportion, quantumFor, toneColor, type Glyph, type TableCol, type TableRow, type Tone,
} from '@/features/shared/components/kit';

const noop = () => {};
const TONES: Tone[] = ['primary', 'success', 'warning', 'error', 'info', 'neutral', 'pending', 'agent', 'human', 'external', 'highlight'];
const GLYPHS: Glyph[] = ['solid', 'soft', 'hollow', 'empty', 'live'];

function Caption({ children }: { children: ReactNode }) {
  return <p className="k-in typo-caption" style={{ margin: '0 0 8px' }}>{children}</p>;
}

function MarksAndUnits() {
  const q = quantumFor(1234, 40);
  return (
    <Section title="Mark, Dot, UnitStrip, Hint" level={1} eyebrow="Tone x Glyph" count={`${TONES.length} x ${GLYPHS.length}`}>
      <div className="k-in" style={{ display: 'grid', gridTemplateColumns: `8rem repeat(${GLYPHS.length}, 4.5rem)`, rowGap: 6, marginBottom: 16 }}>
        <span className="typo-label k-quiet">tone</span>
        {GLYPHS.map((g) => <span key={g} className="typo-label k-quiet">{g}</span>)}
        {TONES.map((t) => (
          <span key={t} className="contents">
            <span className="typo-data k-regular">{t}</span>
            {GLYPHS.map((g) => <span key={g}><Dot tone={t} glyph={g} /></span>)}
          </span>
        ))}
      </div>
      <Caption>UnitStrip sizes s, m, l, pip; a fraction; empty; muted. quantumFor(1234, 40) = {q}, so 1 square = {q}.</Caption>
      <div className="k-in" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        {(['s', 'm', 'l', 'pip'] as const).map((size) => (
          <span key={size} className="k-legend-row">
            <span className="typo-label k-quiet" style={{ width: '3rem' }}>{size}</span>
            <UnitStrip size={size} label={`${size} strip`} segments={apportion([{ value: 700, tone: 'primary' }, { value: 400, tone: 'agent' }, { value: 134, tone: 'warning' }], q)} />
          </span>
        ))}
        <span className="k-legend-row">
          <span className="typo-label k-quiet" style={{ width: '3rem' }}>rows 2</span>
          <UnitStrip rows={2} label="two rows" segments={[{ n: 14, tone: 'success' }, { n: 5, tone: 'error' }, { n: 2.5, tone: 'neutral', glyph: 'soft' }]} />
        </span>
        <span className="k-legend-row">
          <span className="typo-label k-quiet" style={{ width: '3rem' }}>empty</span>
          <UnitStrip label="nothing" segments={[]} />
          <span className="typo-label k-quiet">muted</span>
          <UnitStrip label="muted" state="muted" segments={[{ n: 9, tone: 'info' }]} />
        </span>
      </div>
      <Caption>Hint: the shared Tooltip with an always-present description; the first one is shown open.</Caption>
      <div className="k-in k-legend-row" data-specimen-hint style={{ gap: 24, marginBottom: 8 }}>
        <Hint content="1 square = 20 runs" focusable><UnitStrip label="31 runs" segments={[{ n: 1.55, tone: 'primary' }]} /></Hint>
        <Hint content="Failing: 3 runs in a row" focusable><span className="typo-data k-regular">3 failing</span></Hint>
        <Hint content="Live: a run is working now" focusable><span className="k-legend-row"><Dot tone="primary" glyph="live" /><span className="typo-data k-regular">live</span></span></Hint>
      </div>
    </Section>
  );
}

function Controls() {
  return (
    <Section title="Toolbar, Segmented, SearchField, KitButton, RangePicker" level={1} eyebrow="controls">
      <Toolbar label="Specimen toolbar">
        <Segmented label="Status" value="all" onChange={noop} options={[
          { v: 'all', label: 'All', count: 42 },
          { v: 'ok', label: 'Healthy', count: 30, tone: 'success', glyph: 'soft' },
          { v: 'bad', label: 'Failing', count: 4, tone: 'error', glyph: 'solid' },
          { v: 'setup', label: 'Setup', count: 8, tone: 'info', glyph: 'hollow' },
        ]} />
        <SearchField value="" onChange={noop} placeholder="Search contexts" />
        <RangePicker label="Window" value="7d" onChange={noop} presets={[{ v: '24h', label: '24h' }, { v: '7d', label: '7d' }, { v: '30d', label: '30d' }]} />
      </Toolbar>
      <Toolbar label="KitButton states">
        <KitButton onClick={noop}>Default</KitButton>
        <KitButton onClick={noop} className="is-hover">Hover</KitButton>
        <KitButton onClick={noop} pressed>Pressed</KitButton>
        <KitButton onClick={noop} quiet>Quiet</KitButton>
        <KitButton onClick={noop} loading>Busy</KitButton>
        <KitButton onClick={noop} disabled>Disabled</KitButton>
        <KitButton onClick={noop} disabled disabledReason="Pick a project first">Disabled, reason</KitButton>
        <KitButton onClick={noop} hint="Esc">With key</KitButton>
        <KitButton onClick={noop} stopPropagation>In a row</KitButton>
      </Toolbar>
    </Section>
  );
}

type Col = 'name' | 'runs' | 'cost' | 'when';
const COLS: ReadonlyArray<TableCol<Col>> = [
  { key: 'name', label: 'Persona', sortable: 'asc' },
  { key: 'runs', label: 'Runs', num: true, sortable: 'desc', width: '7rem' },
  { key: 'cost', label: 'Cost', num: true, width: '9rem' },
  { key: 'when', label: 'Last', num: true, width: '6rem' },
];
const cell2 = (name: string, meta: string) => <span className="k-cell2"><span className="typo-body k-strong k-ellipsis">{name}</span><span className="typo-caption k-ellipsis">{meta}</span></span>;
const TROWS: Array<TableRow<Col>> = [
  { id: 'a', mark: { tone: 'success', glyph: 'soft', label: 'Healthy' }, cells: { name: cell2('Inbox Triage', 'default'), runs: '128', cost: '$4.20', when: '5m' }, sort: { name: 'Inbox Triage', runs: 128 } },
  { id: 'b', mark: { tone: 'primary', glyph: 'live', label: 'Live' }, state: 'live', cells: { name: cell2('Release Notes Writer', 'live'), runs: '41', cost: '$1.10', when: 'now' }, sort: { name: 'Release Notes Writer', runs: 41 } },
  { id: 'c', mark: { tone: 'error', label: 'Failing' }, state: 'selected', cells: { name: cell2('Uptime Sentinel', 'selected'), runs: '77', cost: '$0.35', when: '12m' }, sort: { name: 'Uptime Sentinel', runs: 77 } },
  { id: 'd', mark: { tone: 'warning', label: 'At risk' }, state: 'hover', cells: { name: cell2('Invoice Reconciler', 'hover'), runs: '12', cost: '$2.05', when: '1h' }, sort: { name: 'Invoice Reconciler', runs: 12 } },
  { id: 'e', mark: { tone: 'neutral', glyph: 'hollow', label: 'Paused' }, state: 'muted', cells: { name: cell2('Code Review Buddy', 'muted'), runs: '0', cost: '-', when: '3d' }, sort: { name: 'Code Review Buddy', runs: 0 } },
];

function Lists() {
  return (
    <>
      <Section title="DataTable" level={1} eyebrow="rows in columns" count={TROWS.length} meta="sortable heads; runs, cost and last have fixed width tracks">
        <DataTable<Col> label="Specimen table" cols={COLS} rows={TROWS} empty={{ title: 'No runs' }} onRowClick={noop} defaultSort={{ key: 'runs', dir: 'desc' }} />
        <Caption>Loading, then empty:</Caption>
        <DataTable<Col> label="Loading table" cols={COLS} rows={[]} loading empty={{ title: 'No runs' }} />
        <DataTable<Col> label="Empty table" cols={COLS} rows={[]} empty={{ title: 'No runs in this window', hint: 'Widen the window or run a persona.' }} />
      </Section>
      <Section title="ListRow and Rows" level={1} eyebrow="a name and a sentence">
        <Rows count={5} empty={{ title: 'Nothing here' }}>
          <ListRow name="Default row" meta={<Meta parts={['meta one', 'meta two']} />} mark={{ tone: 'success', glyph: 'soft', label: 'ok' }} figures={<span className="k-fig typo-data k-regular">12</span>} time="5m" />
          <ListRow name="Hover row" meta="is-hover" state="hover" mark={{ tone: 'info', label: 'info' }} time="8m" />
          <ListRow name="Selected row" meta="is-selected" state="selected" mark={{ tone: 'warning', label: 'warn' }} time="9m" />
          <ListRow name="Live row" meta="is-live" state="live" mark={{ tone: 'primary', glyph: 'live', label: 'live' }} time="now" />
          <ListRow name="Muted row" meta="is-muted" state="muted" mark={{ tone: 'neutral', glyph: 'hollow', label: 'paused' }} time="2d" />
        </Rows>
        <Caption>Loading, then empty:</Caption>
        <Rows count={0} loading empty={{ title: 'Nothing here' }}>{null}</Rows>
        <Rows count={0} empty={{ title: 'Nothing here yet', hint: 'Rows appear when a persona runs.' }}>{null}</Rows>
      </Section>
    </>
  );
}

function Cards() {
  const figs = (runs: string, cost: string, n: number) => (
    <>
      <span className="typo-data k-regular">{runs}</span>
      <span className="typo-data k-regular k-quiet">{cost}</span>
      <UnitStrip size="s" label={`${n} units`} segments={[{ n, tone: 'primary' }]} />
    </>
  );
  return (
    <Section title="ContextCard" level={1} eyebrow="one peer as a tile, when peers are few" meta="head at the top, actions top-right, figures pinned to the foot: every figure line in a row aligns">
      <ContextCards label="Specimen cards">
        <ContextCard title="Authentication" meta={<Meta parts={['backend', '14 files']} />} mark={{ tone: 'success', glyph: 'soft', label: 'Healthy' }} figures={figs('3 KPIs', '$0.40', 6)} onPress={noop} actions={<KitButton quiet onClick={noop} stopPropagation>Scan</KitButton>} />
        <ContextCard title="Billing (hover)" state="hover" meta={<Meta parts={['backend', '9 files']} />} mark={{ tone: 'warning', label: 'At risk' }} figures={figs('2 KPIs', '$1.20', 9)} onPress={noop} />
        <ContextCard title="Onboarding (selected)" state="selected" meta={<Meta parts={['frontend', '22 files']} />} mark={{ tone: 'error', label: 'Failing' }} figures={figs('5 KPIs', '$2.75', 14)} onPress={noop} actions={<KitButton quiet onClick={noop} stopPropagation>Open</KitButton>} />
        <ContextCard title="Sync engine (live)" state="live" meta="a scan is running" mark={{ tone: 'primary', glyph: 'live', label: 'Live' }} figures={figs('1 KPI', '$0.05', 2)} />
        <ContextCard title="Legacy import (muted)" state="muted" meta="archived" mark={{ tone: 'neutral', glyph: 'hollow', label: 'Archived' }} figures={figs('0 KPIs', '-', 0)} />
        <ContextCard title="Search" state="empty" empty={{ title: 'Not scanned yet', hint: 'Run a context scan.', tone: 'info' }} actions={<KitButton quiet onClick={noop}>Scan</KitButton>} />
        <ContextCard title="" state="loading" />
      </ContextCards>
    </Section>
  );
}

function Facts() {
  return (
    <>
      <Section title="StatStrip" level={1} eyebrow="headline figures">
        <StatStrip tiles={[
          { label: 'Runs', value: '1,234', draw: <UnitStrip size="s" label="runs" segments={apportion([{ value: 1000, tone: 'success' }, { value: 234, tone: 'error' }], 50)} /> },
          { label: 'Cost', value: '$41.20', unit: 'this week' },
          { label: 'Selected tile', value: '98', unit: '%', state: 'selected' },
          { label: 'Hover tile', value: '12', state: 'hover' },
          { label: 'Muted tile', value: null, state: 'muted', note: 'not measured' },
        ]} />
        <StatStrip state="loading" tiles={[{ label: 'Runs', value: null }, { label: 'Cost', value: null }, { label: 'Errors', value: null }]} />
      </Section>
      <Section title="KeyValueGrid and ChipRow" level={1} eyebrow="facts and named counts">
        <KeyValueGrid items={[
          { k: 'Model', v: 'opus' }, { k: 'Budget', v: '$5.00 / day' }, { k: 'Owner', v: null, none: 'nobody' },
          { k: 'Status', v: 'healthy', draw: <Dot tone="success" glyph="soft" /> }, { k: 'Hover', v: 'is-hover', state: 'hover' },
        ]} />
        <ChipRow label="Tools" emptyLabel="none" chips={[
          { id: 'a', label: 'bash', count: 41, share: 0.6, onPress: noop },
          { id: 'b', label: 'read', count: 22, share: 0.3, state: 'selected', onPress: noop },
          { id: 'c', label: 'hover', count: 4, state: 'hover', onPress: noop },
          { id: 'd', label: 'muted', count: 0, state: 'muted' },
          { id: 'e', label: 'failing', count: 3, tone: 'error', glyph: 'solid' },
        ]} />
        <ChipRow label="Loading chips" emptyLabel="none" chips={[]} state="loading" />
        <ChipRow label="Empty chips" emptyLabel="No tools used" chips={[]} />
      </Section>
      <Section title="ChartFrame" level={1} eyebrow="a plot on the reading line">
        <ChartFrame height={80} label="Specimen chart">
          <svg width="100%" height="80" viewBox="0 0 400 80" preserveAspectRatio="none" aria-hidden="true">
            <polyline points="0,60 50,52 100,58 150,30 200,36 250,18 300,26 350,12 400,20" fill="none" stroke={toneColor('primary')} strokeWidth="2" />
            <polyline points="0,70 50,68 100,72 150,60 200,66 250,58 300,62 350,50 400,56" fill="none" stroke={toneColor('agent')} strokeWidth="2" />
          </svg>
        </ChartFrame>
        <ChartFrame height={80} label="Loading chart" state="loading">{null}</ChartFrame>
        <ChartFrame height={80} label="Empty chart" state="empty" empty={{ title: 'No data in this window' }}>{null}</ChartFrame>
      </Section>
    </>
  );
}

function SectionStates() {
  return (
    <>
      <Section title="Section states" level={1} eyebrow={<Crumbs label="Specimen trail" items={[{ label: 'Kit' }, { label: 'Specimen', onPress: noop }, { label: 'Crumbs', onPress: noop }, { label: 'Section states' }]} />} meta="Crumbs in the eyebrow: doors are text buttons, the last plain crumb is the current page">
        <Section title="Level 2, selected" level={2} state="selected" count={3}><Caption>A selected level-2 node fills.</Caption></Section>
        <Section title="Level 2, hover" level={2} state="hover" actions={<KitButton onClick={noop}>Action</KitButton>}><Caption>The head band lights on hover.</Caption></Section>
        <Section title="Level 2, muted" level={2} state="muted"><Caption>Muted dims head and body.</Caption></Section>
        <Section title="Level 2, loading" level={2} state="loading" ghostRows={2} />
        <Section title="Level 2, empty" level={2} state="empty" empty={{ title: 'Nothing in this section', hint: 'An empty section keeps its geometry.' }} />
      </Section>
    </>
  );
}

const tones = ['default', 'quiet', 'primary'] as const;
const LEGEND_ROWS: Array<{ line: string; size: 'm' | 's' | 'pip'; label: string; legend: string; segments: Array<{ n: number; tone: Tone; glyph?: Glyph }> }> = [
  { line: 'm, quantum 5', size: 'm', label: '240 runs', legend: '5 runs', segments: [{ n: 40, tone: 'success' }, { n: 8, tone: 'error' }] },
  { line: 'm, quantum 1', size: 'm', label: '11 runs', legend: '1 run', segments: [{ n: 8, tone: 'success' }, { n: 3, tone: 'error' }] },
  { line: 's, quantum 100k', size: 's', label: '1.2M tokens', legend: '100k tokens', segments: [{ n: 8, tone: 'primary' }, { n: 4, tone: 'agent', glyph: 'soft' }] },
  { line: 'pip, quantum 10', size: 'pip', label: '120 calls', legend: '10 calls', segments: [{ n: 12, tone: 'info' }] },
];

/** Kit grow-2: the five parts the home-1 batch proposed, in their states (also at the foot of kit/specimen). */
function Grow2Parts() {
  const art = (tone: Tone, Icon: typeof Bot) => <span className={`k-toned t-${tone}`}><Icon className="w-10 h-10" strokeWidth={1} /></span>;
  const figs = <><span className="typo-data k-regular">6 agents</span><UnitStrip size="s" label="6 units" segments={[{ n: 6, tone: 'agent' }]} /></>;
  return (
    <Section title="Kit grow-2" level={1} eyebrow="the five parts home-1 proposed" meta="art, tone, icon, legend, pressable row">
      <Section title="ContextCard art" level={2} meta="top-right, hidden from the tree, a press on it lands on the card; beside actions the actions keep the corner">
        <ContextCards label="Art cards">
          <ContextCard title="Art alone" meta="pressable" art={art('agent', Bot)} figures={figs} onPress={noop} />
          <ContextCard title="Art and actions" meta="art left of the actions" art={art('primary', Workflow)} actions={<KitButton quiet onClick={noop} stopPropagation>Scan</KitButton>} figures={figs} onPress={noop} />
          <ContextCard title="Art, selected" state="selected" art={art('info', Sparkles)} figures={figs} onPress={noop} />
          <ContextCard title="" state="loading" art={art('agent', Bot)} />
        </ContextCards>
      </Section>
      <Section title="KitButton tone and icon" level={2} meta="tone default | quiet | primary (the theme primary -> accent gradient, lightness capped for the white ink); quiet={true} is an alias of tone=quiet">
        {tones.map((tone) => (
          <Toolbar key={tone} label={`${tone} buttons`}>
            <span className="typo-label k-quiet" style={{ width: '4.5rem' }}>{tone}</span>
            <KitButton tone={tone} onClick={noop}>Label</KitButton>
            <KitButton tone={tone} icon={<Play />} onClick={noop}>With icon</KitButton>
            <KitButton tone={tone} icon={<RefreshCw />} onClick={noop} className="is-hover">Hover</KitButton>
            <KitButton tone={tone} icon={<Play />} onClick={noop} disabled>Disabled</KitButton>
            <KitButton tone={tone} icon={<Play />} onClick={noop} loading>Busy</KitButton>
          </Toolbar>
        ))}
      </Section>
      <Section title="UnitStrip legend" level={2} meta="what one unit stands for: nothing drawn; the strip's Hint on hover and focus (the first shown open) and its description">
        <div className="k-in" data-specimen-hint style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 36, marginBottom: 16 }}>
          {LEGEND_ROWS.map((r) => (
            <span key={r.line} className="k-legend-row">
              <span className="typo-label k-quiet" style={{ width: '10rem' }}>{r.line}</span>
              <UnitStrip size={r.size} label={r.label} legend={r.legend} segments={r.segments} />
            </span>
          ))}
        </div>
      </Section>
      <Section title="ListRow onPress" level={2} meta="the name is the row's one button; hover band, pointer and focus ring on the row">
        <Rows count={4} empty={{ title: 'none' }}>
          <ListRow size="s" name="Pressable row" onPress={noop} />
          <ListRow size="s" name="Pressable, hover" state="hover" onPress={noop} />
          <ListRow size="s" name="Pressable, selected" state="selected" mark={{ tone: 'success', glyph: 'solid', label: 'used' }} onPress={noop} />
          <ListRow size="s" name="Pressable, trailing action" onPress={noop} figures={<KitButton quiet onClick={noop}>Details</KitButton>} time="5m" />
        </Rows>
      </Section>
      <Section title="Get started: card-as-button (A) or primary button (B)" level={2} meta="home/welcome first run; B adopted">
        <Caption>A, as home-1 shipped: two pressable cards of equal weight.</Caption>
        <ContextCards label="Variant A" min="min(100%, 20rem)">
          <ContextCard title="Build your first agent" mark={{ tone: 'info', glyph: 'hollow', label: 'Build' }} onPress={noop} figures={<Bot className="ml-auto -mb-1 w-10 h-10 k-toned t-info" strokeWidth={1.25} aria-hidden />} />
          <ContextCard title="Ask the assistant" mark={{ tone: 'agent', glyph: 'soft', label: 'Ask' }} onPress={noop} figures={<MessageCircle className="ml-auto -mb-1 w-10 h-10 k-toned t-agent" strokeWidth={1.25} aria-hidden />} />
        </ContextCards>
        <Caption>B: the one call to action is primary, the second a default button, on the reading line.</Caption>
        <Toolbar label="Variant B">
          <KitButton tone="primary" icon={<Bot />} onClick={noop}>Build your first agent</KitButton>
          <KitButton icon={<MessageCircle />} onClick={noop}>Ask the assistant</KitButton>
        </Toolbar>
      </Section>
    </Section>
  );
}

/** Five rows with real metadata, shown once in columns and once stacked (kit grow-4, part 2). */
const COLUMN_ROWS: Array<{ name: string; project: string; model: string; tokens: string; turns: string; age: string; tone: Tone; glyph: Glyph; state: string }> = [
  { name: 'Fleet settings page on typo tokens', project: 'personas', model: 'opus-5-5', tokens: '3.6M', turns: '71', age: '6m', tone: 'neutral', glyph: 'hollow', state: 'Idle' },
  { name: 'Port the DataGrid pager onto tokens', project: 'personas', model: 'opus-5-5', tokens: '1.5M', turns: '34', age: '<1m', tone: 'primary', glyph: 'live', state: 'Working' },
  { name: 'Rewrite the guide index page', project: 'personas-web', model: 'sonnet-5', tokens: '742.8K', turns: '19', age: '1m', tone: 'primary', glyph: 'live', state: 'Working' },
  { name: 'Refactor vault connector retries', project: 'personas', model: 'opus-5-5', tokens: '2.5M', turns: '49', age: '2m', tone: 'warning', glyph: 'solid', state: 'Awaiting input' },
  { name: 'Regenerate the knowledge index', project: 'ai-registry', model: 'haiku-4-5', tokens: '134.4K', turns: '7', age: '38m', tone: 'neutral', glyph: 'hollow', state: 'Idle' },
];

/** Kit grow-4: the parts the owner's 2026-10-03 Home review earned, in their states. */
function Grow4Parts() {
  return (
    <Section title="Kit grow-4" level={1} eyebrow="the parts the Home review earned" meta="band origin, row columns, Stack, packed stats, the emphasis recipe, card fill, tile mark">
      <Section title="Stack" level={2} meta="the regions inside a tile: the gap, and with `divided` a quiet rule that starts on the band's reading line - a rule, never a box">
        <Tiles label="Stack tiles">
          <Tile span={6} title="Plain regions" meta="nothing between them">
            <div className="k-in typo-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ margin: 0 }}>Your fleet ran 1,284 times this week at a 90.6% success rate.</p>
              <ul style={{ margin: 0, paddingLeft: 18 }}><li>Cost is up 38%, mostly research runs</li><li>25 decisions are waiting</li></ul>
            </div>
            <StatStrip tiles={[{ label: 'Runs', value: '1,284' }, { label: 'Spend', value: '$48.72' }]} />
          </Tile>
          <Tile span={6} title="Divided regions" meta="the same tile inside a Stack divided">
            <Stack divided>
              <p className="k-in typo-body" style={{ margin: 0 }}>Your fleet ran 1,284 times this week at a 90.6% success rate.</p>
              <ul className="k-in typo-body" style={{ margin: 0, paddingLeft: 58 }}><li>Cost is up 38%, mostly research runs</li><li>25 decisions are waiting</li></ul>
              <StatStrip tiles={[{ label: 'Runs', value: '1,284' }, { label: 'Spend', value: '$48.72' }]} />
            </Stack>
          </Tile>
        </Tiles>
        <Caption>Gaps s, m, l; a Stack with no `divided` is the gap alone.</Caption>
      </Section>
      <Section title="Rows columns" level={2} meta="one declared track set on the list, filled by every row: aligned columns with their own heads and alignment, the fixed row height kept, collapsing against the list's own width">
        <Rows
          count={5}
          empty={{ title: 'none' }}
          nameHead="Session"
          columns={[
            { head: 'Project', width: '10rem' },
            { head: 'Model', width: '7rem', collapse: true },
            { head: 'Tokens', width: '6rem', align: 'end' },
            { head: 'Turns', width: '5rem', align: 'end' },
          ]}
        >
          {COLUMN_ROWS.map((r) => (
            <ListRow
              key={r.name}
              size="s"
              name={r.name}
              mark={{ tone: r.tone, glyph: r.glyph, label: r.state }}
              cells={[r.project, r.model, r.tokens, r.turns]}
              time={r.age}
            />
          ))}
        </Rows>
        <Caption>The same five rows with no column set: the metadata stacks under the name and the band runs empty.</Caption>
        <Rows count={5} empty={{ title: 'none' }}>
          {COLUMN_ROWS.map((r) => (
            <ListRow
              key={r.name}
              size="s"
              name={r.name}
              mark={{ tone: r.tone, glyph: r.glyph, label: r.state }}
              meta={<Meta parts={[r.project, r.model, `${r.tokens} tokens`, `${r.turns} turns`]} />}
              time={r.age}
            />
          ))}
        </Rows>
      </Section>
      <Section title="ContextCard fill, corner figure, body" level={2} meta="the quantity as the card's background and a figure in the corner, so a tour card is two rows; the head collapses with no meta and the foot with no figures">
        <ContextCards label="Fill cards" min="min(100%, 17rem)">
          <ContextCard title="Getting Started" fill={{ value: 1, tone: 'success' }} figure="4/4" mark={{ tone: 'success', glyph: 'solid', label: 'Done' }} onPress={noop} />
          <ContextCard title="Execution & Observability" fill={{ value: 0.4, tone: 'info' }} figure="2/5" mark={{ tone: 'info', glyph: 'soft', label: 'In progress' }} onPress={noop} />
          <ContextCard title="Orchestration & Events" fill={{ value: 0, tone: 'neutral' }} figure="0/4" onPress={noop} />
          <ContextCard title="Teams & Orchestration" fill={{ value: 0.22, tone: 'primary' }} figure="2/9" meta="with a meta line" onPress={noop} />
          <ContextCard title="With actions" fill={{ value: 0.6, tone: 'warning' }} figure="3/5" actions={<KitButton quiet onClick={noop} stopPropagation>Open</KitButton>} onPress={noop} />
          <ContextCard title="With a body" fill={{ value: 0.5, tone: 'agent' }} figure="5/10" onPress={noop}>
            <p className="typo-caption" style={{ margin: 0 }}>A region between the head and the foot.</p>
          </ContextCard>
        </ContextCards>
      </Section>
      <Section title="Tile mark and KitButton describedBy" level={2} meta="the tile's own status on its rail at the title's height; a Hint describing a button's press">
        <Tiles label="Tile marks">
          <Tile span={3} title="Healthy" mark={{ tone: 'success', glyph: 'soft', label: 'Healthy' }} count={12}>
            <p className="k-in typo-body" style={{ margin: 0 }}>A tile carries its state on the rail.</p>
          </Tile>
          <Tile span={3} title="At risk" mark={{ tone: 'warning', label: 'At risk' }} meta="with meta">
            <p className="k-in typo-body" style={{ margin: 0 }}>Never a trailing status word.</p>
          </Tile>
          <Tile span={3} title="Working" mark={{ tone: 'primary', glyph: 'live', label: 'Live' }} state="live">
            <p className="k-in typo-body" style={{ margin: 0 }}>A live tile breathes on its rail.</p>
          </Tile>
          <Tile span={3} title="Paused" mark={{ tone: 'neutral', glyph: 'hollow', label: 'Paused' }} state="muted">
            <p className="k-in typo-body" style={{ margin: 0 }}>Muted keeps the mark readable.</p>
          </Tile>
        </Tiles>
        <div className="k-in k-legend-row" data-specimen-hint style={{ gap: 24, marginTop: 12 }}>
          <Hint content="Re-runs every failed execution in this window" focusable>
            <KitButton onClick={noop}>Bulk re-run</KitButton>
          </Hint>
        </div>
      </Section>
    </Section>
  );
}

/** The three gaps the home-3 builders recorded with evidence, built in the kit (2026-10-03):
 *  a pressable Tile, a Meta that reads in a sentence, and a caller-declared name track. */
function GapParts() {
  return (
    <Section title="Kit gaps (home-3)" level={1} eyebrow="the three gaps the Home builders recorded" meta="a pressable Tile, Meta in a sentence, a declared name track">
      <Section title="Tile onPress" level={2} meta="the title is the tile's one button, its hit area stretched over the tile; actions, footer and a row inside the body keep their own press above it">
        <Tiles label="Pressable tiles">
          <Tile span={4} title="Enter this board" meta="press anywhere on the tile" mark={{ tone: 'info', glyph: 'soft', label: 'Open' }} onPress={noop}>
            <p className="k-in typo-body" style={{ margin: 0 }}>One tab stop; the focus ring is the tile's, as a pressable card's is.</p>
          </Tile>
          <Tile span={4} title="The current board" state="selected" meta="a selected pressable tile is aria-current" onPress={noop}>
            <p className="k-in typo-body" style={{ margin: 0 }}>A tile is entered, not toggled, so it is never aria-pressed.</p>
          </Tile>
          <Tile
            span={4}
            title="With its own controls"
            meta="nested presses stay reachable"
            actions={<KitButton quiet onClick={noop} stopPropagation>Scan</KitButton>}
            footer={<KitButton quiet onClick={noop} stopPropagation>Re-run</KitButton>}
            onPress={noop}
          >
            <Rows count={2} empty={{ title: 'none' }}>
              <ListRow size="s" name="a row that presses on its own" onPress={noop} />
              <ListRow size="s" name="and keeps its own hit area" onPress={noop} />
            </Rows>
          </Tile>
        </Tiles>
      </Section>
      <Section
        title="Meta in a sentence"
        level={2}
        meta="the same Meta in a flex meta line, unchanged"
        desc={<Meta parts={['Traces are kept for 7 days', 'crash reports for 30 days', 'both capped at 500 MB']} />}
      >
        <Caption>Above: Meta inside a Section desc, a plain paragraph - the host that used to glue two string parts to the dot.</Caption>
        <Rows count={2} empty={{ title: 'none' }}>
          <ListRow size="s" name="Fleet settings page on typo tokens" meta={<Meta parts={['personas', 'opus-5-5', '3.6M tokens', '71 turns']} />} time="6m" />
          <ListRow size="s" name="Rewrite the guide index page" meta={<Meta parts={['personas-web', 'sonnet-5', '742.8K tokens', '19 turns']} />} time="1m" />
        </Rows>
      </Section>
      <Section title="Rows nameWidth" level={2} meta="the caller declares the name track; the leftover room moves to the trail, which keeps its right edge">
        <Caption>Default: the name takes everything the columns leave, so a wide page runs an empty band between the name and the first column.</Caption>
        <Rows count={5} empty={{ title: 'none' }} nameHead="Session" columns={GAP_COLS}>
          {COLUMN_ROWS.map((r) => (
            <ListRow key={r.name} size="s" name={r.name} mark={{ tone: r.tone, glyph: r.glyph, label: r.state }} cells={[r.project, r.model, r.tokens, r.turns]} time={r.age} />
          ))}
        </Rows>
        <Caption>The same list with nameWidth="26rem".</Caption>
        <Rows count={5} empty={{ title: 'none' }} nameHead="Session" nameWidth="26rem" columns={GAP_COLS}>
          {COLUMN_ROWS.map((r) => (
            <ListRow key={r.name} size="s" name={r.name} mark={{ tone: r.tone, glyph: r.glyph, label: r.state }} cells={[r.project, r.model, r.tokens, r.turns]} time={r.age} />
          ))}
        </Rows>
      </Section>
    </Section>
  );
}

const GAP_COLS = [
  { head: 'Project', width: '10rem' },
  { head: 'Model', width: '7rem', collapse: true },
  { head: 'Tokens', width: '6rem', align: 'end' as const },
  { head: 'Turns', width: '5rem', align: 'end' as const },
];

function KitGrow2() {
  useOpenFirstHint();
  return <KitHost compact testId="kit-specimen-grow-2"><Surface><Grow2Parts /></Surface></KitHost>;
}

function KitGrow4() {
  return <KitHost compact testId="kit-specimen-grow-4"><Surface><Grow4Parts /></Surface></KitHost>;
}

function KitGaps() {
  return <KitHost compact testId="kit-specimen-gaps"><Surface><GapParts /></Surface></KitHost>;
}

/** Opens the first Hint for the shot: a synthetic pointer entry, as React reads hover. */
function useOpenFirstHint() {
  useEffect(() => {
    const id = setTimeout(() => {
      const el = document.querySelector('[data-specimen-hint] [aria-describedby]');
      el?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null }));
    }, 300);
    return () => clearTimeout(id);
  }, []);
}

function KitSpecimen() {
  useOpenFirstHint();
  return (
    <KitHost compact testId="kit-specimen">
      <Surface>
        <SectionStates />
        <Controls />
        <MarksAndUnits />
        <Lists />
        <Cards />
        <Section title="ContextOverview" level={1} eyebrow="the parent layer over many contexts" meta="320 contexts in 22 groups; kit/overview has level 2, search and render cost">
          <OverviewDemo />
        </Section>
        <Facts />
        <Grow2Parts />
        <Grow4Parts />
        <GapParts />
      </Surface>
    </KitHost>
  );
}

export const KIT_MODULES: Record<string, { load: () => Promise<{ default: ComponentType }> }> = {
  'kit/specimen': {
    load: async () => ({ default: KitSpecimen }),
  },
  // Kit grow-2 alone, so its parts are in the shot (on kit/specimen they sit below 3200px).
  'kit/specimen/grow-2': {
    load: async () => ({ default: KitGrow2 }),
  },
  // Kit grow-4 alone, for the same reason: on kit/specimen its parts sit below 3200px.
  'kit/specimen/grow-4': {
    load: async () => ({ default: KitGrow4 }),
  },
  // The three home-3 gaps alone, for the same reason: they sit at the very bottom of kit/specimen.
  'kit/specimen/gaps': {
    load: async () => ({ default: KitGaps }),
  },
};
