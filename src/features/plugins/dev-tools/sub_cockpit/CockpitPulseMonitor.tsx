// VARIANT C — "Pulse Monitor" (R2 — built from a blank slate after R1's
// reuse-collage was rejected).
//
// Metaphor: a flight/medical INSTRUMENT PANEL. The project is a patient on
// telemetry: readiness meters, a wiring power-rail, an ECG strip where the
// loop's week beats (a regression is a deep inverted spike you cannot miss),
// feature telemetry channels with live traces, and an arc-gauge cluster for
// platform health. An unwired sensor is an UNLIT instrument — dark glass, "no
// signal" — which is what makes wiring feel like powering the panel up.
//
// Component strategy: everything here is custom-drawn (SVG arcs, traces, lamp
// glows). The ONLY inherited frame is Personas theming — the dark surface,
// the neon accent set (teal/violet/amber), typo-* scale, radii and elevation.
// Nothing is imported from existing feature modules.
import { motion } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { NEON, TONE_HEX, VerdictPulse, seededTrace, tracePath } from './cockpitGlyphs';
import { kpiTone, type MockFeature, type MockKpi, type MockProject } from './cockpitMock';

/** A wiring lamp on the power rail — lit (glowing) or dark glass. */
function Lamp({ label, lit }: { label: string; lit: boolean }) {
  return (
    <div className="flex items-center gap-1.5" title={lit ? `${label} — powered` : `${label} — no power. Wire it to light this instrument.`}>
      <span
        className="w-2 h-2 rounded-full"
        style={lit
          ? { background: NEON.teal, boxShadow: `0 0 6px ${NEON.teal}, 0 0 14px ${NEON.teal}66` }
          : { background: 'transparent', border: '1px dashed rgba(148,163,184,.45)' }}
      />
      <span className={`typo-label uppercase tracking-widest ${lit ? 'text-foreground/70' : 'text-foreground/30'}`}>{label}</span>
    </div>
  );
}

/** Slim readiness meter — track, glowing fill, target notch at 70. */
function Meter({ label, value, hue }: { label: string; value: number; hue: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="typo-label uppercase tracking-widest text-foreground/40 w-20 shrink-0">{label}</span>
      <div className="relative h-1 flex-1 rounded-full bg-foreground/10 overflow-visible">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${value}%`, background: hue, boxShadow: `0 0 8px ${hue}88` }}
        />
        <div className="absolute top-1/2 -translate-y-1/2 w-px h-2.5 bg-foreground/40" style={{ left: '70%' }} title="target line" />
      </div>
      <span className="typo-label tabular-nums text-foreground/60 w-7 text-right shrink-0">{value}</span>
    </div>
  );
}

// -- the ECG strip (the loop's week as a heartbeat) --------------------------------

function LoopEcg({ project }: { project: MockProject }) {
  const { shouldAnimate } = useMotion();
  const lw = project.loopWeek;
  const W = 560; const H = 56; const mid = H / 2 + 8;

  // Compose the week as beats along the strip, LOUDEST semantics per event kind.
  const beats: { c: string; up: number; w: number; label: string }[] = [];
  if (lw) {
    for (let i = 0; i < lw.raised; i++) beats.push({ c: NEON.teal, up: 8, w: 8, label: 'raised' });
    for (let i = 0; i < lw.dispatched; i++) beats.push({ c: NEON.violet, up: 12, w: 10, label: 'dispatched' });
    for (let i = 0; i < lw.cleared; i++) beats.push({ c: NEON.emerald, up: 22, w: 12, label: 'cleared' });
    for (let i = 0; i < lw.moved; i++) beats.push({ c: NEON.sky, up: 17, w: 12, label: 'moved' });
    for (let i = 0; i < lw.unchanged; i++) beats.push({ c: NEON.amber, up: 4, w: 14, label: 'unchanged' });
    for (let i = 0; i < lw.regressed; i++) beats.push({ c: NEON.red, up: -26, w: 14, label: 'REGRESSED' });
  }
  const gap = beats.length > 0 ? W / (beats.length + 1) : W;

  return (
    <div className="relative rounded-card border border-foreground/[0.07] bg-black/20 px-4 pt-2.5 pb-1.5 overflow-hidden">
      {/* fog behind the strip */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(60% 120% at 30% 50%, ${NEON.teal}0d, transparent 70%)` }} />
      <div className="flex items-baseline justify-between relative">
        <span className="typo-label uppercase tracking-widest text-foreground/45">Loop · this week</span>
        {lw ? (
          <span className="typo-label text-foreground/40 tabular-nums">
            {lw.raised} raised · {lw.dispatched} dispatched · {lw.cleared + lw.moved} improved · {lw.unchanged} unchanged
            {lw.regressed > 0 && <span className="ml-1" style={{ color: NEON.red }}>· {lw.regressed} regressed</span>}
          </span>
        ) : (
          <span className="typo-label text-foreground/30">no signal</span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14 relative" preserveAspectRatio="none">
        {/* baseline */}
        <line x1="0" y1={mid} x2={W} y2={mid} stroke="rgba(148,163,184,.18)" strokeWidth="1" />
        {beats.map((b, i) => {
          const x = gap * (i + 1);
          const d = `M${x - b.w},${mid} L${x - b.w / 3},${mid} L${x},${mid - b.up} L${x + b.w / 3},${mid} L${x + b.w},${mid}`;
          return (
            <motion.path
              key={i}
              d={d}
              fill="none"
              stroke={b.c}
              strokeWidth="1.6"
              strokeLinejoin="round"
              style={{ filter: `drop-shadow(0 0 3px ${b.c})` }}
              initial={shouldAnimate ? { pathLength: 0, opacity: 0 } : { opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ delay: 0.15 + i * 0.06, duration: 0.4, ease: 'easeOut' }}
            >
              <title>{b.label}</title>
            </motion.path>
          );
        })}
        {beats.length === 0 && <line x1="0" y1={mid} x2={W} y2={mid} stroke="rgba(148,163,184,.3)" strokeWidth="1" strokeDasharray="2 6" />}
      </svg>
    </div>
  );
}

