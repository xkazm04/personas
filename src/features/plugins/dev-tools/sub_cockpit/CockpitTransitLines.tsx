// VARIANT D — "Transit lines" (R2 — built from a blank slate after R1's
// reuse-collage was rejected).
//
// Metaphor: the strategy as a TRANSIT NETWORK. Every goal is a glowing line
// running left → right: the line's bright portion IS its progress, the stations
// along it are the features that serve it (each showing its headline number),
// and findings hang off their station as branch stubs ending in a verdict
// glyph. Each line terminates in a dispatch platform — strategy literally runs
// INTO delegation. An unmeasured station is a hollow dashed node; a feature no
// goal claims sits on a grey disconnected siding at the bottom. A bare project
// is a ghost network: the map exists, no track is laid.
//
// Component strategy: custom line/station/branch primitives, glow via
// box-shadow/drop-shadow in the theme's neon set. Nothing imported from
// existing feature modules — only cockpitGlyphs (the new set's own seed).
import { motion } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { NEON, TONE_HEX, StateDot, VerdictPulse } from './cockpitGlyphs';
import { kpiTone, type MockFeature, type MockFinding, type MockKpi, type MockProject } from './cockpitMock';

const LINE_HUES = [NEON.teal, NEON.violet, NEON.sky];

// -- stations --------------------------------------------------------------------

/** A feature's headline measurement (first KPI) — what the station displays. */
function headline(f: MockFeature): MockKpi | null {
  return f.kpis[0] ?? null;
}

function fmt(k: MockKpi): string {
  if (k.current === null) return '—';
  return `${k.unit === '$' ? '$' : ''}${k.current}${k.unit !== '$' ? k.unit : ''}`;
}

function Station({ kpi, name, hue }: { kpi: MockKpi | null; name: string; hue: string }) {
  const unmeasured = !kpi || kpi.current === null;
  const tone = !kpi || unmeasured ? null : TONE_HEX[kpiTone(kpi)];
  return (
    <div className="flex flex-col items-center min-w-0 relative z-10" style={{ width: 92 }}>
      <span className={`typo-caption font-semibold tabular-nums ${unmeasured ? 'text-foreground/30' : ''}`} style={tone ? { color: tone } : undefined}>
        {kpi ? fmt(kpi) : '—'}
      </span>
      <span
        className="w-3.5 h-3.5 rounded-full my-0.5 shrink-0"
        style={
          unmeasured
            ? { border: '2px dashed rgba(148,163,184,.5)', background: 'var(--background)' }
            : { border: `2.5px solid ${tone ?? hue}`, background: 'var(--background)', boxShadow: `0 0 7px ${(tone ?? hue)}99` }
        }
        title={kpi ? `${kpi.name}: ${fmt(kpi)} / target ${kpi.target}${kpi.unit}` : name}
      />
      <span className="typo-label text-foreground/50 truncate max-w-full text-center leading-tight">{name}</span>
      {unmeasured && kpi?.needsWiring && (
        <button type="button" className="typo-label uppercase tracking-widest mt-0.5" style={{ color: `${NEON.amber}B3` }} title="Wire the sensor in Vault → Connectors">
          wire ▸
        </button>
      )}
    </div>
  );
}

// -- branches (findings + secondary KPIs hang off the line) --------------------------

function Branch({ finding }: { finding: MockFinding }) {
  return (
    <div className="flex items-center gap-2 min-w-0 pl-2">
      <span className="typo-caption text-foreground/25 shrink-0 select-none">└</span>
      {finding.verdict ? <VerdictPulse verdict={finding.verdict} /> : <StateDot state={finding.state === 'dispatched' ? 'dispatched' : 'proposed'} />}
      <span className="typo-caption text-foreground/80 truncate">{finding.title}</span>
      <span className="typo-label text-foreground/35 truncate hidden lg:inline">· {finding.evidence}</span>
    </div>
  );
}

function SecondaryKpi({ kpi }: { kpi: MockKpi }) {
  const tone = kpi.current === null ? null : TONE_HEX[kpiTone(kpi)];
  return (
    <div className="flex items-center gap-2 min-w-0 pl-2">
      <span className="typo-caption text-foreground/25 shrink-0 select-none">└</span>
      <span className="typo-label text-foreground/50 truncate">{kpi.name}</span>
      {kpi.needsWiring ? (
        <button type="button" className="typo-label uppercase tracking-widest" style={{ color: `${NEON.amber}B3` }}>no track — wire {kpi.needsWiring} ▸</button>
      ) : (
        <span className="typo-caption tabular-nums shrink-0" style={tone ? { color: tone } : undefined}>
          {fmt(kpi)} <span className="text-foreground/35">/ {kpi.unit === '$' ? '$' : ''}{kpi.target}{kpi.unit !== '$' ? kpi.unit : ''}</span>
        </span>
      )}
    </div>
  );
}

