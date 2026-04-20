// PROTOTYPE — Variant 2 "Console" (Home Base style)
// Mission Control IA re-skinned in warm editorial aesthetic.
// Three-band layout: status rail / persona+inbox / connections.
// Persona cards use Leonardo-generated illustration backgrounds.
import { motion, type Variants } from 'framer-motion';
import {
  Plug, UserCog, Inbox, Check, AlertCircle, Plus, Mail, Hash, GitBranch, Calendar,
  ShieldCheck, MessageSquare, FileOutput, Heart, Sparkles,
} from 'lucide-react';
import { personas, inbox, connections, summary, type PersonaMock, type InboxItemMock } from './mockData';

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
};

const stagger: Variants = {
  visible: { transition: { staggerChildren: 0.04 } },
};

// ── accent palette mapping (tone → text/border/glow classes) ──
const TONE = {
  amber:   { text: 'text-amber-200',   border: 'border-amber-500/25',   tint: 'from-amber-500/20',   dot: 'bg-amber-400' },
  violet:  { text: 'text-violet-200',  border: 'border-violet-500/25',  tint: 'from-violet-500/20',  dot: 'bg-violet-400' },
  rose:    { text: 'text-rose-200',    border: 'border-rose-500/30',    tint: 'from-rose-500/20',    dot: 'bg-rose-400' },
  emerald: { text: 'text-emerald-200', border: 'border-emerald-500/25', tint: 'from-emerald-500/20', dot: 'bg-emerald-400' },
  gold:    { text: 'text-yellow-100',  border: 'border-yellow-500/25',  tint: 'from-yellow-500/20',  dot: 'bg-yellow-400' },
} as const;

