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
import {
  ChartFrame, ChipRow, ContextCard, ContextCards, Crumbs, DataTable, Dot, Hint, KeyValueGrid, KitButton, KitHost, ListRow,
  Meta, RangePicker, Rows, SearchField, Section, Segmented, StatStrip, Surface, Toolbar, UnitStrip, apportion,
  quantumFor, toneColor, type Glyph, type TableCol, type TableRow, type Tone,
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
    <Section title="ContextCard" level={1} eyebrow="one peer as a tile" meta="a band with a primary rail, not a box">
      <ContextCards label="Specimen cards">
        <ContextCard title="Authentication" meta={<Meta parts={['backend', '14 files']} />} mark={{ tone: 'success', glyph: 'soft', label: 'Healthy' }} figures={figs('3 KPIs', '$0.40', 6)} onPress={noop} actions={<KitButton quiet onClick={noop} stopPropagation>Scan</KitButton>} />
        <ContextCard title="Billing (hover)" state="hover" meta={<Meta parts={['backend', '9 files']} />} mark={{ tone: 'warning', label: 'At risk' }} figures={figs('2 KPIs', '$1.20', 9)} onPress={noop} />
        <ContextCard title="Onboarding (selected)" state="selected" meta={<Meta parts={['frontend', '22 files']} />} mark={{ tone: 'error', label: 'Failing' }} figures={figs('5 KPIs', '$2.75', 14)} onPress={noop} />
        <ContextCard title="Sync engine (live)" state="live" meta="a scan is running" mark={{ tone: 'primary', glyph: 'live', label: 'Live' }} figures={figs('1 KPI', '$0.05', 2)} />
        <ContextCard title="Legacy import (muted)" state="muted" meta="archived" mark={{ tone: 'neutral', glyph: 'hollow', label: 'Archived' }} figures={figs('0 KPIs', '-', 0)} />
        <ContextCard title="Search" state="empty" empty={{ title: 'Not scanned yet', hint: 'Run a context scan.', tone: 'info' }} />
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
        <Facts />
      </Surface>
    </KitHost>
  );
}

export const KIT_MODULES: Record<string, { load: () => Promise<{ default: ComponentType }> }> = {
  'kit/specimen': {
    load: async () => ({ default: KitSpecimen }),
  },
};