// -- a whole line ----------------------------------------------------------------------

interface LineDef {
  name: string;
  progressPct: number | null; // null = siding (no goal)
  hue: string;
  stations: { name: string; kpi: MockKpi | null; rating: number | null; costUsd: number | null }[];
  branches: { findings: MockFinding[]; secondary: MockKpi[] };
}

function TransitLine({ line, index }: { line: LineDef; index: number }) {
  const { shouldAnimate } = useMotion();
  const siding = line.progressPct === null;
  const hue = siding ? '#64748B' : line.hue;
  return (
    <motion.div
      initial={shouldAnimate ? { opacity: 0, x: -12 } : { opacity: 0 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.09, duration: 0.4, ease: 'easeOut' }}
      className="relative"
    >
      <div className="flex items-center gap-0">
        {/* terminus plate — the goal */}
        <div className="w-52 shrink-0 pr-3">
          <div className={`typo-body font-medium truncate ${siding ? 'text-foreground/45 italic' : 'text-foreground'}`}>{line.name}</div>
          {!siding && (
            <div className="typo-label tabular-nums" style={{ color: `${hue}CC` }}>{line.progressPct}% travelled</div>
          )}
        </div>

        {/* the track + stations */}
        <div className="relative flex-1 min-w-0">
          {/* dark track */}
          <div className="absolute left-0 right-0 top-[26px] h-[3px] rounded-full" style={{ background: 'rgba(148,163,184,.14)' }} />
          {/* progress glow — the travelled portion of the line */}
          {!siding && (
            <div
              className="absolute left-0 top-[26px] h-[3px] rounded-full"
              style={{ width: `${line.progressPct}%`, background: hue, boxShadow: `0 0 8px ${hue}AA` }}
            />
          )}
          {siding && (
            <div className="absolute left-0 right-0 top-[26px] h-[3px]" style={{ backgroundImage: `repeating-linear-gradient(90deg, rgba(148,163,184,.35) 0 6px, transparent 6px 14px)` }} />
          )}
          <div className="relative flex items-start justify-around">
            {line.stations.map((s, i) => (
              <Station key={i} kpi={s.kpi} name={s.name} hue={hue} />
            ))}
            {line.stations.length === 0 && (
              <span className="typo-label text-foreground/30 py-3">no stations yet</span>
            )}
          </div>
        </div>

        {/* dispatch platform — strategy runs INTO delegation */}
        <button
          type="button"
          className="w-24 shrink-0 ml-2 rounded-interactive border px-2 py-1.5 text-center transition-colors"
          style={{ borderColor: `${hue}44`, color: `${hue}CC` }}
          title="R3 designs the dispatch flow — evidence card + channel picker (Runner · Fleet · Team · Studio)"
        >
          <span className="typo-label uppercase tracking-widest">dispatch ▸</span>
        </button>
      </div>

      {/* branch stubs */}
      {(line.branches.secondary.length > 0 || line.branches.findings.length > 0) && (
        <div className="ml-52 mt-1 space-y-0.5 border-l border-foreground/[0.08] pl-3">
          {line.branches.secondary.map((k) => <SecondaryKpi key={k.id} kpi={k} />)}
          {line.branches.findings.map((fd) => <Branch key={fd.id} finding={fd} />)}
        </div>
      )}
    </motion.div>
  );
}

// -- bare tier: the ghost network --------------------------------------------------------