// -- feature telemetry channel -------------------------------------------------------

function Channel({ feature }: { feature: MockFeature }) {
  return (
    <div className="rounded-card border border-foreground/[0.07] bg-black/15 px-4 py-3">
      <div className="flex items-baseline gap-3 min-w-0">
        <span className="typo-body font-medium text-foreground truncate">{feature.name}</span>
        {feature.rating !== null && (
          <span className="typo-label text-foreground/45 tabular-nums shrink-0" title="user rating">☉ {feature.rating.toFixed(1)}/5</span>
        )}
        <span className="ml-auto shrink-0 typo-label text-foreground/35 tabular-nums">
          {feature.costUsd !== null ? `$${feature.costUsd}/30d` : ''}
        </span>
      </div>

      <div className="mt-2 space-y-2">
        {feature.kpis.map((k) => <ChannelTrace key={k.id} kpi={k} />)}
        {feature.costUsd === null && <NoSignal need="LLM tracking" what="cost per feature" />}
      </div>

      {feature.findings.length > 0 && (
        <div className="mt-2.5 pt-2 border-t border-foreground/[0.06] space-y-1">
          {feature.findings.map((fd) => (
            <div key={fd.id} className="flex items-center gap-2 min-w-0">
              <VerdictPulse verdict={fd.verdict ?? (fd.state === 'dispatched' ? null : null)} />
              {fd.state === 'dispatched' && !fd.verdict && (
                <span className="w-2 h-2 rounded-full shrink-0 animate-pulse" style={{ background: NEON.violet, boxShadow: `0 0 6px ${NEON.violet}` }} title="dispatched — in flight" />
              )}
              {fd.state === 'proposed' && !fd.verdict && (
                <span className="w-2 h-2 rounded-full shrink-0" style={{ border: `1px solid ${NEON.teal}`, background: 'transparent' }} title="proposed" />
              )}
              <span className="typo-caption text-foreground/80 truncate">{fd.title}</span>
              <span className="typo-label text-foreground/35 truncate hidden lg:inline">· {fd.evidence}</span>
              <button type="button" className="ml-auto shrink-0 typo-label uppercase tracking-widest text-foreground/35 hover:text-foreground/80 transition-colors" title="R3 designs the dispatch flow">
                dispatch ▸
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChannelTrace({ kpi }: { kpi: MockKpi }) {
  if (kpi.needsWiring) return <NoSignal need={kpi.needsWiring === 'llm' ? 'LLM tracking' : kpi.needsWiring} what={kpi.name} />;
  const tone = TONE_HEX[kpiTone(kpi)];
  const pts = seededTrace(kpi.id, kpi.trendPct);
  return (
    <div className="flex items-center gap-3 min-w-0">
      <span className="typo-label text-foreground/45 w-32 truncate shrink-0">{kpi.name}</span>
      <svg viewBox="0 0 120 20" className="h-5 flex-1 min-w-0" preserveAspectRatio="none">
        <path d={tracePath(pts, 120, 20)} fill="none" stroke={tone} strokeWidth="1.3" style={{ filter: `drop-shadow(0 0 2px ${tone})` }} opacity="0.9" />
      </svg>
      <span className="typo-body font-semibold tabular-nums shrink-0" style={{ color: tone }}>
        {kpi.unit === '$' && '$'}{kpi.current}{kpi.unit !== '$' ? kpi.unit : ''}
      </span>
      <span className="typo-label text-foreground/35 tabular-nums shrink-0">/ {kpi.unit === '$' && '$'}{kpi.target}{kpi.unit !== '$' ? kpi.unit : ''}</span>
    </div>
  );
}

/** An unpowered instrument: dashed static + the wiring that would light it. */
function NoSignal({ need, what }: { need: string; what: string }) {
  return (
    <button type="button" className="w-full flex items-center gap-3 min-w-0 group" title={`Wire ${need} in Vault → Connectors`}>
      <span className="typo-label text-foreground/30 w-32 truncate shrink-0 text-left">{what}</span>
      <svg viewBox="0 0 120 20" className="h-5 flex-1 min-w-0" preserveAspectRatio="none">
        <line x1="0" y1="10" x2="120" y2="10" stroke="rgba(148,163,184,.35)" strokeWidth="1" strokeDasharray="2 5" />
      </svg>
      <span className="typo-label uppercase tracking-widest shrink-0 transition-colors" style={{ color: `${NEON.amber}B3` }}>
        no signal — wire {need} ▸
      </span>
    </button>
  );
}

// -- arc gauge -----------------------------------------------------------------------

function ArcGauge({ kpi }: { kpi: MockKpi }) {
  const unlit = kpi.needsWiring != null || kpi.current === null;
  const tone = unlit ? '#475569' : TONE_HEX[kpiTone(kpi)];
  const max = unlit ? 1 : Math.max(kpi.current!, kpi.target) * 1.25;
  const frac = unlit ? 0 : Math.min(1, kpi.current! / max);
  const tFrac = unlit ? 0.7 : Math.min(1, kpi.target / max);
  const R = 34; const CX = 44; const CY = 46;
  const arc = (f: number) => {
    const a = Math.PI * (1 - f);
    return { x: CX + R * Math.cos(a), y: CY - R * Math.sin(a) };
  };
  const end = arc(frac); const tick = arc(tFrac);
  return (
    <div className="rounded-card border border-foreground/[0.07] bg-black/15 px-3 pt-2 pb-2.5 flex flex-col items-center">
      <svg width="88" height="52" viewBox="0 0 88 52">
        <path d={`M${CX - R},${CY} A${R},${R} 0 0 1 ${CX + R},${CY}`} fill="none" stroke="rgba(148,163,184,.14)" strokeWidth="5" strokeLinecap="round" />
        {!unlit && frac > 0.01 && (
          <path
            d={`M${CX - R},${CY} A${R},${R} 0 0 1 ${end.x.toFixed(1)},${end.y.toFixed(1)}`}
            fill="none" stroke={tone} strokeWidth="5" strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 4px ${tone})` }}
          />
        )}
        <line x1={CX + (R - 7) * Math.cos(Math.PI * (1 - tFrac))} y1={CY - (R - 7) * Math.sin(Math.PI * (1 - tFrac))} x2={tick.x} y2={tick.y} stroke="rgba(226,232,240,.6)" strokeWidth="1.5" />
        <text x={CX} y={CY - 4} textAnchor="middle" className="tabular-nums" fill={unlit ? '#475569' : '#E2E8F0'} fontSize="13" fontWeight="600">
          {unlit ? '--' : `${kpi.unit === '$' ? '$' : ''}${kpi.current}${kpi.unit !== '$' ? kpi.unit : ''}`}
        </text>
      </svg>
      <span className={`typo-label truncate max-w-full ${unlit ? 'text-foreground/30' : 'text-foreground/55'}`}>{kpi.name}</span>
      {unlit && kpi.needsWiring && (
        <button type="button" className="typo-label uppercase tracking-widest mt-0.5" style={{ color: `${NEON.amber}B3` }}>
          wire ▸
        </button>
      )}
    </div>
  );
}

// -- bare tier: power-up sequence ------------------------------------------------------

function PowerUp({ project }: { project: MockProject }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center relative" data-testid="cockpit-establish">
      <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(50% 50% at 50% 42%, ${NEON.violet}0f, transparent 70%)` }} />
      <div className="grid grid-cols-4 gap-2 opacity-60 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <ArcGauge key={i} kpi={{ id: `dark${i}`, name: '—', unit: '', kind: 'metric', current: null, target: 1, direction: 'up', trendPct: null }} />
        ))}
      </div>
      <p className="typo-section-title text-foreground relative">Instruments offline</p>
      <p className="typo-caption text-foreground/50 mt-1 max-w-md text-center relative">
        Nothing is wired, so nothing honest can be measured. Power the panel up — each
        switch below lights a set of instruments.
      </p>
      <div className="mt-5 w-full max-w-md space-y-1 relative">
        {project.wiring.map((s, i) => (
          <button
            key={s.key}
            type="button"
            className="w-full flex items-center gap-3 rounded-card border border-foreground/[0.08] bg-black/20 px-3.5 py-2.5 hover:border-foreground/25 transition-colors text-left"
          >
            <span className="typo-label tabular-nums text-foreground/30 w-4">{String(i + 1).padStart(2, '0')}</span>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ border: '1px dashed rgba(148,163,184,.5)' }} />
            <span className="min-w-0 flex-1">
              <span className="typo-caption font-medium text-foreground/85 uppercase tracking-wide block">POWER · {s.label}</span>
              <span className="typo-label text-foreground/40 block truncate">lights {s.unlocks}</span>
            </span>
            <span className="typo-label uppercase tracking-widest" style={{ color: `${NEON.teal}99` }}>engage ▸</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// -- the panel ---------------------------------------------------------------------------

export default function CockpitPulseMonitor({ project }: { project: MockProject }) {
  const bare = project.tier === 'bare';
  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-6 relative" data-testid="cockpit-pulse">
      {/* atmosphere */}
      <div className="absolute inset-x-0 top-0 h-64 pointer-events-none" style={{ background: `radial-gradient(70% 100% at 20% 0%, ${NEON.violet}0a, transparent 60%)` }} />

      {/* masthead */}
      <div className="mx-5 mt-4 relative">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h2 className="typo-heading-lg text-foreground tracking-tight">{project.name}</h2>
            <p className="typo-caption text-foreground/45 mt-0.5">{project.purpose}</p>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            {project.wiring.map((x) => <Lamp key={x.key} label={x.key} lit={x.wired} />)}
          </div>
        </div>
        <div className="mt-3 grid sm:grid-cols-2 gap-x-8 gap-y-1.5 max-w-2xl">
          <Meter label="automation" value={project.automation.score} hue={NEON.violet} />
          <Meter label="production" value={project.production.score} hue={NEON.teal} />
        </div>
      </div>

      {bare ? (
        <PowerUp project={project} />
      ) : (
        <>
          <div className="mx-5 mt-4 relative"><LoopEcg project={project} /></div>

          <div className="mx-5 mt-4 relative">
            <div className="typo-label uppercase tracking-widest text-foreground/40 mb-1.5">Business · telemetry channels</div>
            <div className="grid lg:grid-cols-2 gap-2">
              {project.features.map((f) => <Channel key={f.id} feature={f} />)}
            </div>
          </div>

          <div className="mx-5 mt-4 relative">
            <div className="typo-label uppercase tracking-widest text-foreground/40 mb-1.5">Technical · gauge cluster</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {project.technicalKpis.map((k) => <ArcGauge key={k.id} kpi={k} />)}
            </div>
            {project.technicalFindings.length > 0 && (
              <div className="mt-2 rounded-card border border-foreground/[0.07] bg-black/15 px-4 py-2 space-y-1">
                {project.technicalFindings.map((fd) => (
                  <div key={fd.id} className="flex items-center gap-2 min-w-0">
                    <VerdictPulse verdict={fd.verdict} />
                    {!fd.verdict && <span className="w-2 h-2 rounded-full shrink-0" style={{ border: `1px solid ${NEON.teal}` }} />}
                    <span className="typo-caption text-foreground/80 truncate">{fd.title}</span>
                    <span className="typo-label text-foreground/35 truncate hidden lg:inline">· {fd.evidence}</span>
                    <button type="button" className="ml-auto shrink-0 typo-label uppercase tracking-widest text-foreground/35 hover:text-foreground/80 transition-colors">dispatch ▸</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
