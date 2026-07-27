// Compose variant A (round 4) — LIBRARY. Bottom-up: the milestone cut is
// COMPOSED by shopping the inventory the scans already built. Left: the cut
// under construction with its DERIVED context footprint (health + KPI gaps
// recomputed on every add). Right: the primitive library — Features are the
// composition unit (adding one pulls its contexts along), Goals bind as
// measurable objectives, and the Contexts tab is deliberately read-only:
// contexts join via features, never by hand.
import { useMemo, useState } from 'react';
import { Plus, Target, X } from 'lucide-react';

import { INK, InkTabs } from '../../passport/passportInk';
import {
  GROWTH_NAME, LIB_CONTEXTS, LIB_FEATURES, LIB_GOALS, TONE_HUE_MAP, contextTone,
} from './shipModel';
import { LedgerHeader, LedgerList, LedgerRow } from './shipRows';

type Source = 'features' | 'goals' | 'contexts';

const SOURCES: Array<{ id: Source; label: string }> = [
  { id: 'features', label: 'Features' },
  { id: 'goals', label: 'Goals' },
  { id: 'contexts', label: 'Contexts' },
];

function smallBtn(hue: string) {
  return {
    className: 'inline-flex items-center gap-1 px-2 py-1 rounded-interactive typo-caption border transition-colors hover:bg-foreground/[0.05] focus-ring',
    style: { color: hue, borderColor: `${hue}55` },
  } as const;
}