function GhostNetwork({ project }: { project: MockProject }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center relative" data-testid="cockpit-establish">
      <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(55% 55% at 50% 40%, ${NEON.teal}0c, transparent 70%)` }} />
      <div className="w-full max-w-lg space-y-5 opacity-50 mb-7">
        {[0.9, 0.65, 0.8].map((wf, i) => (
          <div key={i} className="h-[3px] rounded-full mx-auto" style={{ width: `${wf * 100}%`, backgroundImage: 'repeating-linear-gradient(90deg, rgba(148,163,184,.3) 0 6px, transparent 6px 14px)' }} />
        ))}
      </div>
      <p className="typo-section-title text-foreground relative">No track laid yet</p>
      <p className="typo-caption text-foreground/50 mt-1 max-w-md text-center relative">
        The network exists on paper only. Each connection below lays the track a
        dimension of this map runs on.
      </p>
      <div className="mt-5 w-full max-w-md space-y-1 relative">
        {project.wiring.map((s, i) => (
          <button
            key={s.key}
            type="button"
            className="w-full flex items-center gap-3 rounded-card border border-foreground/[0.08] bg-black/20 px-3.5 py-2.5 hover:border-foreground/25 transition-colors text-left"
          >
            <span className="typo-label tabular-nums text-foreground/30 w-4">{String(i + 1).padStart(2, '0')}</span>
            <span className="w-2.5 h-2.5 rotate-45 shrink-0" style={{ border: '1px dashed rgba(148,163,184,.5)' }} />
            <span className="min-w-0 flex-1">
              <span className="typo-caption font-medium text-foreground/85 uppercase tracking-wide block">LAY TRACK · {s.label}</span>
              <span className="typo-label text-foreground/40 block truncate">opens {s.unlocks}</span>
            </span>
            <span className="typo-label uppercase tracking-widest" style={{ color: `${NEON.teal}99` }}>build ▸</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// -- the map ------------------------------------------------------------------------------

export default function CockpitTransitLines({ project }: { project: MockProject }) {
  if (project.tier === 'bare') {
    return (
      <div className="flex-1 min-h-0 flex flex-col relative" data-testid="cockpit-transit">
        <Masthead project={project} />
        <GhostNetwork project={project} />
      </div>
    );
  }

  // Build the lines: one per goal; features are the stations; the platform goal
  // additionally carries the technical KPIs as its own stations.
  const platformGoal = project.goals.find((g) => /platform|health/i.test(g.name)) ?? null;
  const lines: LineDef[] = project.goals.map((g, i) => {
    const feats = project.features.filter((f) => f.goalId === g.id);
    const isPlatform = platformGoal?.id === g.id;
    const stations = [
      ...feats.map((f) => ({ name: f.name, kpi: headline(f), rating: f.rating, costUsd: f.costUsd })),
      ...(isPlatform ? project.technicalKpis.map((k) => ({ name: k.name, kpi: k, rating: null, costUsd: null })) : []),
    ];
    return {
      name: g.name,
      progressPct: g.progressPct,
      hue: LINE_HUES[i % LINE_HUES.length]!,
      stations,
      branches: {
        secondary: feats.flatMap((f) => f.kpis.slice(1)),
        findings: [
          ...feats.flatMap((f) => f.findings),
          ...(isPlatform ? project.technicalFindings : []),
        ],
      },
    };
  });
  const orphans = project.features.filter((f) => !f.goalId || !project.goals.some((g) => g.id === f.goalId));
  if (orphans.length > 0) {
    lines.push({
      name: 'Siding — no goal claims these',
      progressPct: null,
      hue: '#64748B',
      stations: orphans.map((f) => ({ name: f.name, kpi: headline(f), rating: f.rating, costUsd: f.costUsd })),
      branches: { secondary: orphans.flatMap((f) => f.kpis.slice(1)), findings: orphans.flatMap((f) => f.findings) },
    });
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-8 relative" data-testid="cockpit-transit">
      <div className="absolute inset-x-0 top-0 h-56 pointer-events-none" style={{ background: `radial-gradient(70% 100% at 75% 0%, ${NEON.teal}09, transparent 60%)` }} />
      <Masthead project={project} />
      <div className="mx-5 mt-5 space-y-7 relative">
        {lines.map((l, i) => <TransitLine key={l.name} line={l} index={i} />)}
      </div>
    </div>
  );
}

function Masthead({ project }: { project: MockProject }) {
  return (
    <div className="mx-5 mt-4 relative">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="typo-heading-lg text-foreground tracking-tight">{project.name}</h2>
          <p className="typo-caption text-foreground/45 mt-0.5">{project.purpose}</p>
        </div>
        {/* depot legend — wiring as diamond markers */}
        <div className="flex items-center gap-3 shrink-0">
          {project.wiring.map((x) => (
            <span key={x.key} className="flex items-center gap-1.5" title={x.wired ? `${x.label} — track laid · ${x.unlocks}` : `${x.label} — no track. ${x.unlocks} stays unreachable.`}>
              <span
                className="w-2 h-2 rotate-45 shrink-0"
                style={x.wired
                  ? { background: NEON.teal, boxShadow: `0 0 6px ${NEON.teal}` }
                  : { border: '1px dashed rgba(148,163,184,.45)' }}
              />
              <span className={`typo-label uppercase tracking-widest ${x.wired ? 'text-foreground/60' : 'text-foreground/30'}`}>{x.key}</span>
            </span>
          ))}
        </div>
      </div>
      {/* loop week as a one-line service notice */}
      {project.loopWeek && (
        <div className="typo-label text-foreground/40 tabular-nums mt-2">
          service this week — {project.loopWeek.raised} raised · {project.loopWeek.dispatched} dispatched ·{' '}
          <span style={{ color: NEON.emerald }}>{project.loopWeek.cleared} cleared</span> ·{' '}
          <span style={{ color: NEON.sky }}>{project.loopWeek.moved} moved</span> ·{' '}
          <span style={{ color: NEON.amber }}>{project.loopWeek.unchanged} unchanged</span>
          {project.loopWeek.regressed > 0 && (
            <span className="font-medium" style={{ color: NEON.red, textShadow: `0 0 8px ${NEON.red}66` }}>
              {' '}· {project.loopWeek.regressed} REGRESSED
            </span>
          )}
        </div>
      )}
    </div>
  );
}