function PersonaTile({ p }: { p: PersonaMock }) {
  const tone = TONE[p.accentTone];
  const isNeeds = p.state === 'needs-setup';
  return (
    <motion.div
      variants={fadeUp}
      whileHover={{ y: -2 }}
      className={`relative rounded-3xl border ${isNeeds ? 'border-rose-500/35' : tone.border} overflow-hidden group cursor-default`}
      style={{ aspectRatio: '1 / 1' }}
    >
      {/* Illustration background */}
      <img
        src={p.illustration}
        alt=""
        aria-hidden
        className="absolute inset-0 w-full h-full object-cover opacity-[0.35] group-hover:opacity-50 transition-opacity"
      />
      {/* Readability gradient — dark top, color wash bottom */}
      <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/40 to-background/85" />
      <div className={`absolute inset-0 bg-gradient-to-t ${tone.tint} to-transparent opacity-40`} />

      {/* Content */}
      <div className="relative h-full flex flex-col p-4">
        <div className="flex items-start justify-between">
          <span className="text-2xl drop-shadow-sm">{p.avatar}</span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border backdrop-blur-sm ${
            isNeeds
              ? 'bg-rose-500/15 border-rose-500/30 text-rose-200'
              : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200'
          }`}>
            <span className={`w-1 h-1 rounded-full ${isNeeds ? 'bg-rose-400' : 'bg-emerald-400'}`} />
            {isNeeds ? 'setup' : 'active'}
          </span>
        </div>

        <div className="mt-auto space-y-1.5">
          <div className="font-serif text-sm text-foreground leading-tight">{p.name}</div>
          <div className="flex items-center gap-1 flex-wrap">
            {p.connectors.map((c) => (
              <span key={c} className="text-[10px] px-1.5 py-0.5 rounded-full bg-background/60 backdrop-blur-sm border border-primary/10 text-foreground/70">
                {c}
              </span>
            ))}
          </div>
          <div className="text-[10px] text-foreground/50 flex items-center justify-between pt-1 border-t border-primary/10">
            <span className="italic">last run</span>
            <span className="text-foreground/80 font-medium">{p.lastRun}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function KindIcon({ kind, className = 'w-3.5 h-3.5' }: { kind: InboxItemMock['kind']; className?: string }) {
  return kind === 'approval' ? <ShieldCheck className={className} />
    : kind === 'message' ? <MessageSquare className={className} />
    : kind === 'output' ? <FileOutput className={className} />
    : <Heart className={className} />;
}

function InboxRow({ item }: { item: InboxItemMock }) {
  const accent =
    item.severity === 'critical' ? 'text-rose-300'
    : item.kind === 'approval' ? 'text-amber-300'
    : item.kind === 'output' ? 'text-emerald-300'
    : 'text-violet-300';

  return (
    <motion.div
      variants={fadeUp}
      className="px-4 py-3 flex items-start gap-3 hover:bg-foreground/[0.04] transition-colors cursor-default"
    >
      <div className={`w-8 h-8 rounded-2xl bg-foreground/5 border border-primary/10 flex items-center justify-center shrink-0 ${accent}`}>
        <KindIcon kind={item.kind} className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-[13px] text-foreground leading-snug truncate">{item.title}</span>
        </div>
        <div className="text-[11px] text-foreground/55 mt-0.5">
          <span className="italic">{item.personaName}</span>
          <span className="text-foreground/30"> · </span>
          <span>{item.time}</span>
        </div>
      </div>
      {item.kind === 'approval' && (
        <button className="shrink-0 text-[11px] px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-200 hover:bg-amber-500/25">
          Approve
        </button>
      )}
      {item.severity === 'critical' && item.kind !== 'approval' && (
        <button className="shrink-0 text-[11px] px-2.5 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-200 hover:bg-rose-500/25">
          Fix
        </button>
      )}
    </motion.div>
  );
}

export function SimpleModeVariantConsole() {
  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="visible"
      className="h-full flex flex-col bg-gradient-to-br from-amber-500/[0.03] via-background to-violet-500/[0.04] text-foreground overflow-hidden"
    >
      {/* ─── TOP STATUS RAIL — three pillars ─── */}
      <motion.div
        variants={fadeUp}
        className="px-6 py-4 border-b border-primary/10 flex items-center gap-4 shrink-0 bg-background/40"
      >
        <div className="flex items-center gap-2 mr-2">
          <Sparkles className="w-4 h-4 text-violet-300" />
          <h1 className="font-serif text-lg text-foreground">Your console</h1>
          <span className="text-[11px] text-foreground/50 italic">Thursday morning</span>
        </div>
        <div className="flex items-center gap-2 flex-1 justify-end">
          {[
            { icon: <Plug className="w-3.5 h-3.5" />,    label: 'Connected', value: `${summary.connectionsOkCount} of ${summary.connectionsTotal}`, tone: 'amber' as const },
            { icon: <UserCog className="w-3.5 h-3.5" />, label: 'Assistants', value: `${summary.activeCount} active`,                                tone: 'violet' as const },
            { icon: <Inbox className="w-3.5 h-3.5" />,   label: 'New today',  value: `${summary.inboxNewCount} items`,                               tone: 'emerald' as const },
          ].map((s, i) => {
            const t = TONE[s.tone];
            return (
              <div key={i} className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${t.border} bg-background/60`}>
                <motion.span
                  animate={{ opacity: [1, 0.4, 1] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                  className={`w-1.5 h-1.5 rounded-full ${t.dot}`}
                />
                <span className={t.text}>{s.icon}</span>
                <span className="text-[11px] text-foreground/60">{s.label}</span>
                <span className={`text-[11px] font-medium ${t.text}`}>{s.value}</span>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* ─── MIDDLE: persona grid + inbox feed ─── */}
      <div className="flex-1 grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] min-h-0">
        {/* Persona grid */}
        <motion.div variants={fadeUp} className="border-r border-primary/10 p-5 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <div>
              <h2 className="font-serif text-base text-foreground">Your assistants</h2>
              <div className="text-[11px] text-foreground/50 italic">Tap a card to open their workshop</div>
            </div>
            <div className="flex items-center gap-1">
              <span className="px-2.5 py-0.5 rounded-full bg-foreground/5 border border-primary/10 text-[10px] text-foreground/70">All · {personas.length}</span>
              {summary.needsSetupCount > 0 && (
                <span className="px-2.5 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/25 text-[10px] text-rose-200">Needs setup · {summary.needsSetupCount}</span>
              )}
            </div>
          </div>

          <motion.div variants={stagger} className="grid grid-cols-3 gap-3 content-start flex-1 min-h-0 overflow-auto pb-1">
            {personas.map((p) => <PersonaTile key={p.id} p={p} />)}
            {/* Create tile */}
            <motion.div
              variants={fadeUp}
              whileHover={{ y: -2 }}
              className="rounded-3xl border border-dashed border-primary/20 bg-foreground/[0.02] hover:border-primary/40 hover:bg-foreground/[0.04] cursor-pointer flex flex-col items-center justify-center gap-2 p-4"
              style={{ aspectRatio: '1 / 1' }}
            >
              <div className="w-10 h-10 rounded-2xl border border-primary/20 flex items-center justify-center text-foreground/60">
                <Plus className="w-5 h-5" />
              </div>
              <div className="font-serif text-sm text-foreground/80">New assistant</div>
              <div className="text-[10px] text-foreground/50 italic text-center">Pick a template</div>
            </motion.div>
          </motion.div>
        </motion.div>

        {/* Inbox */}
        <motion.div variants={fadeUp} className="flex flex-col min-h-0 bg-background/30">
          <div className="px-4 py-4 border-b border-primary/10 shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-base text-foreground">What's new</h2>
              <span className="text-[10px] text-foreground/50 italic">live</span>
            </div>
            <div className="flex items-center gap-1.5 mt-2">
              <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-[10px] text-amber-200">Needs me · {summary.inboxNeedsMeCount}</span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-[10px] text-emerald-200">New · {summary.inboxNewCount}</span>
            </div>
          </div>
          <motion.div variants={stagger} className="flex-1 overflow-auto divide-y divide-primary/5">
            {inbox.map((item) => <InboxRow key={item.id} item={item} />)}
          </motion.div>
        </motion.div>
      </div>

      {/* ─── BOTTOM: connections rail ─── */}
      <motion.div
        variants={fadeUp}
        className="px-6 py-3 border-t border-primary/10 bg-background/60 flex items-center gap-4 shrink-0"
      >
        <span className="text-[10px] uppercase tracking-wider text-foreground/40">Connections</span>
        <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto">
          {connections.map((c) => {
            const icon =
              c.id === 'gmail' ? <Mail className="w-3.5 h-3.5" />
              : c.id === 'calendar' ? <Calendar className="w-3.5 h-3.5" />
              : c.id === 'slack' ? <Hash className="w-3.5 h-3.5" />
              : <GitBranch className="w-3.5 h-3.5" />;
            return (
              <div
                key={c.id}
                className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] ${
                  c.ok
                    ? 'bg-foreground/5 border border-primary/10 text-foreground/80'
                    : 'bg-rose-500/10 border border-rose-500/25 text-rose-200'
                }`}
              >
                {icon}
                <span>{c.name}</span>
                {c.ok ? <Check className="w-3 h-3 text-emerald-400/80" /> : <AlertCircle className="w-3 h-3" />}
              </div>
            );
          })}
          <button className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-primary/20 text-[11px] text-foreground/50 hover:text-foreground/80 hover:border-primary/40">
            <Plus className="w-3 h-3" />
            <span>add more</span>
          </button>
        </div>
        <span className="text-[11px] text-foreground/50 italic shrink-0">Settings →</span>
      </motion.div>
    </motion.div>
  );
}