export function ShipComposeLibraryTab() {
  const [cutIds, setCutIds] = useState<string[]>(['lf1', 'lf3']);
  const [goalIds, setGoalIds] = useState<string[]>(['lg1']);
  const [source, setSource] = useState<Source>('features');

  const cut = cutIds.map((id) => LIB_FEATURES.find((f) => f.id === id)).filter((f): f is typeof LIB_FEATURES[number] => Boolean(f));
  const pool = LIB_FEATURES.filter((f) => !cutIds.includes(f.id));
  const boundGoals = LIB_GOALS.filter((g) => goalIds.includes(g.id));

  // The derived footprint — the whole point of features-as-unit.
  const footprint = useMemo(() => {
    const names = [...new Set(cut.flatMap((f) => f.contexts))];
    const ctxs = names.map(contextTone);
    return {
      ctxs,
      crit: ctxs.filter((c) => c.tone === 'crit').length,
      unmeasured: ctxs.filter((c) => c.kpis === 0).length,
    };
  }, [cut]);

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(300px, 1fr)' }} data-testid="factory-ship-compose-library">
      {/* the cut under construction */}
      <div className="min-w-0">
        <p className="typo-title-lg mb-1">{GROWTH_NAME} — composing the cut</p>

        {/* bound objectives */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {boundGoals.map((g) => (
            <span key={g.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border typo-caption" style={{ borderColor: `${INK.teal}55`, color: INK.teal }}>
              <Target className="w-3 h-3" aria-hidden />
              {g.name} · {g.metric}
              <button type="button" onClick={() => setGoalIds((p) => p.filter((x) => x !== g.id))} className="focus-ring rounded-full" aria-label={`Unbind ${g.name}`}>
                <X className="w-3 h-3 opacity-60 hover:opacity-100" aria-hidden />
              </button>
            </span>
          ))}
          {boundGoals.length === 0 && <span className="typo-caption" style={{ color: INK.blue }}>No objective bound yet — pick one from Goals →</span>}
        </div>

        {/* the derived footprint bar */}
        <div className="rounded-card px-3 py-2 mb-3 border border-foreground/[0.07]" style={{ background: 'rgba(148,163,184,.03)' }} data-testid="ship-footprint">
          <span className="typo-caption block mb-1.5">
            Derived footprint — {footprint.ctxs.length} contexts
            {footprint.crit > 0 && <span style={{ color: INK.red }}> · {footprint.crit} critical</span>}
            {footprint.unmeasured > 0 && <span style={{ color: INK.blue }}> · {footprint.unmeasured} without a KPI</span>}
          </span>
          <span className="flex items-center gap-1.5 flex-wrap">
            {footprint.ctxs.map((c) => (
              <span key={c.name} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs" style={{ borderColor: `${TONE_HUE_MAP[c.tone]}55`, color: TONE_HUE_MAP[c.tone] }} title={`${c.kpis} KPIs`}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: TONE_HUE_MAP[c.tone] }} />
                {c.name}{c.kpis === 0 ? ' · no KPI' : ''}
              </span>
            ))}
            {footprint.ctxs.length === 0 && <span className="typo-caption">empty — add a feature and its contexts follow</span>}
          </span>
        </div>

        <LedgerHeader title="The cut" count={cut.length} aside="every row pulled its contexts into the footprint above" />
        <LedgerList testid="ship-compose-cut">
          {cut.map((f) => (
            <LedgerRow
              key={f.id}
              name={f.name}
              contexts={f.contexts}
              stateLabel={f.kpiCount > 0 ? `${f.kpiCount} KPI${f.kpiCount > 1 ? 's' : ''}` : 'no KPI yet'}
              stateHue={f.kpiCount > 0 ? INK.emerald : INK.blue}
              actions={
                <button type="button" onClick={() => setCutIds((p) => p.filter((x) => x !== f.id))} {...smallBtn('rgba(148,163,184,.7)')} aria-label={`Remove ${f.name}`}>
                  <X className="w-3 h-3" aria-hidden />
                  Remove
                </button>
              }
            />
          ))}
          {cut.length === 0 && (
            <li className="rounded-card border border-dashed px-3 py-4 typo-caption text-center" style={{ borderColor: `${INK.blue}55`, color: INK.blue }}>
              Empty cut — add features from the library.
            </li>
          )}
        </LedgerList>
      </div>

      {/* the library */}
      <div className="min-w-0 rounded-modal border border-foreground/[0.08] p-3" style={{ background: 'rgba(148,163,184,.02)' }}>
        <div className="mb-2.5"><InkTabs tabs={SOURCES} active={source} onChange={setSource} label="Library" /></div>

        {source === 'features' && (
          <LedgerList testid="ship-lib-features">
            {pool.map((f) => (
              <LedgerRow
                key={f.id}
                name={f.name}
                contexts={f.contexts}
                stateLabel={f.source === 'scan' ? 'from scan' : 'manual'}
                stateHue="rgba(148,163,184,.55)"
                actions={
                  <button type="button" onClick={() => setCutIds((p) => [...p, f.id])} {...smallBtn(INK.teal)}>
                    <Plus className="w-3 h-3" aria-hidden />
                    Cut
                  </button>
                }
              />
            ))}
            {pool.length === 0 && <li className="typo-caption px-1 py-2">Library exhausted — the scans will propose more.</li>}
          </LedgerList>
        )}

        {source === 'goals' && (
          <LedgerList testid="ship-lib-goals">
            {LIB_GOALS.filter((g) => !goalIds.includes(g.id)).map((g) => (
              <LedgerRow
                key={g.id}
                name={g.name}
                contexts={g.contexts}
                marker={<Target className="w-3.5 h-3.5 shrink-0" style={{ color: INK.teal }} aria-hidden />}
                stateLabel={g.metric}
                stateHue={INK.teal}
                actions={
                  <button type="button" onClick={() => setGoalIds((p) => [...p, g.id])} {...smallBtn(INK.teal)}>
                    <Plus className="w-3 h-3" aria-hidden />
                    Bind
                  </button>
                }
              />
            ))}
          </LedgerList>
        )}

        {source === 'contexts' && (
          <>
            <p className="typo-caption mb-2" style={{ color: INK.blue }}>
              Read-only by design — contexts join the milestone through features, never by hand.
            </p>
            <ul className="grid gap-1">
              {LIB_CONTEXTS.map((c) => {
                const inFp = footprint.ctxs.some((x) => x.name === c.name);
                return (
                  <li key={c.name} className={`flex items-center gap-2 px-2 py-1.5 rounded-interactive min-w-0 ${inFp ? '' : 'opacity-55'}`}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TONE_HUE_MAP[c.tone] }} />
                    <span className="typo-caption text-foreground/85 min-w-0">{c.name}</span>
                    <span className="ml-auto typo-caption shrink-0">{c.kpis} KPI{c.kpis === 1 ? '' : 's'}{inFp ? ' · in footprint' : ''}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
