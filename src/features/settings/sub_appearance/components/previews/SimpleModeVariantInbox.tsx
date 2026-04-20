// PROTOTYPE — Variant 3 "Inbox" (Home Base style)
// Manual-review master-detail experience in warm editorial aesthetic.
// Inspired by src/features/overview/sub_manual-review patterns:
//   - inbox list + conversation detail + action zone
//   - suggested actions (numbered quick-fills)
//   - optional message/notes input
//   - keyboard-first navigation hints
import { useState } from 'react';
import { motion, type Variants } from 'framer-motion';
import {
  Check, X, Clock, CornerDownLeft, ChevronLeft, ChevronRight, Filter, Search,
  ShieldCheck, MessageSquare, FileOutput, Heart, Sparkles,
} from 'lucide-react';
import { personas, inbox, type InboxItemMock } from './mockData';

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.28, ease: 'easeOut' } },
};

const stagger: Variants = {
  visible: { transition: { staggerChildren: 0.04 } },
};

const SEVERITY_DOT = {
  critical: 'bg-rose-400',
  warning: 'bg-amber-400',
  info: 'bg-violet-400',
} as const;

const KIND_ACCENT = {
  approval: { border: 'border-amber-500/25', tint: 'from-amber-500/15', text: 'text-amber-200', chip: 'bg-amber-500/15 border-amber-500/30 text-amber-200' },
  message:  { border: 'border-violet-500/25', tint: 'from-violet-500/15', text: 'text-violet-200', chip: 'bg-violet-500/15 border-violet-500/30 text-violet-200' },
  output:   { border: 'border-emerald-500/25', tint: 'from-emerald-500/15', text: 'text-emerald-200', chip: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200' },
  health:   { border: 'border-rose-500/30', tint: 'from-rose-500/15', text: 'text-rose-200', chip: 'bg-rose-500/15 border-rose-500/30 text-rose-200' },
} as const;

function KindIcon({ kind, className = 'w-4 h-4' }: { kind: InboxItemMock['kind']; className?: string }) {
  return kind === 'approval' ? <ShieldCheck className={className} />
    : kind === 'message' ? <MessageSquare className={className} />
    : kind === 'output' ? <FileOutput className={className} />
    : <Heart className={className} />;
}

function InboxRow({
  item, active, onClick,
}: {
  item: InboxItemMock; active: boolean; onClick: () => void;
}) {
  const persona = personas.find((p) => p.id === item.personaId);
  return (
    <motion.button
      variants={fadeUp}
      onClick={onClick}
      className={`relative w-full text-left px-4 py-3 border-l-2 transition-colors ${
        active
          ? 'border-amber-400/80 bg-gradient-to-r from-amber-500/[0.08] to-transparent'
          : 'border-transparent hover:bg-foreground/[0.03]'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0 w-10 h-10 rounded-2xl overflow-hidden border border-primary/10">
          {persona && (
            <img src={persona.illustration} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover opacity-70" />
          )}
          <div className="absolute inset-0 bg-background/40 flex items-center justify-center text-base">
            {persona?.avatar}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`w-1.5 h-1.5 rounded-full ${SEVERITY_DOT[item.severity]}`} />
            <span className="text-[11px] italic text-foreground/60 truncate">{item.personaName}</span>
            <span className="text-foreground/30 text-[10px]">·</span>
            <span className="text-[10px] text-foreground/50 shrink-0">{item.time}</span>
          </div>
          <div className="font-serif text-[13px] text-foreground leading-tight line-clamp-2">{item.title}</div>
          {item.preview && (
            <div className="text-[11px] text-foreground/50 mt-1 truncate italic">{item.preview}</div>
          )}
        </div>
      </div>
    </motion.button>
  );
}

function Detail({ item }: { item: InboxItemMock }) {
  const persona = personas.find((p) => p.id === item.personaId);
  const accent = KIND_ACCENT[item.kind];

  return (
    <motion.div
      key={item.id}
      variants={stagger}
      initial="hidden"
      animate="visible"
      className="flex-1 flex flex-col min-h-0"
    >
      {/* Header band with persona illustration */}
      <motion.div
        variants={fadeUp}
        className={`relative px-8 py-5 border-b border-primary/10 overflow-hidden`}
      >
        {persona && (
          <img src={persona.illustration} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover opacity-25" />
        )}
        <div className={`absolute inset-0 bg-gradient-to-r ${accent.tint} to-transparent opacity-60`} />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent" />

        <div className="relative flex items-start gap-4">
          <div className="w-12 h-12 rounded-3xl bg-background/70 backdrop-blur-sm border border-primary/15 flex items-center justify-center text-2xl shrink-0">
            {persona?.avatar}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border ${accent.chip}`}>
                <KindIcon kind={item.kind} className="w-3 h-3" />
                {item.kind}
              </span>
              <span className="text-[11px] italic text-foreground/60">from {item.personaName}</span>
              <span className="text-foreground/30">·</span>
              <span className="text-[11px] text-foreground/50">{item.time}</span>
            </div>
            <h1 className="font-serif text-xl text-foreground leading-snug">{item.title}</h1>
          </div>
        </div>
      </motion.div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-[640px] mx-auto px-8 py-6 space-y-5">
          {/* Body text — the review message */}
          <motion.div variants={fadeUp} className={`rounded-3xl border ${accent.border} bg-gradient-to-br ${accent.tint} to-transparent p-5`}>
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-6 h-6 rounded-xl bg-background/60 border border-primary/10 flex items-center justify-center ${accent.text}`}>
                <KindIcon kind={item.kind} className="w-3.5 h-3.5" />
              </div>
              <span className="text-[11px] uppercase tracking-wider text-foreground/50">the ask</span>
            </div>
            <p className="font-serif text-[15px] leading-relaxed text-foreground/90">{item.body}</p>
          </motion.div>

          {/* Context data */}
          {item.context && item.context.length > 0 && (
            <motion.div variants={fadeUp} className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-foreground/45 px-1">Details</div>
              <div className="grid grid-cols-2 gap-2">
                {item.context.map((c) => (
                  <div key={c.label} className="rounded-2xl border border-primary/10 bg-foreground/[0.02] px-4 py-3">
                    <div className="text-[10px] uppercase tracking-wider text-foreground/45">{c.label}</div>
                    <div className="font-serif text-sm text-foreground mt-0.5">{c.value}</div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Suggested quick actions */}
          {item.suggestions && item.suggestions.length > 0 && (
            <motion.div variants={fadeUp} className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] uppercase tracking-wider text-foreground/45">Suggested</span>
                <span className="text-[10px] text-foreground/40 italic">press 1–{item.suggestions.length}</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {item.suggestions.map((s, i) => (
                  <button
                    key={s}
                    className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-primary/15 bg-foreground/[0.03] text-[12px] text-foreground/85 hover:border-primary/30 hover:bg-foreground/[0.07] transition-colors"
                  >
                    <span className="w-4 h-4 rounded-full bg-foreground/10 text-foreground/70 flex items-center justify-center text-[9px] font-mono">{i + 1}</span>
                    <span>{s}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Notes input */}
          <motion.div variants={fadeUp} className="rounded-3xl border border-primary/10 bg-foreground/[0.02]">
            <textarea
              placeholder="Add a note — Klára, why this decision? (optional)"
              rows={3}
              className="w-full bg-transparent border-0 focus:ring-0 focus:outline-none px-4 py-3 font-serif text-[13px] text-foreground/90 placeholder:text-foreground/40 placeholder:italic resize-none"
            />
            <div className="flex items-center justify-between px-3 pb-2 text-[10px] text-foreground/40">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" />
                Your notes help tune future decisions
              </span>
              <span className="inline-flex items-center gap-1">
                <CornerDownLeft className="w-3 h-3" />
                enter to send
              </span>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Action zone */}
      <motion.div variants={fadeUp} className="border-t border-primary/10 bg-gradient-to-r from-rose-500/[0.04] via-background to-amber-500/[0.04] px-6 py-3 flex items-center gap-3 shrink-0">
        <button className="flex-1 h-11 rounded-2xl border border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 text-rose-200 font-medium text-sm inline-flex items-center justify-center gap-2">
          <X className="w-4 h-4" />
          Reject
          <span className="text-[10px] text-rose-200/60 ml-1">←</span>
        </button>
        <button className="h-11 px-5 rounded-2xl border border-primary/15 bg-foreground/[0.04] hover:bg-foreground/[0.08] text-foreground/80 text-sm inline-flex items-center justify-center gap-2">
          <Clock className="w-4 h-4" />
          Defer
          <span className="text-[10px] text-foreground/40 ml-1">↓</span>
        </button>
        <button className="flex-[2] h-11 rounded-2xl bg-amber-500 hover:bg-amber-400 text-amber-950 font-medium text-sm inline-flex items-center justify-center gap-2">
          <Check className="w-4 h-4" />
          Approve
          <span className="text-[10px] text-amber-900/70 ml-1">→</span>
        </button>
      </motion.div>
    </motion.div>
  );
}

export function SimpleModeVariantInbox() {
  const first = inbox[0]!;
  const [selectedId, setSelectedId] = useState(first.id);
  const selected = inbox.find((i) => i.id === selectedId) ?? first;
  const idx = inbox.findIndex((i) => i.id === selectedId);

  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="visible"
      className="h-full flex flex-col bg-gradient-to-br from-amber-500/[0.03] via-background to-violet-500/[0.04] text-foreground overflow-hidden"
    >
      {/* Thin header */}
      <motion.div
        variants={fadeUp}
        className="px-6 py-3 border-b border-primary/10 flex items-center justify-between shrink-0 bg-background/40"
      >
        <div className="flex items-center gap-3">
          <h1 className="font-serif text-lg text-foreground">Your inbox</h1>
          <span className="text-[11px] italic text-foreground/50">Decide what to do with the output of your assistants</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-foreground/5 border border-primary/10 text-[11px] text-foreground/70 hover:bg-foreground/10">
            <Filter className="w-3 h-3" /> Needs me · 2
          </button>
          <button className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-foreground/5 border border-primary/10 text-[11px] text-foreground/70 hover:bg-foreground/10">
            <Search className="w-3 h-3" /> Search
          </button>
        </div>
      </motion.div>

      {/* Master–detail split */}
      <div className="flex-1 grid grid-cols-[minmax(260px,320px)_minmax(0,1fr)] min-h-0">
        {/* Inbox list (master) */}
        <motion.div variants={fadeUp} className="border-r border-primary/10 flex flex-col min-h-0 bg-background/30">
          <div className="px-4 py-3 border-b border-primary/10 flex items-center gap-2 shrink-0">
            <span className="text-[10px] uppercase tracking-wider text-foreground/45">Today</span>
            <span className="text-[10px] text-foreground/30">·</span>
            <span className="text-[10px] text-foreground/50 italic">{inbox.length} items</span>
          </div>
          <motion.div variants={stagger} className="flex-1 overflow-auto">
            {inbox.map((item) => (
              <InboxRow
                key={item.id}
                item={item}
                active={item.id === selectedId}
                onClick={() => setSelectedId(item.id)}
              />
            ))}
          </motion.div>
          <div className="px-4 py-2 border-t border-primary/10 text-[10px] text-foreground/40 flex items-center justify-between shrink-0">
            <span>{idx + 1} of {inbox.length}</span>
            <span className="inline-flex items-center gap-1">
              <ChevronLeft className="w-3 h-3" /> / <ChevronRight className="w-3 h-3" />
              <span className="ml-1">to navigate</span>
            </span>
          </div>
        </motion.div>

        {/* Detail pane */}
        <Detail item={selected} />
      </div>
    </motion.div>
  );
}
